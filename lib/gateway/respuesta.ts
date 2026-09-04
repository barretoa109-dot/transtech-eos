/**
 * Etapa 1: leer lo que devolvió OpenAI.
 *
 * Puerto del nodo `05 GW Preparar Respuesta`, la pieza más frágil de las que
 * se mueven: seis formas distintas de encontrar el texto, un JSON que el
 * modelo puede haber envuelto en un bloque de código, y una lista blanca de
 * acciones que es lo único que separa "el modelo pidió algo" de "el modelo
 * inventó una acción que no existe".
 *
 * ============================================================
 * LA LISTA BLANCA NO ES UNA VALIDACIÓN MÁS
 * ============================================================
 *
 * Una acción que no está en `ACCIONES_PERMITIDAS` se descarta en silencio, no
 * se reporta como error. Es a propósito: el modelo a veces inventa un
 * `ENVIAR_EMAIL` que nadie implementó, y frenar la conversación entera por eso
 * dejaría a la persona sin respuesta por algo que no hizo. Se responde el
 * texto y se ignora lo que no existe.
 *
 * Ninguna de las tres acciones del negocio —REGISTRAR_VENTA, AJUSTAR_STOCK,
 * CREAR_CONTACTO— se ejecuta sola: la puerta de autonomía les exige
 * aprobación explícita. Ver `SYSTEM_RISK` en `lib/worker-gate-handler.ts`.
 */

import type { Entrada } from "./entrada.ts";

export const ACCIONES_PERMITIDAS = new Set([
  "GENERAR_EXCEL",
  "GENERAR_PDF",
  "GENERAR_WORD",
  "CREAR_TAREA",
  "CREAR_OBJETIVO",
  "GUARDAR_MEMORIA",
  "VER_DASHBOARD",
  "VER_BRIEFING",
  "REGISTRAR_VENTA",
  "AJUSTAR_STOCK",
  "CREAR_CONTACTO",
]);

const ACCIONES_DE_ARCHIVO = new Set(["GENERAR_EXCEL", "GENERAR_PDF", "GENERAR_WORD"]);

export type Accion = { tipo: string; datos: Record<string, unknown> };

export type RespuestaGateway = {
  respuesta: string;
  documento: Record<string, unknown> | null;
  acciones: Accion[];
  /** Cuando es false, la conversación es pura y no hace falta el worker. */
  requiere_worker: boolean;
  tipo: string;
  accion: string;
  archivo_url: string;
  archivo_tipo: string;
  archivo_nombre: string;
  tokens_entrada: number;
  tokens_salida: number;
  metadata: Record<string, unknown>;
};

export const SIN_INTERPRETAR =
  "Recibí tu mensaje, pero no pude interpretar correctamente la respuesta.";

/**
 * Encuentra el texto adentro de la respuesta de la Responses API.
 *
 * El camino bueno es `output → message → content → output_text → text`. Los
 * otros cinco son compatibilidad con formatos que la API devolvió alguna vez
 * o que devuelve cuando algo sale distinto. Se conservan todos: perder el
 * texto porque cambió un envoltorio deja a la persona sin respuesta.
 */
export function extraerTexto(data: unknown): string {
  if (data === null || data === undefined) return "";
  if (typeof data === "string") return data;

  if (Array.isArray(data)) {
    for (const item of data) {
      const texto = extraerTexto(item);
      if (texto.trim()) return texto;
    }
    return "";
  }

  if (typeof data !== "object") return "";

  const o = data as Record<string, unknown>;

  if (Array.isArray(o.output)) {
    for (const bloque of o.output) {
      if (
        bloque &&
        typeof bloque === "object" &&
        (bloque as Record<string, unknown>).type === "message" &&
        Array.isArray((bloque as Record<string, unknown>).content)
      ) {
        for (const parte of (bloque as { content: unknown[] }).content) {
          if (
            parte &&
            typeof parte === "object" &&
            (parte as Record<string, unknown>).type === "output_text" &&
            typeof (parte as Record<string, unknown>).text === "string"
          ) {
            return (parte as { text: string }).text;
          }
        }
      }
    }
  }

  for (const campo of ["output_text", "text", "respuesta", "response", "message"] as const) {
    if (typeof o[campo] === "string") return o[campo] as string;
  }

  if (o.content) {
    const texto = extraerTexto(o.content);
    if (texto) return texto;
  }

  return "";
}

