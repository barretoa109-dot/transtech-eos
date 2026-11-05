import { costoDelMensaje, tarifasDelEntorno, tokensDeUsage } from "../eos/costo-mensaje.ts";

/**
 * Leer el KuDE (la representación impresa de una factura electrónica
 * paraguaya) que un proveedor reenvía por correo a la PyME.
 *
 * ============================================================
 * PARA QUÉ ES ESTO
 * ============================================================
 *
 * Pilar 3 del documento de visión del 04/11: "dueños de PyMEs que aún
 * facturan en papel sacan una foto y el sistema extrae todo". La mitad
 * "cliente le saca una foto a un ticket y se lo manda a EOS por el chat" ya
 * existe (el gateway manda la imagen directo al modelo, ver
 * `lib/gateway/prompt.ts`). Esto es la otra mitad: cuando un PROVEEDOR ya
 * factura electrónicamente y manda el comprobante por correo, no hace falta
 * que el dueño lo transcriba a mano — se lee solo.
 *
 * No se parsea el XML del Documento Electrónico de SIFEN: ese schema no está
 * verificado contra ningún ejemplo real en este repo (solo existe el CDC y
 * un comprobante impreso — ver `docs/estrategia/eos-facturacion-sifen` en la
 * memoria del proyecto), y adivinar los nombres de campo de un estándar
 * tributario es el tipo de error que lee mal un monto en silencio. Se lee el
 * KuDE (PDF o foto) con el mismo criterio con que ya se leen comprobantes de
 * pago y tickets de WhatsApp: una lectura con visión, nunca un parser que
 * promete exactitud que no tiene.
 *
 * ============================================================
 * ESTÁ APAGADO HASTA QUE LA EMPRESA DECIDA
 * ============================================================
 *
 * Mismo criterio que `comprobante.ts`: mandar el documento de un proveedor a
 * un proveedor de IA es una decisión de la empresa. Corre solo con
 * `EOS_FACTURAS_IA=1`.
 *
 * ============================================================
 * NUNCA REGISTRA SOLO
 * ============================================================
 *
 * Esta función SOLO lee. Lo que devuelve es una PROPUESTA de compra que el
 * dueño confirma con un toque — un KuDE se puede falsificar o leer mal, y la
 * compra que sale de acá mueve stock y plata real.
 */

export const MODELO_KUDE_DEFECTO = "gpt-5-mini";
export const PLAZO_MS = 20_000;

const OPENAI_URL = "https://api.openai.com/v1/responses";

export type FacturaLeida = {
  ruc_emisor: string | null;
  razon_social_emisor: string | null;
  numero_documento: string | null;
  cdc: string | null;
  /** AAAA-MM-DD, o null si no se lee con claridad (se usa la fecha del correo). */
  fecha: string | null;
  moneda: "PYG" | "USD";
  /** Total final, IVA incluido — así se escriben los precios en Paraguay. */
  total: number;
  /**
   * Tasa dominante del documento, para una compra de un solo ítem. Si el KuDE
   * mezcla tasas (algunos ítems al 10%, otros exentos) esto es una
   * aproximación: el dueño puede corregirla al confirmar, nunca se inventa
   * un desglose que no se leyó.
   */
  iva_tasa: 0 | 5 | 10;
};

export type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

export function kudeIaHabilitada(env: Record<string, string | undefined> = process.env): boolean {
  return env.EOS_FACTURAS_IA === "1" && Boolean((env.OPENAI_API_KEY ?? "").trim());
}

const INSTRUCCIONES = [
  "Te llega el KuDE (representación impresa de una factura electrónica paraguaya)",
  "que un proveedor le mandó por correo a una PYME. Puede venir como texto extraído",
  "de un PDF o como una foto. Contestá SOLO con un JSON, sin texto alrededor:",
  '{"es_factura": <true o false>, "ruc_emisor": <string o null>, "razon_social_emisor": <string o null>,',
  ' "numero_documento": <string o null>, "cdc": <string o null>, "fecha": "AAAA-MM-DD" o null,',
  ' "moneda": "PYG" o "USD", "total": <número o null>, "iva_tasa": 0, 5 o 10}',
  "",
  "es_factura: true SOLO si es claramente una factura o KuDE (RUC del emisor, timbrado o",
  "código de control visibles). Ante la duda, false.",
  "ruc_emisor: el RUC de quien EMITE (vende), con su dígito verificador si se ve (\"80012345-6\").",
  "numero_documento: el número de la factura (\"001-001-0000123\" o similar).",
  "cdc: el Código de Control de 44 dígitos si aparece impreso.",
  "total: el importe TOTAL final de la factura, tal como figura, sin separadores de miles.",
  "moneda: PYG si son guaraníes o no se aclara; USD solo si dice dólares.",
  "iva_tasa: la tasa de IVA que domina el documento (la mayoría de las líneas o el total",
  "gravado más grande). 0 si está exonerada o no se puede leer el IVA.",
  "",
  "No inventes ningún dato que no puedas leer (usá null). Si no es una factura,",
  'contestá {"es_factura": false, "ruc_emisor": null, "razon_social_emisor": null,',
  '"numero_documento": null, "cdc": null, "fecha": null, "moneda": "PYG", "total": null, "iva_tasa": 0}.',
].join("\n");

