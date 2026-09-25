/**
 * La aritmética del gráfico "Evolución del EOS Score", sin JSX.
 *
 * Vive acá y no en el componente por la misma razón que `escala.ts`: es lo que
 * se puede equivocar en silencio —un día contado dos veces, una curva que se
 * pasa de 100, un promedio que incluye días fuera del período— y lo que se
 * puede testear sin montar nada.
 */

export type PuntoScore = { fecha: string; score: number };

const DIA_MS = 86_400_000;

/** Días entre dos fechas `AAAA-MM-DD`, en UTC para que el horario de verano no reste una hora. */
export function diasEntre(desde: string, hasta: string): number {
  return Math.round((Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / DIA_MS);
}

/** Resta días a una fecha `AAAA-MM-DD`. */
export function restarDias(fecha: string, dias: number): string {
  return new Date(Date.parse(`${fecha}T00:00:00Z`) - dias * DIA_MS).toISOString().slice(0, 10);
}

/**
 * Un punto por día, del más viejo al más nuevo.
 *
 * Un mismo día puede tener más de un briefing (se regenera a mano, o el
 * respaldo automático y el enriquecido llegan los dos). Vale el ÚLTIMO que
 * llegó en la lista, que es el que la API manda al final de cada fecha. Contar
 * los dos haría que ese día pese doble en el promedio.
 */
export function unoPorDia(puntos: PuntoScore[]): PuntoScore[] {
  const porFecha = new Map<string, number>();
  for (const p of puntos) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(p.fecha) || !Number.isFinite(p.score)) continue;
    porFecha.set(p.fecha, Math.min(100, Math.max(0, p.score)));
  }
  return [...porFecha.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([fecha, score]) => ({ fecha, score }));
}

/** Los puntos de los últimos `dias` contando hoy. */
export function ventana(serie: PuntoScore[], dias: number, hoy: string): PuntoScore[] {
  const desde = restarDias(hoy, dias - 1);
  return serie.filter((p) => p.fecha >= desde && p.fecha <= hoy);
}

export type Resumen = {
  actual: number;
  /** Cambio contra el primer punto del período. null si hay un solo punto. */
  cambio: number | null;
  promedio: number;
  maximo: number;
  minimo: number;
};

export function resumir(serie: PuntoScore[]): Resumen | null {
  if (serie.length === 0) return null;
  const valores = serie.map((p) => p.score);
  const actual = valores[valores.length - 1];
  return {
    actual,
    cambio: serie.length > 1 ? actual - valores[0] : null,
    promedio: Math.round(valores.reduce((a, b) => a + b, 0) / valores.length),
    maximo: Math.max(...valores),
    minimo: Math.min(...valores),
  };
}

export type Zona = "bajo" | "medio" | "alto";

/** Las mismas franjas que se pintan de fondo en el gráfico. */
export function zona(score: number): Zona {
  if (score < 40) return "bajo";
  if (score < 70) return "medio";
  return "alto";
}

/**
 * El `d` de una curva suave que pasa por todos los puntos sin inventar picos.
 *
 * Es la interpolación monótona de Fritsch–Carlson (la `curveMonotoneX` de
 * d3): entre dos puntos la curva nunca sube por encima del mayor ni baja por
 * debajo del menor. Una Bézier común "redondea" pasándose, y en un score
 * acotado a 0–100 eso dibuja un 103 que no existió.
 */
export function curvaD(pts: { x: number; y: number }[]): string {
  const n = pts.length;
  if (n === 0) return "";
  if (n === 1) return `M${f(pts[0].x)},${f(pts[0].y)}`;
  if (n === 2) return `M${f(pts[0].x)},${f(pts[0].y)} L${f(pts[1].x)},${f(pts[1].y)}`;

  const dx: number[] = [];
  const pend: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx[i] = pts[i + 1].x - pts[i].x;
    pend[i] = dx[i] === 0 ? 0 : (pts[i + 1].y - pts[i].y) / dx[i];
  }

  const t: number[] = [pend[0]];
  for (let i = 1; i < n - 1; i++) {
    if (pend[i - 1] * pend[i] <= 0) {
      t[i] = 0;
    } else {
      const w1 = 2 * dx[i] + dx[i - 1];
      const w2 = dx[i] + 2 * dx[i - 1];
      t[i] = (w1 + w2) / (w1 / pend[i - 1] + w2 / pend[i]);
    }
  }
  t[n - 1] = pend[n - 2];

  let d = `M${f(pts[0].x)},${f(pts[0].y)}`;
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3;
    d += ` C${f(pts[i].x + h)},${f(pts[i].y + t[i] * h)} ${f(pts[i + 1].x - h)},${f(pts[i + 1].y - t[i + 1] * h)} ${f(pts[i + 1].x)},${f(pts[i + 1].y)}`;
  }
  return d;
}

function f(v: number): string {
  return v.toFixed(1);
}

/** El índice del punto más cercano a una coordenada horizontal. */
export function masCercano(xs: number[], x: number): number {
  let mejor = 0;
  for (let i = 1; i < xs.length; i++) {
    if (Math.abs(xs[i] - x) < Math.abs(xs[mejor] - x)) mejor = i;
  }
  return mejor;
}
