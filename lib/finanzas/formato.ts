import { decimalesDe, simboloDe } from "./monedas.ts";

/**
 * Cómo se escribe la plata en pantalla.
 *
 * Vive acá y no dentro de un componente porque el mismo monto aparece en el
 * panel de estado y en el desglose de destinos, uno debajo del otro: si dos
 * copias de esta función se separan aunque sea en un decimal, el usuario ve la
 * misma cifra escrita de dos formas distintas en la misma pantalla y deja de
 * creerle a las dos.
 */

/**
 * Guaraníes sin decimales: nadie escribe ₲ 1.500,00. El resto de las monedas
 * SÍ los lleva —un dólar redondeado a la unidad deja de cerrar contra el
 * extracto—, y cuántos lleva cada una lo decide `lib/finanzas/monedas.ts`, que
 * es la única lista de monedas del proyecto.
 */
export function formatearMonto(valor: number, moneda: string): string {
  const codigo = (moneda || "PYG").toUpperCase();
  const decimales = decimalesDe(codigo);

  const formateado = new Intl.NumberFormat("es-PY", {
    minimumFractionDigits: decimales,
    maximumFractionDigits: decimales,
  }).format(decimales === 0 ? Math.round(valor) : valor);

  return `${simboloDe(codigo)} ${formateado}`.trim();
}

const MESES_CORTOS = [
  "ene",
  "feb",
  "mar",
  "abr",
  "may",
  "jun",
  "jul",
  "ago",
  "set",
  "oct",
  "nov",
  "dic",
];

const MESES_LARGOS = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];

/**
 * Nombre del mes a partir de un `YYYY-MM`, sin pasar por `new Date`.
 *
 * `new Date("2026-08")` es medianoche UTC del 1: formateado en la zona de
 * Paraguay (UTC-3/-4) muestra julio. Un mes de diferencia en un título como
 * "en qué se te fue la plata en julio" es un error que se nota enseguida.
 */
export function nombreDelMes(mesISO: string, largo = false): string {
  const mes = Number(mesISO.slice(5, 7));
  if (!mes || mes < 1 || mes > 12) return mesISO;
  return (largo ? MESES_LARGOS : MESES_CORTOS)[mes - 1];
}
