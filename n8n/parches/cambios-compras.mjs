/**
 * ANULAR_COMPRA y CORREGIR_COMPRA: las simétricas de venta.
 *
 * ============================================================
 * LA ASIMETRÍA
 * ============================================================
 *
 * Se puede deshacer y corregir una VENTA por chat desde el 10 de septiembre.
 * Con la COMPRA no, aunque `eos_erp_anular_compra` y `eos_erp_editar_compra`
 * están en la base desde agosto y la pantalla las usa. Quien cargaba mal un
 * gasto tenía que ir a Negocio > Compras a mano.
 *
 * ============================================================
 * QUÉ CAMBIA RESPECTO DE LA VENTA
 * ============================================================
 *
 *   · El renglón se nombra por "concepto", no por "producto": una compra
 *     puede tener conceptos que no están en el catálogo (combustible, un
 *     flete). Ver la migración v170.
 *
 *   · No hay factura que bloquee: la factura de una compra es del proveedor.
 *
 * Todo lo demás es igual, y por las mismas razones: la referencia es
 * opcional, se toma la más reciente de los últimos siete días que coincida,
 * y la respuesta dice SIEMPRE qué anuló o qué corrigió.
 *
 * El prompt no puede tener comillas invertidas: vive dentro de un literal de
 * plantilla de JavaScript (ver `verificar.mjs`).
 */

export const CAMBIOS = [
  {
    donde: "la lista de acciones permitidas",
    viejo: "CORREGIR_VENTA\n\nAcciones del negocio (ERP y CRM):",
    nuevo: "CORREGIR_VENTA\nANULAR_COMPRA\nCORREGIR_COMPRA\n\nAcciones del negocio (ERP y CRM):",
  },
  {
    donde: "las formas de datos de ANULAR_COMPRA y CORREGIR_COMPRA",
    viejo: "  desde Negocio > Ventas.\n\nGUARDAR_MEMORIA",
    nuevo: [
      "  desde Negocio > Ventas.",
      "",
      "CORREGIR_COMPRA",
      "  datos: { referencia?, concepto?, cantidad?, precio_unitario?, motivo? }",
      "  Arreglar un número de una compra ya registrada. \"Eran 3 bolsas, no 30\",",
      "  \"el combustible fue 600.000, no 60.000\", \"puse mal la cantidad\".",
      "  Va al menos uno de cantidad o precio_unitario: son lo que cambia.",
      "  referencia es cómo encontrar la COMPRA —un monto, un concepto, un",
      "  proveedor— y es opcional: sin ella se corrige la más reciente de los",
      "  últimos siete días.",
      "  concepto es cuál RENGLÓN de esa compra, y hace falta sólo si la compra",
      "  tiene más de uno. Si hace falta y no lo mandás, el sistema te lista los",
      "  conceptos para que preguntes cuál.",
      "  El resto de la compra no se toca: no le pidas a la persona que la",
      "  redicte entera para cambiar un número.",
      "  SI LO QUE ESTÁ MAL ES LA COMPRA ENTERA —otro proveedor, otro concepto—",
      "  eso es ANULAR_COMPRA y volver a registrarla. Este verbo cambia cantidad",
      "  o precio, nada más.",
      "",
      "ANULAR_COMPRA",
      "  datos: { referencia?, motivo? }",
      "  Deshacer una compra que se cargó mal. \"Anulá esa compra\", \"la última",
      "  estaba mal\", \"anulá la de 600.000\", \"borrá la compra del proveedor de",
      "  balanceado\".",
      "  Devuelve el stock, restaura el costo anterior y saca el gasto del panel.",
      "  referencia es cómo ENCONTRARLA y es opcional: un monto, un concepto o el",
      "  nombre del proveedor. Sin referencia se anula la MÁS RECIENTE de los",
      "  últimos siete días, que es lo que significa \"esa compra\" dicho después",
      "  de cargarla. El sistema informa cuál anuló, con fecha, total y conceptos.",
      "  El motivo es opcional: si no lo dicen, no lo preguntes.",
      "  NO ES UN PAGO NI UNA DEVOLUCIÓN. Si le pagó a un proveedor, eso es",
      "  REGISTRAR_PAGO_COMPRA; si le devolvieron mercadería, la compra existió",
      "  y tiene que seguir existiendo. Anular borraría del historial una compra",
      "  que sí pasó.",
      "  Sólo de los últimos siete días. Para algo más viejo, decile que lo haga",
      "  desde Negocio > Compras.",
      "",
      "GUARDAR_MEMORIA",
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
