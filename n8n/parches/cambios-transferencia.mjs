/**
 * Los cambios del prompt para REGISTRAR_TRANSFERENCIA.
 *
 * Sin comillas invertidas en el texto: en n8n el prompt vive dentro de un
 * literal de plantilla y una comilla lo corta. `aplicar` lo verifica.
 */

export const CAMBIOS = [
  {
    donde: "la lista de acciones",
    viejo: ["REGISTRAR_MOVIMIENTO_PERSONAL", "", "Acciones del negocio (ERP y CRM):"].join("\n"),
    nuevo: [
      "REGISTRAR_MOVIMIENTO_PERSONAL",
      "REGISTRAR_TRANSFERENCIA",
      "",
      "Acciones del negocio (ERP y CRM):",
    ].join("\n"),
  },
  {
    donde: "la forma de datos",
    viejo: [
      "  No pongas categoria: EOS la deduce sola al mostrar el desglose. Pedirle",
      "  al usuario que categorice es justo el trabajo que este producto le",
      "  saca.",
    ].join("\n"),
    nuevo: [
      "  No pongas categoria: EOS la deduce sola al mostrar el desglose. Pedirle",
      "  al usuario que categorice es justo el trabajo que este producto le",
      "  saca.",
      "",
      "REGISTRAR_TRANSFERENCIA",
      "  datos: { monto, origen, destino, moneda?, fecha? }",
      "  Plata que la persona mueve ENTRE SUS PROPIAS CUENTAS: del banco a la",
      '  billetera, de una cuenta a otra, al efectivo. "Pasé 1 millón de Ueno a',
      '  Continental", "saqué 500 mil del cajero", "mandé 2 millones a mi caja',
      '  de ahorro".',
      "  ESTO NO ES UN GASTO NI UN INGRESO, y es la razón por la que existe la",
      "  acción: la persona no ganó ni gastó nada, solo cambió de lugar su",
      "  plata. Mandarlo como movimiento personal le infla los gastos del mes y",
      "  con eso el presupuesto, el ritmo de gasto y su capacidad de ahorro.",
      "  origen y destino son los nombres tal como los dice: no hace falta que",
      "  las cuentas estén cargadas.",
      "  Si te dan una sola punta, preguntá la otra. Sin las dos no se puede.",
      "  Ojo con lo que SÍ es gasto: pagar una tarjeta, una cuota o a otra",
      "  persona no es transferencia entre cuentas propias.",
    ].join("\n"),
  },
];

export function aplicar(texto, etiqueta) {
  let salida = texto;

  for (const c of CAMBIOS) {
    if (c.nuevo.includes("`")) {
      throw new Error(
        `[${etiqueta}] "${c.donde}" trae una comilla invertida, y en n8n eso corta el prompt.`,
      );
    }

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
