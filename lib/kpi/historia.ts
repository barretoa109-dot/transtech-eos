import type { Estado, ResultadoKPI, Tendencia, Unidad } from "./tipos.ts";

/**
 * La historia de un indicador, y qué se puede afirmar mirándola.
 *
 * ============================================================
 * DOS PUNTOS NO SON UNA TENDENCIA
 * ============================================================
 *
 * El motor ya compara el período contra el anterior, y eso responde "¿mejor o
 * peor que el mes pasado?". Pero con dos puntos no se puede distinguir "viene
 * bajando hace seis semanas" de "bajó una vez y se recuperó". Son la misma
 * variación y decisiones opuestas.
 *
 * Este módulo trabaja sobre la serie diaria que guarda `v102` y solo afirma lo
 * que la serie soporta. Las funciones son puras: reciben los puntos ya leídos
 * y no consultan nada.
 */

export type PuntoHistoria = {
  fecha: string;
  /** Null cuando ese día no se pudo calcular. No es cero. */
  valor: number | null;
  confianza: number;
  motivo: string | null;
};

export type Serie = {
  indicador: string;
  moneda: string;
  unidad: Unidad;
  puntos: PuntoHistoria[];
};

/**
 * Cuántos días con valor hacen falta para hablar de una racha.
 *
 * Tres es el mismo mínimo que usa `eos_learnings` para dar por bueno un
 * aprendizaje (`minimum_evidence: 3`), y por la misma razón: con dos, el ruido
 * de un día raro se lee como patrón.
 */
export const MINIMO_PARA_RACHA = 3;

/** Los días que efectivamente tienen número, en orden cronológico. */
function conValor(puntos: PuntoHistoria[]): { fecha: string; valor: number }[] {
  return puntos
    .filter((p): p is PuntoHistoria & { valor: number } => p.valor !== null)
    .map((p) => ({ fecha: p.fecha, valor: p.valor }))
    .sort((a, b) => a.fecha.localeCompare(b.fecha));
}

export type Racha = {
  /** Hacia dónde viene yendo, si es que viene yendo a algún lado. */
  direccion: Tendencia;
  /** Cuántos días seguidos sostiene esa dirección. */
  dias: number;
};

/**
 * Cuántos días seguidos viene moviéndose para el mismo lado.
 *
 * Se cuenta desde el final hacia atrás: lo que importa es la racha VIGENTE, no
 * la más larga de la historia. Una serie que subió veinte días y ayer se dio
 * vuelta tiene una racha de bajada de 1, y eso es lo que hay que decir.
 *
 * Los días iguales cortan la racha en vez de extenderla: "no se movió" no es
 * evidencia de que siga subiendo.
 */
export function rachaDe(puntos: PuntoHistoria[]): Racha {
  const datos = conValor(puntos);
  if (datos.length < 2) return { direccion: "desconocida", dias: 0 };

  const paso = (i: number): Tendencia => {
    const delta = datos[i].valor - datos[i - 1].valor;
    if (delta > 0) return "sube";
    if (delta < 0) return "baja";
    return "estable";
  };

  const ultima = paso(datos.length - 1);
  if (ultima === "estable") return { direccion: "estable", dias: 0 };

  let dias = 1;
  for (let i = datos.length - 2; i >= 1; i--) {
    if (paso(i) !== ultima) break;
    dias++;
  }

  return { direccion: ultima, dias };
}

/**
 * El promedio de los últimos `n` días con valor.
 *
 * Sirve para comparar contra un valor suelto sin que un día atípico mande. Es
 * deliberadamente simple —no una media móvil ponderada— porque un promedio que
 * el usuario no puede reproducir a mano es un número en el que no va a confiar.
 */
export function promedioReciente(puntos: PuntoHistoria[], n: number): number | null {
  const datos = conValor(puntos);
  if (datos.length === 0) return null;

  const ultimos = datos.slice(-n);
  return ultimos.reduce((s, p) => s + p.valor, 0) / ultimos.length;
}

/**
 * Qué se puede AFIRMAR de una serie, en una frase, o null si no alcanza.
 *
 * Devolver null es la mitad del trabajo: una serie de dos días no habilita
 * ninguna frase, y escribir "viene subiendo" con dos puntos es exactamente la
 * clase de afirmación que hace que el usuario descubra que EOS exagera.
 */
export function frase(serie: Serie): string | null {
  const racha = rachaDe(serie.puntos);
  if (racha.direccion === "desconocida" || racha.direccion === "estable") return null;
  if (racha.dias < MINIMO_PARA_RACHA) return null;

  const verbo = racha.direccion === "sube" ? "subiendo" : "bajando";
  return `Viene ${verbo} hace ${racha.dias} días seguidos.`;
}

/**
 * Cuántos días seguidos el indicador NO se pudo calcular, contando desde hoy.
 *
 * Es su propia noticia. "El margen lleva tres semanas sin poder calcularse
 * porque nadie carga los costos" es un problema accionable que se ve solo
 * mirando la historia — el cálculo del día no lo distingue de un negocio que
 * recién arranca.
 */
export function diasSinPoderCalcular(puntos: PuntoHistoria[]): number {
  const orden = [...puntos].sort((a, b) => b.fecha.localeCompare(a.fecha));

  let dias = 0;
  for (const p of orden) {
    if (p.valor !== null) break;
    dias++;
  }
  return dias;
}

/**
 * La fila que se guarda por indicador, moneda y día.
 *
 * Se arma desde un `ResultadoKPI` para que la historia y la pantalla no puedan
 * discrepar: es literalmente el mismo número que se mostró ese día.
 */
export type FilaHistoria = {
  usuario_id: string;
  indicador: string;
  moneda: string;
  fecha: string;
  valor: number | null;
  motivo: string | null;
  familia: string;
  unidad: Unidad;
  estado: Estado;
  confianza: number;
};

export function filaDesdeResultado(
  usuarioId: string,
  fecha: string,
  r: ResultadoKPI,
): FilaHistoria {
  return {
    usuario_id: usuarioId,
    indicador: r.id,
    moneda: r.moneda,
    fecha,
    valor: r.valor,
    motivo: r.falta,
    familia: r.familia,
    unidad: r.unidad,
    estado: r.estado,
    confianza: r.confianza.nivel,
  };
}
