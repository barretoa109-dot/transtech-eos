import { PROMPT_SISTEMA } from "./sistema.ts";

/**
 * Fase 2 del diseño multiagente (`docs/arquitectura-multiagente-2026-11-06.md`):
 * partir el prompt de sistema en un núcleo y un módulo opcional, SIN cambiar
 * el comportamiento todavía. Esto no se usa en producción hasta la Fase 3.
 *
 * ============================================================
 * POR QUÉ NO ES UN "ROUTER DE 5 MÓDULOS" COMO DECÍA EL DISEÑO ORIGINAL
 * ============================================================
 *
 * El diseño del 06/11 imaginaba separar el prompt en personal / negocio /
 * crm / documentos. Leyendo el prompt real bloque por bloque (separado por
 * línea en blanco), esa separación no existe en los datos: de las 33
 * acciones, la enorme mayoría de las de PLATA —movimiento, deuda, pago de
 * deuda, transferencia, retiro, tarjeta, gasto fijo, corregir/anular
 * movimiento— conviven en los dos ámbitos a propósito (ver
 * [[eos_finanzas_ambito]]), y el propio prompt lo dice en su bloque de
 * desambiguación:
 *
 *   "REGISTRAR_GASTO_FIJO y CREAR_OBJETIVO son de los dos y por eso
 *    llevan ambito."
 *
 * Separarlas en módulos distintos obligaría a elegir UNO antes de saber de
 * qué habla el mensaje, que es exactamente lo que esa sección del prompt
 * existe para decidir bien. Armar el módulo equivocado ahí sería peor que no
 * tener módulos.
 *
 * Lo que SÍ es seguro de sacar es más angosto y más real: las acciones que el
 * PROPIO prompt ya declara "SIEMPRE del negocio" —venta, compra, stock,
 * producto, contacto— más sus correcciones/anulaciones y las exclusivas de
 * CRM (oportunidad, WhatsApp a un cliente). Ninguna de estas tiene una
 * lectura personal posible: no hay ambigüedad que resolver.
 *
 * ============================================================
 * CÓMO SE SACA, PARA QUE NUNCA SE DESINCRONICE DEL ORIGINAL
 * ============================================================
 *
 * `BLOQUES_ERP_CRM_EXCLUSIVOS` no es una copia a mano del texto — son los
 * ÍNDICES de los bloques (separados por "\n\n") dentro de `PROMPT_SISTEMA`
 * que se excluyen. `construirNucleo` los filtra en caliente, así que el
 * núcleo siempre deriva del prompt real: si alguien edita `sistema.ts`, el
 * núcleo cambia con él. No hay una segunda copia del texto que mantener
 * sincronizada — es la misma clase de problema que ya mordió al proyecto con
 * las listas de acciones de n8n (ver [[eos-n8n-gateway]]), y esta vez el
 * mecanismo lo hace estructuralmente imposible, no solo "hay que acordarse".
 *
 * El test de este archivo verifica, bloque por bloque, que cada índice
 * excluido sigue siendo el que dice ser (empieza con el nombre de la acción
 * esperada). Si el prompt se reordena, el test se rompe ANTES de que el
 * núcleo quede mal armado en silencio.
 */
export const BLOQUES_ERP_CRM_EXCLUSIVOS: ReadonlyMap<number, string> = new Map([
  [9, "Acciones del negocio (ERP y CRM):"], // el título: sin las acciones de abajo, tampoco hace falta.
  [10, "REGISTRAR_VENTA"],
  [11, "AJUSTAR_STOCK"],
  [13, "CREAR_PRODUCTO"],
  [14, "ACTUALIZAR_PRODUCTO"],
  [15, "REGISTRAR_COMPRA"],
  [16, "REGISTRAR_COBRO"],
  [17, "REGISTRAR_PAGO_COMPRA"],
  [18, "REGISTRAR_OPORTUNIDAD"],
  [31, "CORREGIR_VENTA"],
  [32, "ANULAR_VENTA"],
  [33, "CORREGIR_COMPRA"],
  [34, "ANULAR_COMPRA"],
  [35, "ENVIAR_WHATSAPP_CLIENTE"],
]);

/*
 * CREAR_CONTACTO (bloque 12) NO entra en la lista.
 *
 * El prompt lo nombra "SIEMPRE del negocio", pero en el bloque 36
 * (CREAR_TAREA) y otros puntos de contexto un contacto también puede ser
 * alguien de la vida personal de quien usa EOS Personal sin el módulo ERP.
 * Ante la duda documentada contra la duda inventada, se queda en el núcleo:
 * es un bloque chico (167 caracteres) y el costo de dejarlo es mínimo
 * comparado con el de sacarlo mal.
 */

