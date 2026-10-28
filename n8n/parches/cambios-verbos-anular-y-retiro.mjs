/**
 * Los dos verbos nuevos del gateway (v248): ANULAR_MOVIMIENTO y
 * REGISTRAR_RETIRO_PERSONAL. El mismo texto que ya se sincronizó a mano en
 * `lib/gateway/sistema.ts` y en el JSON exportado — este archivo lo aplica
 * sobre el workflow REAL, con el mismo criterio que
 * `n8n/parches/cambios-ventana-30-dias.mjs`: viejo/nuevo explícitos, para que
 * un diff futuro muestre exactamente qué cambió.
 */

const N = "\n";

const LISTA_VIEJA =
  "REGISTRAR_MOVIMIENTO_PERSONAL" + N + "REGISTRAR_TRANSFERENCIA" + N +
  "REGISTRAR_DEUDA" + N + "REGISTRAR_PAGO_DEUDA" + N + "CORREGIR_MOVIMIENTO" + N + "DECLARAR_SALDO" + N;

const LISTA_NUEVA =
  "REGISTRAR_MOVIMIENTO_PERSONAL" + N + "REGISTRAR_RETIRO_PERSONAL" + N + "REGISTRAR_TRANSFERENCIA" + N +
  "REGISTRAR_DEUDA" + N + "REGISTRAR_PAGO_DEUDA" + N + "CORREGIR_MOVIMIENTO" + N + "ANULAR_MOVIMIENTO" + N + "DECLARAR_SALDO" + N;

const ANCLA_TRANSFERENCIA =
  "Ojo con lo que SÍ es gasto: pagar una tarjeta, una cuota o a otra" + N +
  "  persona no es transferencia entre cuentas propias." + N + N +
  "REGISTRAR_DEUDA";

const RETIRO =
  "REGISTRAR_RETIRO_PERSONAL" + N +
  '  datos: { monto, descripcion?, moneda?, fecha? }' + N +
  "  Plata que el DUEÑO del negocio saca de la caja para uso personal." + N +
  '  "Saqué 2 millones del negocio para mí", "me pagué a mí mismo 500' + N +
  '  mil", "retiré plata de la caja para gastos míos".' + N +
  "  ES EL MOVIMIENTO DE DOS LADOS: sale como gasto de la caja del" + N +
  "  negocio y entra como ingreso en lo personal, los dos a la vez. No" + N +
  "  mandes además REGISTRAR_GASTO_FIJO ni REGISTRAR_MOVIMIENTO_PERSONAL" + N +
  "  por lo mismo: quedaría contado dos veces." + N +
  "  NO ES UN GASTO FIJO del negocio (como el alquiler o un sueldo a un" + N +
  "  empleado): un gasto fijo paga algo externo al negocio; esto es la" + N +
  "  plata que el dueño se lleva para sí mismo. Si dudás de cuál es," + N +
  "  preguntá para qué es la plata." + N + N;

const ANCLA_CORREGIR_BORRADO =
  "  NO BORRA. Si te piden borrar un movimiento, decile que lo haga desde" + N +
  "  Personal, en la lista de movimientos: borrar por chat sobre una" + N +
  "  coincidencia equivocada destruye un dato sin dejar rastro." + N;

const NUEVA_FRASE_BORRADO =
  "  NO BORRA. Si te piden borrar un movimiento, usá ANULAR_MOVIMIENTO: no" + N +
  "  hay un borrado literal por chat, a propósito — una coincidencia" + N +
  "  equivocada destruiría un dato sin dejar rastro." + N;

const ANCLA_CORREGIR_FIN =
  "Si la persona te está corrigiendo algo que acabás de anotar mal, esta" + N +
  "  es la acción — no vuelvas a mandar REGISTRAR_MOVIMIENTO_PERSONAL, que" + N +
  "  dejaría el gasto cargado dos veces." + N + N +
  "DECLARAR_SALDO";