/** Saca los cercos de bloque de código que el modelo agrega de vez en cuando. */
export function sinCercos(texto: string): string {
  return texto
    .replace(/```json/gi, "")
    .replace(/```javascript/gi, "")
    .replace(/```js/gi, "")
    .replace(/```/g, "")
    .trim();
}

/**
 * Normaliza lo que devolvió el modelo a la forma que consume
 * `app/api/eos/route.ts`.
 *
 * La forma es la misma que devuelve n8n hoy, y eso es lo que permite prender
 * y apagar la bandera sin tocar el cliente ni el resto de la ruta.
 */
export function prepararRespuesta(entrada: Entrada, ai: unknown): RespuestaGateway {
  const datosAi = (ai && typeof ai === "object" ? ai : {}) as Record<string, unknown>;
  const usage = (datosAi.usage ?? {}) as Record<string, unknown>;

  /*
   * Se pasan los TOKENS y no un costo en dólares: el precio por token cambia
   * y ponerlo acá sería inventar un número que después nadie corrige.
   */
  const tokens_entrada = Number(usage.input_tokens ?? usage.prompt_tokens ?? 0) || 0;
  const tokens_salida = Number(usage.output_tokens ?? usage.completion_tokens ?? 0) || 0;

  const crudo = sinCercos(extraerTexto(ai));

  let resultado: Record<string, unknown>;
  try {
    const parseado = JSON.parse(crudo);
    // Un JSON válido que no es un objeto —un número, un array— no es una
    // respuesta: se trata como si el modelo hubiera contestado en prosa.
    resultado =
      parseado && typeof parseado === "object" && !Array.isArray(parseado)
        ? (parseado as Record<string, unknown>)
        : { respuesta: crudo, acciones: [] };
  } catch {
    // Si el modelo contesta prosa en vez de JSON, no se rompe el gateway: se
    // usa la prosa como respuesta, que es lo que la persona quería igual.
    resultado = { respuesta: crudo || SIN_INTERPRETAR, acciones: [] };
  }

  const respuesta =
    typeof resultado.respuesta === "string" && resultado.respuesta.trim()
      ? resultado.respuesta.trim()
      : "Recibí tu solicitud.";

  const acciones: Accion[] = Array.isArray(resultado.acciones)
    ? (resultado.acciones as unknown[])
        .map((a) => {
          const obj = (a && typeof a === "object" ? a : {}) as Record<string, unknown>;
          const datos = obj.datos;
          return {
            tipo: String(obj.tipo ?? "").trim().toUpperCase(),
            datos:
              datos && typeof datos === "object" && !Array.isArray(datos)
                ? (datos as Record<string, unknown>)
                : {},
          };
        })
        .filter((a) => ACCIONES_PERMITIDAS.has(a.tipo))
    : [];

  const doc = resultado.documento;
  const documento =
    doc &&
    typeof doc === "object" &&
    !Array.isArray(doc) &&
    typeof (doc as Record<string, unknown>).titulo === "string" &&
    Array.isArray((doc as Record<string, unknown>).bloques)
      ? (doc as Record<string, unknown>)
      : null;

  /*
   * Con documento se descartan las acciones de generar archivo: son el mismo
   * pedido por dos caminos, y dejando las dos la persona recibe dos archivos
   * distintos —uno armado por EOS y otro con la plantilla genérica del
   * worker— por una sola pregunta.
   */
  const finales = documento ? acciones.filter((a) => !ACCIONES_DE_ARCHIVO.has(a.tipo)) : acciones;

  return {
    respuesta,
    documento,
    acciones: finales,
    requiere_worker: finales.length > 0,
    tipo: "texto",
    accion: finales.length > 0 ? finales[0].tipo : "RESPONDER",
    archivo_url: "",
    archivo_tipo: "",
    archivo_nombre: "",
    tokens_entrada,
    tokens_salida,
    metadata: {
      plan: entrada.plan || "free",
      origen: entrada.origen || "eos-web",
      cantidad_acciones: finales.length,
      tiene_archivo: entrada.tiene_archivo,
      archivo_entrada_nombre: entrada.archivo_nombre,
      archivo_entrada_tipo: entrada.archivo_tipo,
      imagen_analizada: entrada.archivo_categoria === "imagen" && entrada.imagen_data_url !== "",
      openai_response_id: String(datosAi.id ?? ""),
      openai_status: String(datosAi.status ?? ""),
      openai_model: String(datosAi.model ?? ""),
      // Marca de qué camino salió la respuesta. Sin esto, comparar los dos
      // caminos sobre tráfico real exige adivinar cuál atendió cada mensaje.
      gateway: "ts",
    },
  };
}
