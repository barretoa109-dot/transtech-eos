/**
 * Los cambios del prompt para REGISTRAR_COMPRA y REGISTRAR_GASTO_FIJO.
 *
 * Se definen UNA vez acá y se aplican a los dos lugares donde vive el prompt:
 * `lib/gateway/sistema.ts` y el nodo `HTTP Request` del gateway en n8n. Que
 * sean el mismo texto lo verifica `lib/gateway/sistema.test.ts`.
 */

export const CAMBIOS = [
  {
    donde: "la lista de acciones",
    viejo: ["CREAR_PRODUCTO", "ACTUALIZAR_PRODUCTO", "", "Acciones del negocio (ERP y CRM):"].join("\n"),
    nuevo: [
      "CREAR_PRODUCTO",
      "ACTUALIZAR_PRODUCTO",
      "REGISTRAR_COMPRA",
      "REGISTRAR_GASTO_FIJO",
      "",
      "Acciones del negocio (ERP y CRM):",
    ].join("\n"),
  },
  {
    donde: "la forma de datos",
    viejo: [
      "  No toca el stock (para eso está AJUSTAR_STOCK) ni la moneda.",
      "",
      "Reglas de estas cinco, que no se negocian:",
    ].join("\n"),
    nuevo: [
      "  No toca el stock (para eso está AJUSTAR_STOCK) ni la moneda.",
      "",
      "REGISTRAR_COMPRA",
      "  datos: { items: [{ concepto, cantidad?, total? , precio_unitario?, iva? }],",
      "           proveedor?, condicion?, fecha? }",
      "  Es TODA la plata que sale: mercadería, insumos, combustible, fletes,",
      '  servicios, un sueldo pagado. "Compré 3 bolsas de balanceado a 68.000",',
      '  "gasté 600.000 de combustible", "pagué 750.000 al capataz".',
      "  NO HACE FALTA que el concepto esté en el catálogo. Si está, la compra",
      "  le suma stock y le actualiza el costo sola; si no está, entra como",
      "  concepto y queda igual en la compra y en los gastos. Nunca inventes un",
      "  producto para poder registrar una compra.",
      "  El MONTO: cuando te den el total del renglón (5 lechones 1.500.000)",
      "  mandá total; cuando te den el de cada uno (la bolsa 68.000, compré 3)",
      "  mandá precio_unitario. No hagas la división vos: mandá el total y la",
      "  cantidad, y el sistema la hace.",
      "  Varios conceptos del mismo momento van en UNA compra, no en varias.",
      "  La condicion es contado o credito; si no la dice, es contado.",
      "",
      "REGISTRAR_GASTO_FIJO",
      "  datos: { fijos: [{ descripcion, monto, frecuencia?, tipo?, dia_del_mes? }] }",
      "  Es para lo que se REPITE, no para lo que ya se pagó: alquiler,",
      '  sueldos, cuotas, seguros. "El capataz cobra 750.000 cada 15 días",',
      '  "el alquiler son 2.000.000 por mes".',
      "  La frecuencia es mensual, quincenal, semanal, diaria o anual, y el",
      "  monto es el de ESA frecuencia, sin convertir: el sistema lo pasa a",
      "  mensual y lo dice en la respuesta.",
      "  tipo es gasto salvo que sea un ingreso recurrente.",
      "  Si algo se repite Y además ya se pagó una vez, son las dos acciones:",
      "  la compra por lo pagado y el fijo por lo que viene.",
      "",
      "Reglas de estas siete, que no se negocian:",
    ].join("\n"),
  },
];

export function aplicar(texto, etiqueta) {
  let salida = texto;
  for (const c of CAMBIOS) {
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