/** Saca el JSON de la respuesta del modelo, sea cual sea la forma en que la devuelva. */
export function leerRespuestaKude(cuerpo: unknown): FacturaLeida | null {
  const c = cuerpo as { output_text?: unknown; output?: { content?: { text?: unknown }[] }[] } | null;

  const texto =
    typeof c?.output_text === "string"
      ? c.output_text
      : (c?.output ?? [])
          .flatMap((o) => o?.content ?? [])
          .map((x) => (typeof x?.text === "string" ? x.text : ""))
          .join("");

  const inicio = texto.indexOf("{");
  const fin = texto.lastIndexOf("}");
  if (inicio < 0 || fin <= inicio) return null;

  let datos: Record<string, unknown>;
  try {
    datos = JSON.parse(texto.slice(inicio, fin + 1));
  } catch {
    return null;
  }

  if (datos.es_factura !== true) return null;

  const total = Number(datos.total);
  if (!Number.isFinite(total) || total <= 0) return null;

  const cadena = (v: unknown, max: number) =>
    typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;

  const moneda = datos.moneda === "USD" ? "USD" : "PYG";
  const ivaTasa = datos.iva_tasa === 10 || datos.iva_tasa === 5 ? datos.iva_tasa : 0;
  const fecha =
    typeof datos.fecha === "string" && /^\d{4}-\d{2}-\d{2}$/.test(datos.fecha) ? datos.fecha : null;

  return {
    ruc_emisor: cadena(datos.ruc_emisor, 20),
    razon_social_emisor: cadena(datos.razon_social_emisor, 200),
    numero_documento: cadena(datos.numero_documento, 40),
    cdc: cadena(datos.cdc, 44),
    fecha,
    moneda,
    total,
    iva_tasa: ivaTasa,
  };
}

export type EntradaKude =
  | { tipo: "texto"; contenido: string }
  | { tipo: "imagen"; mime: string; base64: string };

export type OpcionesKude = {
  fetcher?: Fetcher;
  env?: Record<string, string | undefined>;
  plazoMs?: number;
  alCosto?: (usd: number) => void;
};

/**
 * Lee un KuDE. Devuelve `null` ante cualquier problema, o si no es una
 * factura: nunca lanza.
 */
export async function leerKude(entrada: EntradaKude, opciones: OpcionesKude = {}): Promise<FacturaLeida | null> {
  const env = opciones.env ?? process.env;
  if (!kudeIaHabilitada(env)) return null;
  if (entrada.tipo === "texto" && !entrada.contenido.trim()) return null;
  if (entrada.tipo === "imagen" && (!entrada.mime.startsWith("image/") || !entrada.base64)) return null;

  const fetcher = opciones.fetcher ?? fetch;
  const clave = (env.OPENAI_API_KEY ?? "").trim();

  const controlador = new AbortController();
  const reloj = setTimeout(() => controlador.abort(), opciones.plazoMs ?? PLAZO_MS);

  const contenido =
    entrada.tipo === "texto"
      ? [{ type: "input_text", text: `${INSTRUCCIONES}\n\n--- TEXTO DEL PDF ---\n${entrada.contenido.slice(0, 12_000)}` }]
      : [
          { type: "input_text", text: INSTRUCCIONES },
          { type: "input_image", image_url: `data:${entrada.mime};base64,${entrada.base64}` },
        ];

  try {
    const respuesta = await fetcher(OPENAI_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${clave}` },
      body: JSON.stringify({
        model: (env.EOS_FACTURAS_MODELO ?? "").trim() || MODELO_KUDE_DEFECTO,
        input: [{ role: "user", content: contenido }],
      }),
      signal: controlador.signal,
      cache: "no-store",
    });

    if (!respuesta.ok) {
      console.error("KuDE: el proveedor de IA respondió", respuesta.status);
      return null;
    }

    const datos = (await respuesta.json()) as { usage?: unknown };
    const costo = costoDelMensaje(tokensDeUsage(datos?.usage), tarifasDelEntorno(env));
    if (costo > 0) opciones.alCosto?.(costo);

    return leerRespuestaKude(datos);
  } catch (error) {
    console.error(
      "KuDE: no se pudo leer:",
      error instanceof Error && error.name === "AbortError" ? "timeout" : "error de red",
    );
    return null;
  } finally {
    clearTimeout(reloj);
  }
}
