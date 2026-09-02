import { formatearMonto } from "../finanzas/formato.ts";
import type { Direccion, Estado, ResultadoKPI, Tendencia, Unidad } from "./tipos.ts";

/**
 * Cómo se escribe un indicador en pantalla.
 *
 * ============================================================
 * POR QUÉ ESTO NO VIVE EN EL COMPONENTE
 * ============================================================
 *
 * Un indicador se va a mostrar en el panel ejecutivo, en Rentabilidad, en el
 * briefing por correo y —cuando el chat tenga tools— adentro de una respuesta
 * de EOS. Si cada uno decide por su cuenta cuántos decimales lleva un margen,
 * el usuario ve "70%" en una pantalla y "70,4%" en otra para el mismo mes, y
 * no tiene forma de saber cuál creer.
 *
 * Es la misma razón por la que existe `lib/finanzas/formato.ts`, y este
 * módulo se apoya en él para todo lo que es plata en vez de reimplementarlo.
 */

/**
 * Los porcentajes van con un decimal y las cantidades sin ninguno.
 *
 * Un decimal en un margen es información real —69,8% y 70,3% son decisiones
 * distintas cuando el negocio es chico—, pero "3,5 oportunidades estancadas"
 * no significa nada: las cosas que se cuentan son enteras.
 *
 * `unidades_por_ticket` es la excepción y por eso `cantidad` no redondea a
 * entero: un promedio de 3,5 unidades por venta sí es un número con sentido.
 */
export function formatearValor(valor: number, unidad: Unidad, moneda: string): string {
  switch (unidad) {
    case "moneda":
      return formatearMonto(valor, moneda);
    case "porcentaje":
      return `${numero(valor, 1)}%`;
    case "dias":
      return `${numero(valor, 1)} días`;
    case "ratio":
      return numero(valor, 2);
    case "cantidad":
      return numero(valor, 1);
  }
}

/**
 * Todo número que no sea plata pasa por acá, en `es-PY`.
 *
 * El locale no es un detalle: sin él, `${69.83}` sale "69.83" con PUNTO
 * decimal, y en la misma pantalla `toLocaleString("es-PY")` escribe "3,5" con
 * coma. Dos separadores distintos en un mismo panel es exactamente la clase
 * de inconsistencia que hace dudar del resto de los números.
 */
function numero(valor: number, decimales: number): string {
  return valor.toLocaleString("es-PY", { maximumFractionDigits: decimales });
}

/**
 * El texto de la variación contra el período anterior.
 *
 * Devuelve `null` —y no "0%" ni "—"— cuando no hay período anterior con qué
 * comparar. Un "0%" ahí significaría "no cambió", que es una afirmación
 * distinta a "no sé todavía", y es la que hace que alguien concluya que su
 * negocio está estancado cuando en realidad recién arrancó.
 */
export function formatearVariacion(r: ResultadoKPI): string | null {
  if (r.variacion_pct === null) return null;
  const signo = r.variacion_pct > 0 ? "+" : "";
  return `${signo}${numero(r.variacion_pct, 1)}%`;
}

/**
 * Si la variación es una buena o una mala noticia.
 *
 * No alcanza con el signo: que los gastos suban 20% y que las ventas suban
 * 20% son la misma flecha para arriba y noticias opuestas. Por eso cada
 * definición declara su `direccion`, y esto la usa.
 */
export type TonoVariacion = "bueno" | "malo" | "neutro";

export function tonoDeVariacion(tendencia: Tendencia, direccion: Direccion): TonoVariacion {
  if (tendencia === "estable" || tendencia === "desconocida") return "neutro";
  if (direccion === "neutro") return "neutro";

  const subeYEsBueno = tendencia === "sube" && direccion === "mas_es_mejor";
  const bajaYEsBueno = tendencia === "baja" && direccion === "menos_es_mejor";

  return subeYEsBueno || bajaYEsBueno ? "bueno" : "malo";
}

/** La flecha que acompaña a la variación. `estable` no lleva ninguna. */
export function flechaDe(tendencia: Tendencia): string {
  if (tendencia === "sube") return "↑";
  if (tendencia === "baja") return "↓";
  return "";
}

/**
 * Qué se muestra cuando el indicador no tiene valor.
 *
 * Siempre un guion y el motivo, nunca un cero. `falta` viene de la propia
 * definición, que sabe por qué no pudo calcular —"ninguna venta del período
 * tiene costo cargado" le dice al usuario qué hacer; un cero no.
 */
export function textoSinValor(r: ResultadoKPI): string {
  return r.falta ?? "No se pudo calcular";
}

/**
 * El orden en que se muestran: primero lo que reclama atención.
 *
 * Un panel que ordena alfabéticamente esconde la alerta entre veinte números
 * tranquilos. Dentro de cada grupo de estado se conserva el orden del
 * catálogo, que ya está pensado (ventas antes que compras).
 */
const PESO_ESTADO: Record<Estado, number> = {
  alerta: 0,
  atencion: 1,
  bien: 2,
  sin_datos: 3,
};

export function porPrioridad(resultados: ResultadoKPI[]): ResultadoKPI[] {
  return [...resultados]
    .map((r, i) => ({ r, i }))
    .sort((a, b) => PESO_ESTADO[a.r.estado] - PESO_ESTADO[b.r.estado] || a.i - b.i)
    .map(({ r }) => r);
}

/**
 * El aviso de confianza, cuando el número se calculó con datos incompletos.
 *
 * `null` cuando la confianza es total: no hay nada que aclarar y una leyenda
 * en cada tarjeta sería ruido que enseña a ignorar el aviso justo cuando
 * aparece de verdad.
 */
export function avisoDeConfianza(r: ResultadoKPI): string | null {
  if (r.confianza.nivel >= 1 || r.confianza.motivos.length === 0) return null;
  return r.confianza.motivos.join(". ");
}
