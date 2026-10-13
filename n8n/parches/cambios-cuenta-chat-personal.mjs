/**
 * El chat aprende a decir de qué cuenta salió o a cuál entró un movimiento
 * personal (gasto, ingreso, pago de deuda, pago de tarjeta).
 *
 * El schema y las funciones SQL ya están en producción (v240, v241;
 * `eos_resolver_cuenta_v240`): esto sólo le avisa al modelo que el campo
 * `cuenta` existe y cuándo mandarlo. Opcional en los dos casos — si no se
 * dice, el movimiento queda sin cuenta asignada, como hasta ahora.
 */

export const CAMBIOS = [
  {
    donde: "REGISTRAR_MOVIMIENTO_PERSONAL: agrega el párrafo de cuenta",
    viejo: [
      "no pongas categoria: EOS la deduce de la descripción y de las correcciones",
      "  que la persona ya hizo. Nunca le pidas que categorice.",
      "  Si EOS contestó que un movimiento \"ya estaba anotado\"",
    ].join("\n"),
    nuevo: [
      "no pongas categoria: EOS la deduce de la descripción y de las correcciones",
      "  que la persona ya hizo. Nunca le pidas que categorice.",
      "  Cuenta: si dijo de dónde salió o a dónde entró la plata (\"con la",
      "  Visa\", \"de Efectivo\", \"en el Itaú\"), mandalo en cuenta, tal como lo",
      "  llamó. Es opcional: sin ella, el movimiento queda sin cuenta asignada;",
      "  nunca le pidas que elija una. Si tiene más de una cuenta parecida te",
      "  va a preguntar cuál es; si no reconoce ninguna, no inventa una cuenta",
      "  nueva (a diferencia de DECLARAR_SALDO).",
      "  Si EOS contestó que un movimiento \"ya estaba anotado\"",
    ].join("\n"),
  },
  {
    donde: "REGISTRAR_PAGO_DEUDA: agrega el párrafo de cuenta",
    viejo: [
      "Hace DOS cosas: baja el saldo de la deuda y registra el gasto del mes.",
      "  Por eso no mandes además REGISTRAR_MOVIMIENTO_PERSONAL por el mismo",
      "  pago: quedaría contado dos veces.",
      "",
      "CORREGIR_MOVIMIENTO",
    ].join("\n"),
    nuevo: [
      "Hace DOS cosas: baja el saldo de la deuda y registra el gasto del mes.",
      "  Por eso no mandes además REGISTRAR_MOVIMIENTO_PERSONAL por el mismo",
      "  pago: quedaría contado dos veces.",
      "  cuenta SOLO si dijo de dónde salió la plata del pago. Opcional: sin",
      "  ella el gasto queda sin cuenta asignada. Para una tarjeta de negocio",
      "  no se resuelve todavía — queda igual sin cuenta, no es un error.",
      "",
      "CORREGIR_MOVIMIENTO",
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
