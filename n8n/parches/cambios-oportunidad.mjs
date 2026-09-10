/**
 * El chat aprende a llenar el embudo.
 *
 * ============================================================
 * LA INFORMACIÓN QUE MÁS SE PIERDE
 * ============================================================
 *
 * Una oportunidad nace en una conversación —un llamado, un mensaje, alguien
 * que preguntó un precio— y si no se anota en ese momento no queda en ningún
 * lado. Un embudo vacío no significa que no haya negocios: significa que nadie
 * los cargó.
 *
 * ============================================================
 * LO QUE EL PROMPT TIENE QUE IMPEDIR
 * ============================================================
 *
 * Que el modelo crea que marcar una oportunidad como ganada ya registra la
 * venta. La confusión es de una sola dirección y cara: el negocio se quedaría
 * sin la venta, sin el descuento de stock y sin el ingreso en el panel.
 */

export const CAMBIOS = [
  {
    donde: "la lista de acciones permitidas",
    viejo:
      "REGISTRAR_TARJETA\nREGISTRAR_COMPRA_TARJETA\n\nAcciones del negocio (ERP y CRM):",
    nuevo:
      "REGISTRAR_TARJETA\nREGISTRAR_COMPRA_TARJETA\nREGISTRAR_OPORTUNIDAD\n\n" +
      "Acciones del negocio (ERP y CRM):",
  },
  {
    donde: "la forma de datos de REGISTRAR_OPORTUNIDAD",
    viejo: ["REGISTRAR_GASTO_FIJO", "  datos: { fijos: [{ descripcion, monto, frecuencia?, tipo?, dia_del_mes? }] }"].join(
      "\n",
    ),
    nuevo: [
      "REGISTRAR_OPORTUNIDAD",
      "  datos: { titulo, contacto?, monto?, etapa?, cierre_estimado?,",
      "           detalle?, motivo? }",
      "  Un negocio POSIBLE, para el embudo. \"Pedro está interesado en el",
      "  sistema, unos 5 millones\", \"le mandé la propuesta a la cooperativa\",",
      "  \"perdimos el de la municipalidad, se fueron por precio\".",
      "  Crea o AVANZA sola: si nombrás el negocio que ya estaba, lo mueve de",
      "  etapa; si es otro, lo crea. No preguntes cuál de las dos.",
      "  etapa: nueva, contactado, propuesta, negociacion, ganada o perdida.",
      "  Mandala SOLO cuando la persona diga que algo se movió — es lo que",
      "  distingue \"moveme esto\" de \"anotá esto nuevo\".",
      "  GANARLA NO ES VENDER. Marcar ganada no registra ninguna venta, no",
      "  descuenta stock y no suma plata al panel. Si además la venta se",
      "  concretó y te dicen QUÉ vendieron, mandá TAMBIÉN REGISTRAR_VENTA.",
      "  NO INVENTES EL MONTO. Si no te lo dijeron, no lo mandes: entra sin",
      "  monto y el sistema lo pide después. Un embudo con montos inventados",
      "  se lee como una previsión de ingresos, y sobre eso se decide.",
      "  El contacto tiene que estar entre los contactos: no se inventa.",
      "",
      "REGISTRAR_GASTO_FIJO",
      "  datos: { fijos: [{ descripcion, monto, frecuencia?, tipo?, dia_del_mes? }] }",
    ].join("\n"),
  },
];

export function aplicar(texto, etiqueta) {
  let salida = texto;

  for (const c of CAMBIOS) {
    if (c.nuevo.includes("`")) throw new Error(`[${etiqueta}] comilla invertida en "${c.donde}"`);

    const partes = salida.split(c.viejo);
    if (partes.length !== 2) {
      throw new Error(`[${etiqueta}] "${c.donde}": aparece ${partes.length - 1} veces, no 1.`);
    }
    salida = partes.join(c.nuevo);
  }

  return salida;
}
