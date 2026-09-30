/**
 * Los cambios del prompt del 29/09/2026: el caso Green.
 *
 * ============================================================
 * LO QUE PASÓ (29 de septiembre de 2026, 17:34 a 17:45)
 * ============================================================
 *
 * "Gasté 46.000gs en Punto Farma con mi tarjeta de crédito Green que por
 * cierto ya pagué el pago mínimo, y gané también 100.000gs recién."
 *
 * 1. "Ya pagué el mínimo" se mandó como REGISTRAR_PAGO_DEUDA contra "Green"
 *    por ₲188.000: el mínimo que la tarjeta tenía guardado en el contexto,
 *    no algo que la persona haya dicho. Green es una tarjeta, no una deuda:
 *    falló, y el error sugería "debo 8 millones a Green".
 * 2. La compra se guardó bien, pero la pantalla de Tarjetas la escondía. Cada
 *    "no está" la volvió a mandar (la regla "si dice que no lo anotaste, mandá
 *    de nuevo"): cinco compras de ₲46.000.
 * 3. Con una captura de Movimientos, anotó otra vez un gasto de ₲22.650 del
 *    27/09 que ya estaba.
 * 4. Mandó REGISTRAR_TARJETA con el mínimo, el cierre y el vencimiento que ya
 *    tenía la tarjeta, y con "Banco Basa" como emisor (el de OTRA tarjeta):
 *    cambió el emisor y la fecha del resumen sin que nadie lo dijera.
 *
 * La v222 (PR #208) le dio al pago de una tarjeta dónde ir y agregó la regla
 * "LO QUE YA CONFIRMASTE NO SE VUELVE A MANDAR". Esto va encima: separa el
 * pago pedido del mencionado al pasar, saca la regla vieja que decía lo
 * contrario ("mandá esa acción de nuevo"), y frena el reenvío de los datos
 * del contexto. La base ya no deja que 2, 3 y 4 dañen nada (v226): una
 * barrera no reemplaza a la otra.
 *
 * Sin comillas invertidas en el texto: en n8n el prompt vive dentro de un
 * literal de plantilla y una comilla lo corta. `aplicar` lo verifica.
 */

export const CAMBIOS = [
  {
    donde: "pago de tarjeta (v222): solo cuando pagar es el pedido",
    viejo: "  persona. Si no dice cuánto, el sistema usa el pago mínimo del resumen.\n",
    nuevo: [
      "  persona. Si no dice cuánto, el sistema usa el pago mínimo del resumen.",
      "  Esto vale cuando pagar ES lo que pide el mensaje. Si lo menciona al",
      "  pasar junto a otra cosa, es contexto: ver LO QUE LA PERSONA YA HIZO.",
      "",
    ].join("\n"),
  },
  {
    donde: "dónde se ve: los nombres reales de la pantalla",
    viejo: "  en Personal > Tarjetas, no en Movimientos; un gasto, en Personal >\n  Movimientos; una venta, en Negocio > Ventas)",
    nuevo: [
      "  en Personal › Tengo y debo › Tarjetas, no en Movimientos; un gasto, en",
      "  Personal › Mi mes › Movimientos; una venta, en Negocio > Ventas)",
    ].join("\n"),
  },
  {
    donde: "tarjeta: solo con lo que la persona dijo ahora",
    viejo: "  Sin los dos, EOS no puede decir cuándo cae ni cuánto.\n",
    nuevo: [
      "  Sin los dos, EOS no puede decir cuándo cae ni cuánto.",
      "  Mandala SOLO con los datos que la persona dijo en ESTE mensaje. Lo que",
      "  la tarjeta ya tiene cargado (lo ves en el contexto) no se vuelve a",
      "  mandar, y NUNCA le pongas el emisor, el banco o la terminación de otra",
      "  tarjeta. Si la persona solo pregunta dónde está su tarjeta, no es",
      "  REGISTRAR_TARJETA: contestá dónde verla.",
      "",
    ].join("\n"),
  },
  {
    donde: "movimiento personal: uno igual a uno que ya está",
    viejo: "  al usuario que categorice es justo el trabajo que este producto le\n  saca.\n",
    nuevo: [
      "  al usuario que categorice es justo el trabajo que este producto le",
      "  saca.",
      "  Si EOS contestó que un movimiento \"ya estaba anotado\" y la persona",
      "  dice que es OTRO (\"es otro\", \"fueron dos\"), mandalo de nuevo con",
      "  \"repetir\": true en datos.",
      "",
    ].join("\n"),
  },
  {
    donde: "ya pagué: es contexto, no un pedido",
    viejo: "  otra tarjeta cargada ni le agregues el emisor de otra.\n",
    nuevo: [
      "  otra tarjeta cargada ni le agregues el emisor de otra.",
      "- LO QUE LA PERSONA YA HIZO Y MENCIONA AL PASAR ES CONTEXTO, NO UN",
      "  PEDIDO. \"Que por cierto ya pagué el mínimo\", \"ya le pagué\" dicho",
      "  junto a otra cosa: no mandes ninguna acción por eso. En la respuesta",
      "  preguntá, en una línea, si quiere que lo anote y cuánto pagó. Si en",
      "  cambio el pago ES el pedido (\"ya pagué el mínimo de la Green\",",
      "  \"pagué la Visa\"), va REGISTRAR_PAGO_DEUDA.",
      "- Los datos del contexto (tarjetas, deudas, cuentas, fijos) son para",
      "  entender, no para volver a mandarlos. Nunca los pongas en una acción",
      "  como si la persona los hubiera dicho —si falta el monto de un pago, lo",
      "  completa el sistema, no vos—, ni en la respuesta como si fueran suyos",
      "  (\"me dijiste que debés 8 millones\").",
      "",
    ].join("\n"),
  },
  {
    donde: "no lo anotaste: solo lo que no se confirmó",
    viejo: [
      "- Si la persona dice \"no lo anotaste\" o \"sigue sin anotar\", buscá más",
      "  arriba en la conversación qué quedó sin hacer o falló, y mandá esa",
      "  acción de nuevo con los datos que ya te dio. No preguntes lo que ya",
      "  te dijeron.",
    ].join("\n"),
    nuevo: [
      "- Si la persona dice \"no lo anotaste\" o \"sigue sin anotar\" y EOS NO lo",
      "  había confirmado (falló, o no hay ningún \"Anoté…\"), buscá más arriba",
      "  qué quedó sin hacer y mandá esa acción de nuevo con los datos que ya",
      "  te dio. Si EOS ya lo había confirmado, vale LO QUE YA CONFIRMASTE NO",
      "  SE VUELVE A MANDAR. No preguntes lo que ya te dijeron.",
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

    // Ya aplicado: no se aplica dos veces.
    if (salida.includes(c.nuevo)) continue;

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
