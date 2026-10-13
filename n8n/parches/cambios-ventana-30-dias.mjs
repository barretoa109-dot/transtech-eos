/**
 * Arreglo urgente (13/10/2026, caso real de Sofía): CORREGIR_MOVIMIENTO,
 * CORREGIR_COMPRA, ANULAR_COMPRA, CORREGIR_VENTA y ANULAR_VENTA sólo
 * buscaban en los ÚLTIMOS SIETE DÍAS. Un gasto de publicidad cargado el
 * 02/10 quedó imposible de corregir por chat el 13/10 (once días después):
 * "No encontré ninguna compra tuya de los últimos siete días que coincida
 * con 'publicidad'", dos veces seguidas, aunque la compra sí estaba.
 *
 * El SQL ya se amplió de 7 a 30 días (migración aparte). Esto sólo
 * actualiza lo que el prompt le dice al modelo sobre esa ventana, para que
 * no siga prometiendo "siete días" cuando el sistema ya busca en treinta.
 */

export const CAMBIOS = [
  {
    donde: "CORREGIR_MOVIMIENTO",
    viejo: "Corrige el más reciente de los últimos siete días que coincida",
    nuevo: "Corrige el más reciente de los últimos 30 días que coincida",
  },
  {
    donde: "CORREGIR_VENTA: referencia opcional",
    viejo: [
      "referencia es cómo encontrar la VENTA —un monto, un producto, un",
      "  cliente— y es opcional: sin ella se corrige la más reciente de los",
      "  últimos siete días.",
    ].join("\n"),
    nuevo: [
      "referencia es cómo encontrar la VENTA —un monto, un producto, un",
      "  cliente— y es opcional: sin ella se corrige la más reciente de los",
      "  últimos 30 días.",
    ].join("\n"),
  },
  {
    donde: "ANULAR_VENTA: sin referencia",
    viejo: [
      "Sin referencia se anula la MÁS RECIENTE de",
      "  los últimos siete días, que es lo que significa \"esa venta\" dicho",
      "  después de cargarla.",
    ].join("\n"),
    nuevo: [
      "Sin referencia se anula la MÁS RECIENTE de",
      "  los últimos 30 días, que es lo que significa \"esa venta\" dicho",
      "  después de cargarla.",
    ].join("\n"),
  },
  {
    donde: "ANULAR_VENTA: límite de edad",
    viejo: [
      "Sólo de los últimos siete días. Para algo más viejo, decile que lo haga",
      "  desde Negocio > Ventas.",
    ].join("\n"),
    nuevo: [
      "Sólo de los últimos 30 días. Para algo más viejo, decile que lo haga",
      "  desde Negocio > Ventas.",
    ].join("\n"),
  },
  {
    donde: "CORREGIR_COMPRA: referencia opcional",
    viejo: [
      "referencia es cómo encontrar la COMPRA —un monto, un concepto, un",
      "  proveedor— y es opcional: sin ella se corrige la más reciente de los",
      "  últimos siete días.",
    ].join("\n"),
    nuevo: [
      "referencia es cómo encontrar la COMPRA —un monto, un concepto, un",
      "  proveedor— y es opcional: sin ella se corrige la más reciente de los",
      "  últimos 30 días.",
    ].join("\n"),
  },
  {
    donde: "ANULAR_COMPRA: sin referencia",
    viejo: [
      "Sin referencia se anula la MÁS RECIENTE de los",
      "  últimos siete días, que es lo que significa \"esa compra\" dicho después",
      "  de cargarla.",
    ].join("\n"),
    nuevo: [
      "Sin referencia se anula la MÁS RECIENTE de los",
      "  últimos 30 días, que es lo que significa \"esa compra\" dicho después",
      "  de cargarla.",
    ].join("\n"),
  },
  {
    donde: "ANULAR_COMPRA: límite de edad",
    viejo: [
      "Sólo de los últimos siete días. Para algo más viejo, decile que lo haga",
      "  desde Negocio > Compras.",
    ].join("\n"),
    nuevo: [
      "Sólo de los últimos 30 días. Para algo más viejo, decile que lo haga",
      "  desde Negocio > Compras.",
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