/**
 * El bloque "Acciones permitidas:" es distinto a los demás: no es la
 * instrucción de UNA acción, es la lista de TODOS los nombres válidos, una
 * por línea (bloque 7 "Acciones permitidas:" + bloque 8, la lista en sí).
 * Si se excluyen las instrucciones de REGISTRAR_VENTA pero su nombre sigue
 * en esta lista maestra, el modelo la ve como "permitida" sin saber cómo
 * armarla — peor que no tener el módulo. Por eso esta lista se filtra
 * aparte, línea por línea, con los mismos nombres que ya se excluyen arriba.
 */
const INDICE_LISTA_ACCIONES = 8;

export const NOMBRES_ERP_CRM_EXCLUSIVOS = new Set(
  [...BLOQUES_ERP_CRM_EXCLUSIVOS.values()].filter((nombre) => nombre !== "Acciones del negocio (ERP y CRM):"),
);

/** Construye el núcleo a partir del prompt real, nunca de una copia. */
export function construirNucleo(promptCompleto: string = PROMPT_SISTEMA): string {
  const bloques = promptCompleto.split("\n\n").map((bloque, i) => {
    if (i !== INDICE_LISTA_ACCIONES) return bloque;
    return bloque
      .split("\n")
      .filter((linea) => !NOMBRES_ERP_CRM_EXCLUSIVOS.has(linea.trim()))
      .join("\n");
  });

  return bloques.filter((_, i) => !BLOQUES_ERP_CRM_EXCLUSIVOS.has(i)).join("\n\n");
}

/** El núcleo, calculado una vez al cargar el módulo. */
export const PROMPT_NUCLEO = construirNucleo();

/**
 * ¿Hace falta mandar el módulo de ERP/CRM en este mensaje?
 *
 * No decide "es personal": decide "¿hay evidencia de negocio o CRM en este
 * mensaje o en los últimos turnos?", y mientras esa evidencia no aparezca,
 * excluye el módulo. Es una primera pasada barata y determinística — ni mira
 * el historial completo ni usa un modelo.
 *
 * ============================================================
 * ESTO TODAVÍA NO ESTÁ VALIDADO PARA PRODUCCIÓN
 * ============================================================
 *
 * Un mensaje realmente ambiguo sin ninguna palabra de negocio ("anulá la de
 * ayer", sin contexto previo) puede clasificar mal. Por eso esta función no
 * se usa todavía en el camino real: antes hay que medir, con el mismo
 * criterio que ya se usó para el Model Router (98,6 % medido antes de
 * confiar en él), cuántos casos de `evals/bateria` con un verbo esperado de
 * negocio/CRM esta función clasificaría como "no hace falta el módulo". Un
 * solo falso negativo ahí es un motivo para no prenderla todavía, no para
 * agregar más palabras clave a mano: ver `scripts/medir-modulo-erp-crm.mjs`.
 */
/*
 * NO con `\b`. En JavaScript `\w` es solo ASCII, así que una tilde ("í", "á")
 * cuenta como carácter NO de palabra, y `\b` después de "vendí" no encuentra
 * límite —a los dos lados hay "no palabra"— y la expresión no engancha nada.
 * Mismo problema, mismo arreglo que ya tiene `lib/eos/acciones-chat.ts`.
 */
const ANTES = "(?<![a-záéíóúüñ])";
const DESPUES = "(?![a-záéíóúüñ])";

const PALABRAS_NEGOCIO_O_CRM = new RegExp(
  ANTES +
    "(vend[ií]|venta|ventas|compr[ée]|compra|compras|stock|invent[ao]rio|cliente|clientes|proveedor|proveedores|" +
    "producto|productos|cat[aá]logo|factura|comprobante|oportunidad|cotizaci[oó]n|rubro|negocio|empresa|whatsapp)" +
    DESPUES,
  "i",
);

export function necesitaModuloErpCrm(mensaje: string, historial: { texto: string }[] = []): boolean {
  if (PALABRAS_NEGOCIO_O_CRM.test(mensaje)) return true;
  // Los últimos turnos del historial: un seguimiento corto ("¿y a 150?")
  // después de hablar de una venta sigue siendo del negocio aunque el
  // mensaje en sí no tenga ninguna palabra propia.
  return historial.slice(-4).some((t) => PALABRAS_NEGOCIO_O_CRM.test(t.texto));
}
