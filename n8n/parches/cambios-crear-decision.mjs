/**
 * CREAR_DECISION: que el chat registre una decisión explícita (08/10/2026).
 *
 * ============================================================
 * QUÉ FALTABA
 * ============================================================
 *
 * `eos_decisions` se llena hoy por una sola vía: el workflow de n8n
 * "EOS 3.0 - Registro de Decisiones y Resultados v6", que le pregunta a un
 * modelo chico si hubo una decisión DESPUÉS de cada conversación. Es
 * extracción pasiva, y el 21/09/2026 se endureció su prompt porque la mitad
 * de lo que detectaba eran operaciones con su propio registro (una venta,
 * una compra), no decisiones de fondo.
 *
 * Esto no toca esa extracción. Agrega el camino que seguía sin existir:
 * alguien le PIDE a EOS que anote una decisión, y lo hace porque se lo
 * pidieron, no porque un clasificador la adivinó. La migración v236 ya tiene
 * la función y el ejecutor; esto es lo que falta para que el modelo sepa que
 * puede pedirla.
 *
 * ============================================================
 * QUÉ CAMBIA
 * ============================================================
 *
 * Dos puntos del prompt: la lista corta de acciones permitidas (agrega
 * CREAR_DECISION después de ENVIAR_WHATSAPP_CLIENTE) y su bloque de datos,
 * agregado después de REGISTRAR_OPORTUNIDAD —misma familia, CRM y
 * decisiones del negocio— con la MISMA regla que ya hizo falta endurecer del
 * lado de n8n: una operación con su propio verbo no es una decisión.
 *
 * El prompt no puede tener comillas invertidas ni `${`: vive dentro de un
 * literal de plantilla de JavaScript (ver `verificar.mjs`).
 *
 * ============================================================
 * EL CUARTO LUGAR: LA LISTA BLANCA DEL WORKER DE N8N
 * ============================================================
 *
 * `lib/gateway/alta-de-acciones.test.ts` ya lo marca como el lugar que más
 * veces costó un incidente real (REGISTRAR_VENTA, AJUSTAR_STOCK y
 * CREAR_CONTACTO se rechazaban acá, antes de pedir autorización, durante dos
 * semanas de agosto de 2026). Sin este cambio, un día que el gateway en
 * TypeScript cayera a n8n, CREAR_DECISION se rechazaría en silencio: el chat
 * diría que entendió y no quedaría ni una fila para auditar por qué no pasó
 * nada.
 */

/** Marca que dice que el cambio ya está. Evita aplicarlo dos veces. */
export const MARCA = "CREAR_DECISION\n  datos: { decision,";

/** Marca del lado del worker: la lista blanca, no el prompt. */
export const MARCA_WORKER = "'CREAR_DECISION',\n])";

export const CAMBIOS_PROMPT = [
  {
    donde: "la lista corta de acciones permitidas",
    viejo: "ENVIAR_WHATSAPP_CLIENTE\n\nAcciones del negocio",
    nuevo: "ENVIAR_WHATSAPP_CLIENTE\nCREAR_DECISION\n\nAcciones del negocio",
  },
  {
    donde: "el bloque de datos, después de REGISTRAR_OPORTUNIDAD",
    viejo: "no se inventa.\n\nREGISTRAR_GASTO_FIJO",
    nuevo: [
      "no se inventa.",
      "",
      "CREAR_DECISION",
      "  datos: { decision, titulo?, razon?, resultado_esperado?, metrica?,",
      "           valor_base?, valor_objetivo?, unidad?, fecha_revision? }",
      "  Una decisión de negocio, para poder revisarla después y aprender si",
      "  funcionó. \"Decidí subir el precio del combo a 150.000\", \"vamos a",
      "  dejar de vender al fiado los fines de semana\", \"elegí quedarme con",
      "  el proveedor de Asunción aunque sale más caro\".",
      "  decision es lo único obligatorio: lo que se decidió, con tus",
      "  palabras. titulo es un resumen corto; si no lo decís, se recorta",
      "  de decision.",
      "  NO ES PARA UNA OPERACIÓN QUE YA TIENE SU PROPIO VERBO. Una venta es",
      "  REGISTRAR_VENTA, un gasto es REGISTRAR_MOVIMIENTO_PERSONAL o",
      "  REGISTRAR_GASTO_FIJO, una compra es REGISTRAR_COMPRA. CREAR_DECISION",
      "  es para la ELECCIÓN de fondo detrás de esas operaciones, no para la",
      "  operación en sí. Ante la duda entre un verbo del negocio y",
      "  CREAR_DECISION, es el verbo del negocio.",
      "  Si la persona dice qué va a medir para saber si funcionó, mandalo en",
      "  metrica, valor_base (lo de ahora) y valor_objetivo (lo que espera).",
      "  No inventes ninguno de los tres si no te lo dijo.",
      "",
      "REGISTRAR_GASTO_FIJO",
    ].join("\n"),
  },
];

/**
 * Aplica el cambio al texto del prompt. Si la marca ya está, no toca nada.
 * Si el texto viejo no aparece exactamente una vez, no escribe nada y avisa.
 */
export function aplicarPrompt(texto, etiqueta) {
  if (texto.includes(MARCA)) return texto;
  let salida = texto;
  for (const c of CAMBIOS_PROMPT) {
    const partes = salida.split(c.viejo);
    if (partes.length !== 2) {
      throw new Error(
        `[${etiqueta}] "${c.donde}": el texto aparece ${partes.length - 1} veces, no 1. No se escribió nada.`,
      );
    }
    salida = partes.join(c.nuevo);
  }
  return salida;
}

/**
 * Agrega CREAR_DECISION a la lista blanca del nodo `01 INT Preparar` del
 * worker. Mismo criterio de idempotencia que `aplicarPrompt`.
 */
export function aplicarListaWorker(codigo, etiqueta) {
  if (codigo.includes(MARCA_WORKER)) return codigo;

  const viejo = "'ENVIAR_WHATSAPP_CLIENTE'\n])";
  const nuevo = "'ENVIAR_WHATSAPP_CLIENTE',\n  'CREAR_DECISION',\n])";

  const partes = codigo.split(viejo);
  if (partes.length !== 2) {
    throw new Error(
      `[${etiqueta}] la lista blanca del worker: el texto aparece ${partes.length - 1} veces, no 1. No se escribió nada.`,
    );
  }
  return partes.join(nuevo);
}
