/**
 * Dos reglas del 29/09/2026 (chat real, finanzas personales).
 *
 * 1. EL PAGO DEL RESUMEN DE UNA TARJETA. "Ya pagué el pago mínimo de la
 *    Green" terminaba en "No tengo ninguna deuda con Green": no había dónde
 *    anotar el pago de un resumen. Desde la v222 lo hace REGISTRAR_PAGO_DEUDA
 *    con acreedor = la tarjeta; esto se lo dice al modelo.
 *
 * 2. LO YA CONFIRMADO NO SE VUELVE A MANDAR. La pantalla de Tarjetas no se
 *    mostraba (arreglado en `FinanzasTarjetas.tsx`), la persona dijo "no está"
 *    y EOS volvió a mandar la misma compra: cinco veces en diez minutos. El
 *    ejecutor ya frena la repetición (`lib/gateway/worker.ts`); esto es para
 *    que el modelo ni lo intente, diga dónde está, y sepa cómo pedir una
 *    segunda igual de verdad (`repetir: true`).
 *
 * Nada de acentos graves ni `${` en el texto: el prompt vive adentro de un
 * literal de plantilla en n8n (ver `verificar.mjs`).
 */

export const MARCA = "LO QUE YA CONFIRMASTE NO SE VUELVE A MANDAR";

export const CAMBIOS_PROMPT = [
  {
    donde: "el pago del resumen de una tarjeta",
    viejo: '  Una cuota pagada. "Pagué la cuota de Ueno", "le pagué 800 mil a la\n  financiera".\n',
    nuevo: [
      '  Una cuota pagada. "Pagué la cuota de Ueno", "le pagué 800 mil a la',
      '  financiera".',
      '  También el pago del resumen de una TARJETA ("pagué la Visa", "ya pagué',
      '  el mínimo de la Green"): acreedor es la tarjeta como la llama la',
      "  persona. Si no dice cuánto, el sistema usa el pago mínimo del resumen.",
      "",
    ].join("\n"),
  },
  {
    donde: "cambiar cuándo vence una venta (v225)",
    viejo: "  es ANULAR_VENTA y volver a registrarla. Este verbo cambia cantidad o\n  precio, nada más.\n",
    nuevo: [
      "  es ANULAR_VENTA y volver a registrarla. Este verbo cambia cantidad o",
      "  precio, nada más.",
      "  Y el VENCIMIENTO de una venta a crédito: \"que vence el 5 de noviembre\",",
      "  \"dale 15 días más\", \"me paga el 30\". Mandá referencia (el cliente o el",
      "  monto) y UNO de vence_el, vence_en_dias o vence_dia, igual que al",
      "  registrarla, SIN cantidad ni precio: solo cambia la fecha, aunque la",
      "  venta tenga cobros o una seña. Nunca digas que no se puede.",
      "",
    ].join("\n"),
  },
  {
    donde: "la regla de no reenviar lo confirmado",
    viejo: "  falta y decí de qué estás hablando.\n",
    nuevo: [
      "  falta y decí de qué estás hablando.",
      `- ${MARCA}. Si en la conversación ya dijiste que algo`,
      '  quedó anotado ("Anoté...", "quedó registrada") y la persona dice que no',
      "  está o que no lo anotaste, NO mandes ninguna acción: ya está guardado y",
      "  mandarlo de nuevo lo duplica. Decile dónde verlo (una compra con tarjeta,",
      "  en Personal > Tarjetas, no en Movimientos; un gasto, en Personal >",
      "  Movimientos; una venta, en Negocio > Ventas) y, si insiste en que falta,",
      "  pedile una captura de esa sección. Solo si la persona dice que es OTRA",
      '  compra o venta igual a una anterior, mandala con "repetir": true en',
      "  datos.",
      "",
    ].join("\n"),
  },
];

export function aplicarPrompt(texto, etiqueta) {
  if (texto.includes(MARCA)) return texto;
  let salida = texto;
  for (const c of CAMBIOS_PROMPT) {
    const partes = salida.split(c.viejo);
    if (partes.length !== 2) {
      throw new Error(`[${etiqueta}] "${c.donde}": el texto aparece ${partes.length - 1} veces, no 1. No se escribió nada.`);
    }
    salida = partes.join(c.nuevo);
  }
  return salida;
}
