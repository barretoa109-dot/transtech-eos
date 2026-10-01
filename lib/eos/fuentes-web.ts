/**
 * Una respuesta con búsqueda web, leída para mostrarla bien (01/10/2026).
 *
 * El servidor guarda la respuesta como texto (lib/busqueda/sintesis.ts):
 *
 *     🔎 Busqué en la web el 01/10/2026 · Paraguay.
 *     …cuerpo con marcas [1] [2]…
 *     Fuentes:
 *     [1] Título — sitio
 *     https://…
 *
 * Así queda en el historial y el modelo la entiende en el turno siguiente
 * ("¿y cuál me conviene?"). Para MOSTRARLA, cada canal la presenta a su manera:
 * la web con números tocables y tarjetas de vista previa; WhatsApp con
 * superíndices. Esto la separa en partes; ninguna parte se inventa.
 */

export type FuenteWeb = { n: number; titulo: string; sitio: string; url: string };

export type RespuestaConFuentes = {
  /** "01/10/2026" y "Paraguay", si vino el encabezado. */
  fecha: string | null;
  lugar: string | null;
  cuerpo: string;
  fuentes: FuenteWeb[];
  /** "Fuentes consultadas" cuando no se pudo atribuir cada dato. */
  soloConsultadas: boolean;
};

const ENCABEZADO = /^🔎\s*Busqué en la web el (\d{2}\/\d{2}\/\d{4})\s*(?:·\s*([^.\n]+?)|\(([^)\n]+)\))\.?\s*$/m;
const TITULO_FUENTES = /^\s*(Fuentes|Fuentes consultadas):\s*$/m;

/** null si el texto no es una respuesta con búsqueda web. */
export function leerRespuestaConFuentes(texto: string): RespuestaConFuentes | null {
  const titulo = texto.match(TITULO_FUENTES);
  if (!titulo || titulo.index === undefined) return null;

  const antes = texto.slice(0, titulo.index);
  const despues = texto.slice(titulo.index + titulo[0].length);

  const fuentes: FuenteWeb[] = [];
  const lineas = despues.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (let i = 0; i < lineas.length; i += 1) {
    const m = lineas[i].match(/^\[(\d{1,2})\]\s+(.+?)(?:\s+—\s+([^\s—]+))?$/);
    const url = lineas[i + 1];
    if (m && url && /^https?:\/\/\S+$/.test(url)) {
      fuentes.push({ n: Number(m[1]), titulo: m[2].trim(), sitio: (m[3] ?? sitioDe(url)).trim(), url });
      i += 1;
    }
  }
  if (fuentes.length === 0) return null;

  const enc = antes.match(ENCABEZADO);
  const cuerpo = (enc ? antes.replace(ENCABEZADO, "") : antes).trim();

  return {
    fecha: enc?.[1] ?? null,
    lugar: (enc?.[2] ?? enc?.[3] ?? "").trim() || null,
    cuerpo,
    fuentes,
    soloConsultadas: titulo[1] === "Fuentes consultadas",
  };
}

export function sitioDe(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

export type TrozoConCita = { tipo: "texto"; texto: string } | { tipo: "cita"; n: number };

/** El texto partido en trozos y citas: "a 58.000 [1][2]." → texto, cita 1, cita 2, texto. */
export function partirCitas(texto: string, validas: Set<number>): TrozoConCita[] {
  const trozos: TrozoConCita[] = [];
  let ultimo = 0;
  for (const m of texto.matchAll(/\s?\[(\d{1,2})\]/g)) {
    const n = Number(m[1]);
    if (!validas.has(n)) continue;
    const inicio = m.index ?? 0;
    if (inicio > ultimo) trozos.push({ tipo: "texto", texto: texto.slice(ultimo, inicio) });
    trozos.push({ tipo: "cita", n });
    ultimo = inicio + m[0].length;
  }
  if (ultimo < texto.length) trozos.push({ tipo: "texto", texto: texto.slice(ultimo) });
  return trozos;
}

const SUPERINDICE: Record<string, string> = { "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹" };

function superindice(n: number): string {
  return String(n).replace(/\d/g, (d) => SUPERINDICE[d]);
}

/**
 * Para WhatsApp (texto plano): sin corchetes ni paréntesis. Las citas van como
 * superíndice pegado al dato, y cada fuente con su número, nombre y enlace.
 */
export function respuestaParaWhatsapp(texto: string): string {
  const r = leerRespuestaConFuentes(texto);
  if (!r) return texto;
  const validas = new Set(r.fuentes.map((f) => f.n));
  const cuerpo = partirCitas(r.cuerpo, validas)
    .map((t) => (t.tipo === "texto" ? t.texto : superindice(t.n)))
    .join("");
  const encabezado = r.fecha ? `🔎 Busqué en la web el ${r.fecha}${r.lugar ? ` · ${r.lugar}` : ""}` : "";
  const lista = r.fuentes.map((f) => `${superindice(f.n)} ${f.titulo} · ${f.sitio}\n${f.url}`).join("\n");
  return [encabezado, cuerpo, `*${r.soloConsultadas ? "Fuentes consultadas" : "Fuentes"}*\n${lista}`]
    .filter(Boolean)
    .join("\n\n");
}
