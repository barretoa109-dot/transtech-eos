const ACCIONES_NEGOCIO_CON_APROBACION = new Set([
  "REGISTRAR_VENTA",
  "AJUSTAR_STOCK",
  "CREAR_CONTACTO",
]);

type AccionEOS = { tipo?: unknown };

export function agregarAccesoAprobacion(
  respuesta: string,
  acciones: AccionEOS[],
  origen: string,
): string {
  const requiereAprobacion = acciones.some((accion) =>
    ACCIONES_NEGOCIO_CON_APROBACION.has(String(accion?.tipo || "").trim().toUpperCase()),
  );

  if (!requiereAprobacion || respuesta.includes("/eos/autonomy")) return respuesta;

  return `${respuesta}\n\nPara completar el registro, revisá y aprobá la operación pendiente en ${origen}/eos/autonomy`;
}

/**
 * Que EOS no diga que hizo algo que no hizo.
 *
 * ============================================================
 * LO QUE PASÓ
 * ============================================================
 *
 * Una clienta usando EOS de verdad le pidió por chat que anotara un dato.
 * EOS contestó que sí, que ya estaba. No había anotado nada.
 *
 * Es la falla que el punto 15 de la lista de lanzamiento existe para impedir
 * —"nunca afirmar que realizó una acción que no se confirmó"— y es la peor de
 * todas las que puede tener un asistente. Un error de cálculo se corrige y se
 * perdona; que el asistente afirme con seguridad algo falso destruye la única
 * cosa que lo hace útil, que es poder creerle sin verificar.
 *
 * ============================================================
 * POR QUÉ SE ARREGLA ACÁ Y NO EN EL PROMPT
 * ============================================================
 *
 * La causa está en el modelo: se le pide algo, no tiene forma de hacerlo, y
 * contesta como contestaría una persona que quiere quedar bien. Se puede
 * mejorar el prompt —y hay que hacerlo, en n8n— pero un prompt es una súplica,
 * no una garantía: el mismo modelo que hoy obedece mañana no.
 *
 * Acá, en cambio, el servidor SABE algo que el modelo no puede falsificar: si
 * pidió una acción o no. Si el usuario pidió registrar algo, EOS dice que lo
 * registró, y no hay ni una sola acción en la respuesta, entonces la afirmación
 * es falsa con certeza. No es una heurística sobre el sentido del texto: es una
 * contradicción entre lo que dice y lo que hizo.
 *
 * ============================================================
 * LAS TRES CONDICIONES, Y POR QUÉ SON TRES
 * ============================================================
 *
 * Corregir de más también es mentir. Por eso hacen falta las tres:
 *
 *   1. el usuario PIDIÓ registrar, anotar, cargar o modificar algo;
 *   2. la respuesta AFIRMA haberlo hecho;
 *   3. no se pidió NINGUNA acción.
 *
 * Sin la primera, "ya lo anoté" podría referirse a algo de la conversación
 * anterior. Sin la tercera, la acción puede estar esperando aprobación, y para
 * eso está `agregarAccesoAprobacion`, que dice dónde completarla.
 */

/*
 * Los límites de palabra NO se escriben con `\b`.
 *
 * En JavaScript `\w` es solo ASCII, así que una "á" cuenta como carácter NO de
 * palabra. En "registrá esto", `\b` después de la "á" no encuentra límite —
 * porque a los dos lados hay caracteres que considera "no palabra"— y la
 * expresión no engancha nada.
 *
 * Es una trampa clásica escribiendo expresiones regulares en castellano, y acá
 * habría sido especialmente cara: la corrección nunca se habría disparado y el
 * arreglo se habría dado por hecho sin funcionar. Lo atraparon los tests.
 */
const ANTES = "(?<![a-záéíóúüñ])";
const DESPUES = "(?![a-záéíóúüñ])";

/** El usuario está pidiendo que se guarde o cambie algo. */
const PIDE_ESCRIBIR = new RegExp(
  ANTES +
    "(anot[aá]|anotar|registr[aá]|registrar|guard[aá]|guardar|carg[aá]|cargar|" +
    "agreg[aá]|agregar|sum[aá]|añad[ií]|modific[aá]|modificar|cambi[aá]|cambiar|" +
    "actualiz[aá]|actualizar|corregi|borr[aá]|borrar|elimin[aá]|eliminar|" +
    "pon[eé]|poner|cre[aá]|crear)" +
    DESPUES,
  "i",
);

/**
 * La respuesta afirma haberlo hecho, en primera persona y en pasado.
 *
 * Deliberadamente NO alcanza con "registrar" o "anotar" sueltos: "para
 * registrarlo, andá a la sección Negocio" es una instrucción correcta y no
 * puede dispararse una corrección sobre ella.
 */
const HECHO = "(registr|anot|guard|carg|agreg|actualic|actualiz|modific|modifiqu|cre)";

const AFIRMA_HABERLO_HECHO = new RegExp(
  "(" +
    // "ya quedó / ya está / ya lo registré / ya lo cargué"
    ANTES + "ya\\s+(lo|la|los|las)?\\s*(qued[óo]|est[áa]|" + HECHO + ")" +
    "|" +
    // "quedó registrado / quedó anotado"
    ANTES + "qued[óo]\\s+" + HECHO +
    "|" +
    // "lo registré / la anoté / los cargué"
    ANTES + "(lo|la|los|las)\\s+" + HECHO + "[ée]" +
    "|" +
    // "registré / anoté / actualicé", en primera persona y en pasado
    ANTES + HECHO + "[ée]" + DESPUES +
    "|" +
    // "listo, lo agregué a tus productos"
    ANTES + "listo" + "[^.!\\n]{0,40}" + HECHO +
    ")",
  "i",
);

export const AVISO_NO_REGISTRADO =
  "⚠️ **No lo registré.** Te lo dije como si estuviera hecho y no lo estaba — " +
  "perdón. Desde el chat, EOS solo puede registrar ventas, ajustar stock y crear " +
  "contactos, y siempre con tu aprobación. Todo lo demás se carga desde la sección " +
  "Negocio y ahí sí queda guardado.\n\nEsto es lo que te había contestado:";

/**
 * Antepone la corrección cuando la afirmación es falsa con certeza.
 *
 * Va ADELANTE y no al final a propósito: una corrección después de la mentira
 * se lee tarde, y para entonces la persona ya siguió con su día creyendo que
 * el dato quedó guardado.
 */
export function corregirAfirmacionSinAccion(
  respuesta: string,
  acciones: AccionEOS[],
  mensajeUsuario: string,
): string {
  if (acciones.length > 0) return respuesta;
  if (!PIDE_ESCRIBIR.test(mensajeUsuario)) return respuesta;
  if (!AFIRMA_HABERLO_HECHO.test(respuesta)) return respuesta;
  if (respuesta.includes(AVISO_NO_REGISTRADO)) return respuesta;

  return `${AVISO_NO_REGISTRADO}\n\n${respuesta}`;
}
