/**
 * La vista previa de una fuente web: título, descripción, imagen y sitio.
 *
 * Para que una fuente se vea en el chat como una tarjeta y no como un enlace
 * pelado (ni como "Descargar archivo"). Lo lee el SERVIDOR, así que se cuida
 * de lo que un servidor no puede hacer por pedido de un enlace (SSRF):
 *
 * - solo http/https, puertos estándar;
 * - nunca una dirección interna: se resuelve el nombre y se rechaza cualquier
 *   IP privada, local, de enlace o reservada; y se vuelve a comprobar en cada
 *   redirección (hasta 3);
 * - 5 s de espera, 512 KB como máximo, solo HTML;
 * - se devuelve solo texto de metadatos; el contenido de la página es dato.
 */
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export type VistaPrevia = {
  url: string;
  sitio: string;
  titulo: string | null;
  descripcion: string | null;
  imagen: string | null;
};

export const TIEMPO_MS = 5_000;
export const MAX_BYTES = 512 * 1024;
const MAX_REDIRECCIONES = 3;

/** ¿Es una IP a la que el servidor nunca tiene que ir? */
export function esIpPrivada(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  if (v === 6) {
    const x = ip.toLowerCase();
    if (x === "::" || x === "::1") return true;
    if (x.startsWith("::ffff:")) return esIpPrivada(x.slice(7));
    return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(x);
  }
  return true;
}

export type Resolver = (host: string) => Promise<string[]>;

const resolverPorDefecto: Resolver = async (host) => (await lookup(host, { all: true })).map((r) => r.address);

/** La URL es pública y se puede pedir; si no, el motivo. */
export async function validarUrl(crudo: string, resolver: Resolver = resolverPorDefecto): Promise<{ ok: true; url: URL } | { ok: false; motivo: string }> {
  let url: URL;
  try {
    url = new URL(crudo);
  } catch {
    return { ok: false, motivo: "url_invalida" };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return { ok: false, motivo: "protocolo" };
  if (url.port && url.port !== "80" && url.port !== "443") return { ok: false, motivo: "puerto" };
  if (url.username || url.password) return { ok: false, motivo: "credenciales" };
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    return { ok: false, motivo: "host_interno" };
  }
  let ips: string[];
  try {
    ips = isIP(host) ? [host] : await resolver(host);
  } catch {
    return { ok: false, motivo: "dns" };
  }
  if (ips.length === 0 || ips.some(esIpPrivada)) return { ok: false, motivo: "ip_privada" };
  return { ok: true, url };
}

function decodificar(texto: string): string {
  return texto
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/\s+/g, " ")
    .trim();
}

function meta(html: string, nombres: string[]): string | null {
  for (const nombre of nombres) {
    const patrones = [
      new RegExp(`<meta[^>]+(?:property|name)=["']${nombre}["'][^>]*content=["']([^"']*)["']`, "i"),
      new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${nombre}["']`, "i"),
    ];
    for (const p of patrones) {
      const m = html.match(p);
      if (m?.[1]?.trim()) return decodificar(m[1]);
    }
  }
  return null;
}

/** Los metadatos del HTML (puro: se prueba sin red). */
export function leerMetadatos(html: string, base: URL): Omit<VistaPrevia, "url" | "sitio"> {
  const corto = (t: string | null, max: number) => (t && t.length > max ? `${t.slice(0, max - 1)}…` : t);
  const titulo = meta(html, ["og:title", "twitter:title"]) ?? (html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] ? decodificar(html.match(/<title[^>]*>([^<]*)<\/title>/i)![1]) : null);
  const descripcion = meta(html, ["og:description", "twitter:description", "description"]);
  let imagen = meta(html, ["og:image:secure_url", "og:image", "twitter:image"]);
  if (imagen) {
    try {
      const u = new URL(imagen, base);
      imagen = u.protocol === "https:" ? u.toString() : null;
    } catch {
      imagen = null;
    }
  }
  return { titulo: corto(titulo, 160), descripcion: corto(descripcion, 300), imagen };
}

export async function leerVistaPrevia(
  crudo: string,
  deps: { hacerFetch?: typeof fetch; resolver?: Resolver } = {},
): Promise<VistaPrevia | null> {
  const hacerFetch = deps.hacerFetch ?? fetch;
  let actual = crudo;

  for (let salto = 0; salto <= MAX_REDIRECCIONES; salto += 1) {
    const v = await validarUrl(actual, deps.resolver);
    if (!v.ok) return null;

    const controlador = new AbortController();
    const reloj = setTimeout(() => controlador.abort(), TIEMPO_MS);
    try {
      const r = await hacerFetch(v.url.toString(), {
        redirect: "manual",
        signal: controlador.signal,
        headers: { "User-Agent": "EOS-VistaPrevia/1.0 (+https://www.transtech.com.py)", Accept: "text/html" },
      });

      if (r.status >= 300 && r.status < 400) {
        const destino = r.headers.get("location");
        if (!destino) return null;
        actual = new URL(destino, v.url).toString();
        continue;
      }
      if (!r.ok || !/text\/html|application\/xhtml/i.test(r.headers.get("content-type") ?? "")) return null;

      // Solo los primeros 512 KB: los metadatos están en el <head>.
      const lector = r.body?.getReader();
      if (!lector) return null;
      const partes: Uint8Array[] = [];
      let total = 0;
      while (total < MAX_BYTES) {
        const { done, value } = await lector.read();
        if (done || !value) break;
        partes.push(value);
        total += value.length;
      }
      await lector.cancel().catch(() => {});
      const html = new TextDecoder("utf-8").decode(Buffer.concat(partes.map((p) => Buffer.from(p))).subarray(0, MAX_BYTES));

      return { url: v.url.toString(), sitio: v.url.hostname.replace(/^www\./, ""), ...leerMetadatos(html, v.url) };
    } catch {
      return null;
    } finally {
      clearTimeout(reloj);
    }
  }
  return null;
}