const ANULAR =
  "ANULAR_MOVIMIENTO" + N +
  '  datos: { descripcion, motivo? }' + N +
  "  Deshacer un gasto o un ingreso personal que no debió anotarse." + N +
  '  "Anulá el gasto de nafta", "ese ingreso no era mío, anulalo",' + N +
  '  "anulá lo que anoté hoy de comida, lo anoté dos veces".' + N +
  "  descripcion es cómo ENCONTRAR el movimiento: la palabra con la que se" + N +
  "  anotó. Anula el más reciente de los últimos 30 días que coincida, y" + N +
  "  el sistema dice CUÁL anuló y CUÁNTO, para que la persona lo pueda" + N +
  "  desmentir en el momento si agarró el equivocado." + N +
  "  Solo movimientos personales. Los del negocio salen de una venta o" + N +
  "  una compra y se anulan desde ahí (ANULAR_VENTA, ANULAR_COMPRA)." + N +
  "  NO ES LO MISMO QUE CORREGIR_MOVIMIENTO: corregir cambia un dato mal" + N +
  "  entendido (el monto, la fecha); anular dice que el movimiento entero" + N +
  "  no debió existir." + N + N;

/** Aplica los tres cambios sobre el texto del prompt (nodo HTTP Request). */
export function aplicarPrompt(texto, etiqueta) {
  for (const t of [RETIRO, ANULAR, NUEVA_FRASE_BORRADO]) {
    if (t.includes("`")) throw new Error(`[${etiqueta}] comilla invertida en el texto a insertar`);
  }

  let salida = texto;

  if (!salida.includes(LISTA_VIEJA)) throw new Error(`[${etiqueta}] no encontré la lista plana de acciones`);
  salida = salida.replace(LISTA_VIEJA, LISTA_NUEVA);

  if (!salida.includes(ANCLA_TRANSFERENCIA)) throw new Error(`[${etiqueta}] no encontré el ancla de REGISTRAR_TRANSFERENCIA`);
  salida = salida.replace(
    ANCLA_TRANSFERENCIA,
    "Ojo con lo que SÍ es gasto: pagar una tarjeta, una cuota o a otra" + N +
    "  persona no es transferencia entre cuentas propias." + N + N +
    RETIRO +
    "REGISTRAR_DEUDA",
  );

  if (!salida.includes(ANCLA_CORREGIR_BORRADO)) throw new Error(`[${etiqueta}] no encontré la frase de "NO BORRA"`);
  salida = salida.replace(ANCLA_CORREGIR_BORRADO, NUEVA_FRASE_BORRADO);

  if (!salida.includes(ANCLA_CORREGIR_FIN)) throw new Error(`[${etiqueta}] no encontré el final de CORREGIR_MOVIMIENTO`);
  salida = salida.replace(
    ANCLA_CORREGIR_FIN,
    "Si la persona te está corrigiendo algo que acabás de anotar mal, esta" + N +
    "  es la acción — no vuelvas a mandar REGISTRAR_MOVIMIENTO_PERSONAL, que" + N +
    "  dejaría el gasto cargado dos veces." + N + N +
    ANULAR +
    "DECLARAR_SALDO",
  );

  return salida;
}

/** La lista blanca del Worker (nodo 01 INT Preparar): agrega los dos verbos. */
export function aplicarAllowlist(codigo, etiqueta) {
  const ancla = "'ENVIAR_WHATSAPP_CLIENTE'," + N + "  'CREAR_DECISION',";
  if (!codigo.includes(ancla)) throw new Error(`[${etiqueta}] no encontré el ancla de CREAR_DECISION en la allowlist`);

  const nuevo =
    "'ENVIAR_WHATSAPP_CLIENTE'," + N + "  'CREAR_DECISION'," + N + N +
    "  /*" + N +
    "    Las dos de la auditoria previa al lanzamiento al publico (v248): anular" + N +
    "    un movimiento personal y el retiro del negocio hacia lo personal. Mismo" + N +
    "    motivo que ANULAR_VENTA arriba: sin esto, el worker las rechaza ANTES de" + N +
    "    pedir autorizacion." + N +
    "  */" + N +
    "  'ANULAR_MOVIMIENTO'," + N +
    "  'REGISTRAR_RETIRO_PERSONAL',";

  return codigo.replace(ancla, nuevo);
}
