/**
 * El modelo ve la sesión de trabajo entera, no solo cinco turnos.
 *
 * ============================================================
 * EL DEFECTO (29/09/2026, WhatsApp)
 * ============================================================
 *
 * Sofía pasó una captura a guaraníes ("marrón mocha: USD 14,92 × 6.014,85 =
 * ₲89.742") y siete turnos después pidió sumarle el envío. EOS le pidió el
 * tipo de cambio: el historial eran los últimos 10 mensajes y la conversión
 * había quedado afuera. La regla y los números están en
 * `lib/eos/historial.ts`.
 *
 * ============================================================
 * QUÉ CAMBIA
 * ============================================================
 *
 * Los nodos `01 GW Preparar Entrada` y `03 GW Construir Prompt Rápido`
 * recortaban a 10. Ahora a 24, igual que `TURNOS_DE_HISTORIAL` del gateway en
 * TypeScript. Qué entra de esos 24 lo decide la aplicación antes de mandarlo
 * (la sesión de las últimas tres horas); acá es solo el tope.
 *
 * Hoy n8n atiende los mensajes con foto (etapa 3 del gateway): sin este
 * parche, la misma conversación tendría memoria distinta según haya o no una
 * imagen.
 */

export const TOPE = 24;

export const CAMBIOS_01 = [
  {
    donde: "el tope del historial en la entrada",
    viejo: "historial: Array.isArray(body.historial) ? body.historial.slice(-10) : [],",
    nuevo: `historial: Array.isArray(body.historial) ? body.historial.slice(-${TOPE}) : [],`,
  },
];

export const CAMBIOS_03 = [
  {
    donde: "el tope del historial en el prompt",
    viejo: "? i.historial.slice(-10)",
    nuevo: `? i.historial.slice(-${TOPE})`,
  },
];

function aplicarCambios(texto, cambios, etiqueta) {
  let salida = texto;
  for (const c of cambios) {
    // Ya aplicado: no se toca, para que correrlo dos veces no rompa nada.
    if (salida.includes(c.nuevo) && !salida.includes(c.viejo)) continue;
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

export function aplicar01(texto, etiqueta) {
  return aplicarCambios(texto, CAMBIOS_01, etiqueta);
}

export function aplicar03(texto, etiqueta) {
  return aplicarCambios(texto, CAMBIOS_03, etiqueta);
}
