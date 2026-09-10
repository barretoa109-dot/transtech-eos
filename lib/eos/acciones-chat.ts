import {
  ACCIONES_DURABLES,
  huboEfecto,
  type VerificacionDeAccion,
} from "./verificacion.ts";

type AccionEOS = { tipo?: unknown };

/**
 * ¿El modelo pidió algo que deja un efecto durable?
 *
 * Antes esto se llamaba `requiereAprobacion` y miraba una lista escrita a mano
 * con tres acciones —venta, stock, contacto— cuando ya había doce. Nueve
 * quedaban sin verificar: una compra, un pago de deuda, una corrección podían
 * fallar sin que nadie lo dijera.
 *
 * Y el nombre mentía desde el 3 de septiembre: estas acciones ya NO requieren
 * aprobación, se ejecutan solas. Lo que sí requieren es que alguien compruebe
 * qué pasó con ellas. Ver `lib/eos/verificacion.ts`.
 */
export function dejaEfectoDurable(acciones: AccionEOS[]): boolean {
  return acciones.some((accion) =>
    ACCIONES_DURABLES.has(String(accion?.tipo || "").trim().toUpperCase()),
  );
}

/**
 * Lo que se le dice cuando NADIE reportó qué pasó con la operación.
 *
 * Es el caso que encontró una clienta: el chat le mostraba "Operación lista
 * para registrar" con su botón, apretaba, y la pantalla de aprobaciones decía
 * "No tenés aprobaciones pendientes". Nada se guardaba, y no había forma de
 * darse cuenta de por qué.
 *
 * OJO CON ESTE TEXTO: durante seis días se mostró sobre ventas que SÍ se
 * habían registrado, porque se disparaba con la sola ausencia de una
 * aprobación pendiente —que dejó de existir cuando estas acciones pasaron a
 * ejecutarse solas—. Ahora sale únicamente cuando el worker no informó nada
 * sobre esa acción: ni que la hizo, ni que ya estaba, ni que falló.
 */
export const AVISO_SIN_APROBACION =
  "⚠️ **No llegué a dejarlo listo.** Entendí lo que querés registrar, pero el " +
  "sistema no me confirmó que se haya ejecutado, así que **no puedo darlo por " +
  "guardado**. Revisalo en la sección Negocio antes de volver a cargarlo.\n\n" +
  "Esto es lo que había entendido:";

/** El pie que lleva a completar lo que sí quedó esperando aprobación. */
export function enlaceDeAprobacion(origen: string): string {
  return `Para completar el registro, revisá y aprobá la operación pendiente en ${origen}/eos/autonomy`;
}

/**
 * El aviso que corresponde a lo que REALMENTE pasó.
 *
 * ============================================================
 * TRES SITUACIONES, TRES TEXTOS, Y NINGUNO SE DEDUCE
 * ============================================================
 *
 *   · Algo se ejecutó (o ya estaba hecho) → no se agrega nada. El worker ya
 *     escribió su propia frase —"La venta quedó registrada"— y agregarle una
 *     advertencia encima haría que la persona lea dos finales contradictorios
 *     para la misma acción y le crea al peor.
 *
 *   · Quedó esperando aprobación → el enlace a /eos/autonomy.
 *
 *   · Nadie informó nada → el aviso de arriba, que ahora sí es cierto.
 *
 * Un fallo NO agrega nada acá: el motivo real ya viene adentro de la respuesta
 * —el nodo 08 de n8n y `lib/gateway/resultados.ts` lo pegan al final— y ese
 * motivo dice qué hacer, que es más de lo que diría este aviso genérico.
 */
export function avisoDeVerificacion(
  respuesta: string,
  verificaciones: VerificacionDeAccion[],
  origen: string,
): string {
  if (verificaciones.length === 0) return respuesta;
  if (huboEfecto(verificaciones)) return respuesta;

  const pendientes = verificaciones.filter((v) => v.estado === "pendiente_aprobacion");

  if (pendientes.length > 0) {
    if (respuesta.includes("/eos/autonomy")) return respuesta;
    return `${respuesta}\n\n${enlaceDeAprobacion(origen)}`;
  }

  const mudas = verificaciones.filter((v) => v.estado === "sin_evidencia");

  if (mudas.length === 0) return respuesta;
  if (respuesta.includes(AVISO_SIN_APROBACION)) return respuesta;

  return `${AVISO_SIN_APROBACION}\n\n${respuesta}`;
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
  "perdón. No hay ninguna operación asociada a este mensaje, así que no quedó " +
  "nada guardado. Volvé a pedírmelo con el dato completo, o cargalo desde la " +
  "sección correspondiente.\n\nEsto es lo que te había contestado:";

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

export const AVISO_INTENTADO_Y_FALLIDO =
  "⚠️ **No quedó guardado.** Lo escribí como si estuviera hecho, y el sistema " +
  "no pudo completarlo. El motivo está abajo.\n\nEsto es lo que te había contestado:";

/**
 * La otra mitad: el modelo SÍ pidió la acción, la acción falló, y el texto
 * igual habla en pasado.
 *
 * `corregirAfirmacionSinAccion` solo cubre el caso de cero acciones. Este cubre
 * el que de verdad se ve en producción: el modelo pide REGISTRAR_VENTA, el
 * producto no se resuelve, el ejecutor devuelve 422 — y arriba de todo quedó
 * "Listo, registré la venta de 1 conjunto verde oliva".
 *
 * El prompt le pide al modelo que no anuncie el resultado ("NO ANUNCIES EL
 * RESULTADO", en `lib/gateway/sistema.ts`), pero un prompt es una súplica. Acá
 * el servidor SABE que ninguna acción quedó escrita, y eso el modelo no lo
 * puede falsificar.
 *
 * No se dispara cuando algo sí se ejecutó: en un mensaje con dos acciones
 * donde una anduvo, "lo registré" puede referirse a la que anduvo, y corregir
 * de más también es mentir.
 */
export function corregirAfirmacionFallida(
  respuesta: string,
  verificaciones: VerificacionDeAccion[],
): string {
  if (verificaciones.length === 0) return respuesta;
  if (huboEfecto(verificaciones)) return respuesta;
  if (!verificaciones.some((v) => v.estado === "fallida")) return respuesta;
  if (!AFIRMA_HABERLO_HECHO.test(respuesta)) return respuesta;
  if (respuesta.includes(AVISO_INTENTADO_Y_FALLIDO)) return respuesta;

  return `${AVISO_INTENTADO_Y_FALLIDO}\n\n${respuesta}`;
}
