import { costoDelMensaje, tarifasDelEntorno, tokensDeUsage } from "../eos/costo-mensaje.ts";

/**
 * Leer un comprobante de transferencia que un cliente mandó por WhatsApp.
 *
 * ============================================================
 * PARA QUÉ ES ESTO
 * ============================================================
 *
 * Un cliente que ya pagó manda la foto del comprobante al WhatsApp de la
 * empresa. Hasta ahora esa foto se registraba en el CRM como un mensaje más
 * —tipo "imagen", sin leer— y el dueño tenía que mirarla él mismo y anotar el
 * cobro a mano. Esto lee el monto, la moneda y la fecha de la imagen, para
 * que `comprobante-cobro.ts` pueda proponerle al dueño un cobro ya armado en
 * vez de una foto suelta.
 *
 * ============================================================
 * ESTÁ APAGADO HASTA QUE LA EMPRESA DECIDA (mismo criterio que intencion-ia.ts)
 * ============================================================
 *
 * Mandar la FOTO de un cliente a un proveedor de IA es una decisión de la
 * empresa, no de quien programó esto. Por eso corre solo con
 * `EOS_COMPROBANTE_IA=1`. Sin esa variable, la foto se sigue registrando
 * como siempre, sin leerse.
 *
 * ============================================================
 * NUNCA COBRA SOLO
 * ============================================================
 *
 * Esta función SOLO lee la imagen. No busca ninguna venta, no marca nada
 * como cobrado, no manda ningún mensaje. Un comprobante se puede falsificar
 * con un editor de fotos, así que lo que salga de acá es una PROPUESTA que
 * `comprobante-cobro.ts` le arma al dueño para que la confirme con un "sí" —
 * nunca un hecho.
 */

export const MODELO_COMPROBANTE_DEFECTO = "gpt-5-mini";
export const PLAZO_MS = 10_000;

const OPENAI_URL = "https://api.openai.com/v1/responses";

export type ComprobanteLeido = {
  monto: number;
  moneda: "PYG" | "USD";
  /** AAAA-MM-DD si la imagen trae una fecha legible; si no, null (se usa la de hoy). */
  fecha: string | null;
};

export type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

/** ¿Está encendido? Hace falta la variable Y la clave, igual que el clasificador de intención. */
export function comprobanteIaHabilitada(env: Record<string, string | undefined> = process.env): boolean {
  return env.EOS_COMPROBANTE_IA === "1" && Boolean((env.OPENAI_API_KEY ?? "").trim());
}

const INSTRUCCIONES = [
  "Te llega UNA imagen que un cliente le mandó por WhatsApp a una PYME de Paraguay.",
  "Puede ser un comprobante de transferencia o depósito bancario, o puede ser cualquier otra foto",
  "(un producto, una factura de compra, algo sin relación). Contestá SOLO con un JSON, sin texto alrededor:",
  '{"es_comprobante": <true o false>, "monto": <número o null>, "moneda": "PYG" o "USD" o null, "fecha": "AAAA-MM-DD" o null}',
  "",
  "es_comprobante: true SOLO si es claramente un comprobante de transferencia, depósito o pago bancario",
  "(una app de banco, un recibo de cooperativa, un ticket de depósito). Ante la duda, false.",
  "monto: el importe transferido, tal como aparece, sin separadores de miles (139000, no 139.000).",
  "moneda: PYG si son guaraníes (el caso normal en Paraguay) o si no se aclara; USD solo si dice dólares.",
  "fecha: la fecha de la operación si se lee en la imagen; si no se ve clara, null.",
  "",
  "No inventes ningún número que no puedas leer. Si la imagen no se entiende o es otra cosa,",
  'contestá {"es_comprobante": false, "monto": null, "moneda": null, "fecha": null}.',
].join("\n");

/** Saca el JSON de la respuesta del modelo, sea cual sea la forma en que la devuelva. */
export function leerRespuesta(cuerpo: unknown): ComprobanteLeido | null {
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

  let datos: { es_comprobante?: unknown; monto?: unknown; moneda?: unknown; fecha?: unknown };
  try {
    datos = JSON.parse(texto.slice(inicio, fin + 1));
  } catch {
    return null;
  }

  if (datos.es_comprobante !== true) return null;

  const monto = Number(datos.monto);
  if (!Number.isFinite(monto) || monto <= 0) return null;

  const moneda = datos.moneda === "USD" ? "USD" : "PYG";

  const fecha =
    typeof datos.fecha === "string" && /^\d{4}-\d{2}-\d{2}$/.test(datos.fecha) ? datos.fecha : null;

  return { monto, moneda, fecha };
}

export type OpcionesComprobante = {
  fetcher?: Fetcher;
  env?: Record<string, string | undefined>;
  plazoMs?: number;
  /** Lo que costó la lectura en dólares, para sumarlo al consumo del dueño del canal (mismo criterio que v202). */
  alCosto?: (usd: number) => void;
};

/**
 * Lee una imagen en busca de un comprobante. Devuelve `null` ante cualquier
 * problema, o si la imagen no es un comprobante: nunca lanza, nunca deja
 * esperando al webhook.
 */
export async function leerComprobante(
  dataUrl: string,
  opciones: OpcionesComprobante = {},
): Promise<ComprobanteLeido | null> {
  const env = opciones.env ?? process.env;
  if (!comprobanteIaHabilitada(env)) return null;

  const fetcher = opciones.fetcher ?? fetch;
  const clave = (env.OPENAI_API_KEY ?? "").trim();

  const controlador = new AbortController();
  const reloj = setTimeout(() => controlador.abort(), opciones.plazoMs ?? PLAZO_MS);

  try {
    const respuesta = await fetcher(OPENAI_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${clave}` },
      body: JSON.stringify({
        model: (env.EOS_COMPROBANTE_MODELO ?? "").trim() || MODELO_COMPROBANTE_DEFECTO,
        input: [
          { role: "system", content: [{ type: "input_text", text: INSTRUCCIONES }] },
          { role: "user", content: [{ type: "input_image", image_url: dataUrl }] },
        ],
      }),
      signal: controlador.signal,
      cache: "no-store",
    });

    // El cuerpo NO se registra: trae de vuelta la lectura de una foto de un cliente.
    if (!respuesta.ok) {
      console.error("Comprobante IA: el proveedor respondió", respuesta.status);
      return null;
    }

    const datos = (await respuesta.json()) as { usage?: unknown };
    const costo = costoDelMensaje(tokensDeUsage(datos?.usage), tarifasDelEntorno(env));
    if (costo > 0) opciones.alCosto?.(costo);

    return leerRespuesta(datos);
  } catch (error) {
    console.error(
      "Comprobante IA: no se pudo consultar:",
      error instanceof Error && error.name === "AbortError" ? "timeout" : "error de red",
    );
    return null;
  } finally {
    clearTimeout(reloj);
  }
}
