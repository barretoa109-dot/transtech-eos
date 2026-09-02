/**
 * El andamiaje que los tres gráficos SVG de EOS repiten a mano.
 *
 * ============================================================
 * POR QUÉ ESTO Y NO UN <Grafico /> QUE LO HAGA TODO
 * ============================================================
 *
 * `ScoreChart`, `Historia` (FinanzasDestino) y el de FinanzasTrayectoria
 * comparten el andamiaje —constantes de tamaño, escalas x/y, armado del
 * atributo `d`— pero NO comparten las marcas: uno dibuja línea con área, otro
 * barras con una línea de neto encima, y el tercero además pinta la franja de
 * la reserva y el día del cruce.
 *
 * Un componente único que cubriera los tres terminaría con una prop por cada
 * diferencia, que es la forma más cara de no compartir nada. Así que lo que se
 * comparte es esto: funciones puras, testeables, sin JSX. Cada gráfico sigue
 * dibujando sus propias marcas con las escalas que le devuelve esto.
 *
 * Que el andamiaje estuviera copiado tres veces ya costó un bug de producción:
 * la regla `.axis-label` estaba anidada bajo `.chart-svg`, así que las
 * etiquetas de `.tray-svg` caían al tamaño por defecto del navegador —16px en
 * negrita— y se pisaban entre ellas. Está documentado en `eosApp.css`.
 */

export type Margenes = { izq: number; der: number; arriba: number; abajo: number };

export type Escala = {
  ancho: number;
  alto: number;
  margenes: Margenes;
  /** De índice de punto a coordenada horizontal. */
  x: (i: number) => number;
  /** De valor a coordenada vertical. Más valor, más arriba. */
  y: (v: number) => number;
  /** El piso del área dibujable, donde apoyan las barras y cierra el área. */
  piso: number;
};

export const MARGENES: Margenes = { izq: 8, der: 8, arriba: 16, abajo: 26 };

/**
 * Arma las escalas para una serie de valores.
 *
 * `min`/`max` se pueden forzar (por ejemplo para que el cero entre siempre en
 * un gráfico de barras). Si no, se toman de los datos con un poco de aire
 * arriba para que el punto más alto no quede pegado al borde.
 *
 * Un solo punto es un caso real —el primer día de una serie— y no puede
 * dividir por cero: se ubica en el medio del ancho.
 */
export function escalar(
  valores: number[],
  opciones: {
    ancho: number;
    alto: number;
    margenes?: Margenes;
    min?: number;
    max?: number;
  },
): Escala {
  const m = opciones.margenes ?? MARGENES;
  const { ancho, alto } = opciones;

  const piso = alto - m.abajo;
  const utilAncho = ancho - m.izq - m.der;
  const utilAlto = piso - m.arriba;

  const minDato = valores.length > 0 ? Math.min(...valores) : 0;
  const maxDato = valores.length > 0 ? Math.max(...valores) : 1;

  const min = opciones.min ?? minDato;
  // Un 8% de aire arriba: sin esto, el máximo queda tocando el borde superior
  // y su etiqueta se recorta.
  const max = opciones.max ?? (maxDato === min ? min + 1 : maxDato + (maxDato - min) * 0.08);

  const rango = max - min || 1;

  return {
    ancho,
    alto,
    margenes: m,
    piso,
    x: (i) => (valores.length <= 1 ? m.izq + utilAncho / 2 : m.izq + (i / (valores.length - 1)) * utilAncho),
    y: (v) => m.arriba + (1 - (v - min) / rango) * utilAlto,
  };
}

/**
 * El atributo `d` de una polilínea.
 *
 * Los índices vienen con su valor porque una serie puede tener huecos —días
 * sin dato— y saltearlos NO es lo mismo que dibujar una recta a través de
 * ellos: la posición horizontal tiene que seguir correspondiendo al día.
 */
export function lineaD(puntos: { i: number; v: number }[], e: Escala): string {
  if (puntos.length === 0) return "";
  return puntos
    .map((p, n) => `${n === 0 ? "M" : "L"}${e.x(p.i).toFixed(1)},${e.y(p.v).toFixed(1)}`)
    .join(" ");
}

/**
 * Parte la serie en tramos seguidos, cortando donde faltan días.
 *
 * Una línea entera cruzando un hueco de tres días afirma que el valor fue
 * variando parejo entre los dos extremos, y eso no se sabe: puede haberse
 * desplomado y recuperado. Es la misma regla que el resto del proyecto —no
 * mostrar lo que no se sabe— aplicada al dibujo.
 *
 * Los tramos se dibujan sólidos; quien use esto puede unir los extremos con
 * una línea punteada para que el ojo siga la serie sin que el trazo mienta.
 */
export function tramos(puntos: { i: number; v: number }[]): { i: number; v: number }[][] {
  const salida: { i: number; v: number }[][] = [];
  let actual: { i: number; v: number }[] = [];

  for (const p of puntos) {
    const previo = actual[actual.length - 1];
    if (previo && p.i !== previo.i + 1) {
      salida.push(actual);
      actual = [];
    }
    actual.push(p);
  }
  if (actual.length > 0) salida.push(actual);

  return salida;
}

/** El `d` del área bajo la línea, cerrada contra el piso. */
export function areaD(puntos: { i: number; v: number }[], e: Escala): string {
  if (puntos.length === 0) return "";
  const linea = lineaD(puntos, e);
  const primero = e.x(puntos[0].i).toFixed(1);
  const ultimo = e.x(puntos[puntos.length - 1].i).toFixed(1);
  return `M${primero},${e.piso} ${linea.slice(1)} L${ultimo},${e.piso} Z`;
}

/**
 * Cuáles etiquetas del eje mostrar para que no se pisen.
 *
 * Devuelve los índices, no los textos: quién dibuja decide el formato. El paso
 * se calcula por el ancho disponible y no por una constante, que es lo que
 * hacía que el mismo gráfico se viera bien en el escritorio y amontonado en un
 * teléfono.
 */
export function indicesDeEtiquetas(cantidad: number, ancho: number, anchoEtiqueta = 46): number[] {
  if (cantidad === 0) return [];
  if (cantidad === 1) return [0];

  const caben = Math.max(2, Math.floor(ancho / anchoEtiqueta));
  const paso = Math.max(1, Math.ceil(cantidad / caben));

  const indices: number[] = [];
  for (let i = 0; i < cantidad; i += paso) indices.push(i);

  /*
   * El último siempre entra: es "hoy", el punto que más se mira.
   *
   * Si quedó más cerca del anterior que el paso normal, ese anterior se saca.
   * El umbral es `paso` entero y no `paso / 2`: con paso 3 y una serie de 45
   * puntos, el anteúltimo caía a 2 de distancia —más que la mitad, así que se
   * conservaba— y las dos etiquetas terminaban pegadas. Medido en pantalla.
   */
  const ultimo = cantidad - 1;
  if (indices[indices.length - 1] !== ultimo) {
    if (ultimo - indices[indices.length - 1] < paso) indices.pop();
    indices.push(ultimo);
  }

  return indices;
}
