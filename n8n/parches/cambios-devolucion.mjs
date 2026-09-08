/**
 * El prompt aprende a distinguir una devolución de un ingreso.
 *
 * No hay acción nueva: `REGISTRAR_MOVIMIENTO_PERSONAL` acepta
 * `tipo: "devolucion"`. Una acción aparte sería redundante —los datos son los
 * mismos— y cada acción nueva son cuatro lugares en n8n y tres `check`.
 */

export const CAMBIOS = [
  {
    donde: "el tipo de movimiento personal",
    viejo: [
      "  tipo es gasto o ingreso, y no se adivina de la descripcion: cobré e",
      "  invertí se parecen lo suficiente como para equivocar el signo, y un",
      "  gasto contado como ingreso mueve el disponible al doble para el lado",
      "  que no es.",
    ].join("\n"),
    nuevo: [
      "  tipo es gasto, ingreso o devolucion, y no se adivina de la",
      "  descripcion: cobré e invertí se parecen lo suficiente como para",
      "  equivocar el signo, y un gasto contado como ingreso mueve el",
      "  disponible al doble para el lado que no es.",
      "  DEVOLUCION es plata que había salido y volvió: te devolvieron una",
      '  compra, te reintegraron algo, te reembolsaron un pasaje. "Devolví la',
      '  camisa y me dieron los 200 mil", "me reintegraron el remedio".',
      "  No es un ingreso: la persona no ganó nada, dejó de gastar. Mandarlo",
      "  como ingreso le infla lo que cobró en el mes y con eso su capacidad de",
      "  ahorro, y encima deja el gasto original entero en su categoría.",
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
