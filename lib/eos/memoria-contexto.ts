/**
 * Lo que EOS ya sabe de esta persona, escrito para el prompt.
 *
 * ============================================================
 * GUARDABA MEMORIA Y NUNCA LA LEÍA
 * ============================================================
 *
 * `GUARDAR_MEMORIA` es la acción más ejecutada del sistema: 10 de las 14
 * autorizadas por la puerta de autonomía en producción. La cabecera del chat
 * dice "Memoria contextual" con un ícono. Hay 20 memorias, 54 objetivos y 152
 * aprendizajes guardados.
 *
 * Y el prompt que recibe el modelo lleva: nombre, plan, origen, las cifras del
 * mes, los últimos diez turnos y el mensaje. Nada más. Ni una de esas tablas
 * se lee nunca.
 *
 * Ese es el mecanismo detrás de "se confunde demasiado fácil": no es que
 * olvide, es que nunca se le contó. Cada conversación nueva arranca de cero
 * sobre una base de datos llena de contexto, y la persona del otro lado —que
 * vio a EOS decir "lo voy a recordar"— lo lee como que se olvidó.
 *
 * ============================================================
 * MENOS Y MEJOR, NO TODO
 * ============================================================
 *
 * Volcar las tres tablas enteras sería peor que no mandar nada. Lo guardado
 * tiene repetidos —la misma memoria escrita tres veces con segundos de
 * diferencia, el mismo objetivo creado tres veces desde el mismo mensaje— y un
 * modelo al que se le repite un dato tres veces lo trata como tres datos.
 *
 * Por eso todo lo de acá filtra, deduplica, ordena por lo que más pesa y
 * corta. Los topes son bajos a propósito: el prompt de hoy son ~1.300 tokens y
 * esto agrega a lo sumo unos 300. Lo que no entra no se pierde, sigue en la
 * base; lo que entra es lo que cambia una respuesta.
 */

/** Recortar sin cortar una palabra al medio ni dejar el corte invisible. */
function recortar(texto: string, tope: number): string {
  const limpio = texto.replace(/\s+/g, " ").trim();
  if (limpio.length <= tope) return limpio;

  const cortado = limpio.slice(0, tope);
  const ultimoEspacio = cortado.lastIndexOf(" ");

  return `${(ultimoEspacio > tope * 0.6 ? cortado.slice(0, ultimoEspacio) : cortado).trimEnd()}…`;
}

/**
 * La clave con la que dos filas se consideran la misma.
 *
 * Sin acentos y sin puntuación porque los duplicados de producción vienen del
 * mismo mensaje reprocesado: difieren en una coma, no en el contenido.
 */
function clave(texto: string): string {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function sinRepetidos<T>(filas: T[], deQue: (f: T) => string): T[] {
  const vistas = new Set<string>();
  const salida: T[] = [];

  for (const fila of filas) {
    const k = clave(deQue(fila));
    if (!k || vistas.has(k)) continue;
    vistas.add(k);
    salida.push(fila);
  }

  return salida;
}

export type MemoriaGuardada = {
  titulo?: string | null;
  contenido?: string | null;
  importancia?: number | null;
  estado?: string | null;
};

export type ObjetivoAbierto = {
  titulo?: string | null;
  progreso?: number | null;
  fecha_limite?: string | null;
  proximo_paso?: string | null;
  estado?: string | null;
};

export type AprendizajeUtil = {
  recomendacion?: string | null;
  confianza?: number | null;
  evidence_count?: number | null;
  estado?: string | null;
};

export const TOPES = {
  memorias: 8,
  objetivos: 5,
  aprendizajes: 3,
  /** Caracteres por línea. Alcanza para una frase completa, no para un párrafo. */
  linea: 170,
  /**
   * Un aprendizaje con poca evidencia es una corazonada del sistema sobre sí
   * mismo. Ponérsela al modelo como si fuera un hecho es la forma más
   * silenciosa de que empeore: le cambia el comportamiento sin que nadie lo
   * haya decidido y sin que se vea en ninguna pantalla.
   */
  confianzaMinima: 0.7,
  evidenciaMinima: 3,
} as const;

/**
 * El bloque de memoria, o cadena vacía si no hay nada que valga la pena.
 *
 * Vacío y no un encabezado sin contenido: "Lo que ya sabés de esta persona:"
 * seguido de nada le dice al modelo que no sabe nada de nadie, que es peor que
 * no tocar el tema.
 */
export function textoMemoria(datos: {
  memorias?: MemoriaGuardada[] | null;
  objetivos?: ObjetivoAbierto[] | null;
  aprendizajes?: AprendizajeUtil[] | null;
}): string {
  const partes: string[] = [];

  const memorias = sinRepetidos(
    (datos.memorias ?? [])
      .filter((m) => (m.estado ?? "activo") === "activo")
      .filter((m) => (m.contenido ?? "").trim() || (m.titulo ?? "").trim())
      .sort((a, b) => (b.importancia ?? 0) - (a.importancia ?? 0)),
    (m) => `${m.contenido ?? ""} ${m.titulo ?? ""}`,
  ).slice(0, TOPES.memorias);

  if (memorias.length > 0) {
    const lineas = memorias.map((m) => {
      const cuerpo = (m.contenido ?? "").trim() || (m.titulo ?? "").trim();
      return `  - ${recortar(cuerpo, TOPES.linea)}`;
    });

    partes.push(`Lo que te contó y quedó guardado:\n${lineas.join("\n")}`);
  }

  const objetivos = sinRepetidos(
    (datos.objetivos ?? [])
      .filter((o) => (o.estado ?? "activo") === "activo")
      .filter((o) => (o.titulo ?? "").trim()),
    (o) => o.titulo ?? "",
  ).slice(0, TOPES.objetivos);

  if (objetivos.length > 0) {
    const lineas = objetivos.map((o) => {
      const detalle: string[] = [];

      // El progreso solo cuando alguien lo movió: "0%" en todos los objetivos
      // es ruido, y encima el ruido de un campo que nadie completó.
      if (typeof o.progreso === "number" && o.progreso > 0) {
        detalle.push(`${Math.round(o.progreso)}%`);
      }
      if (o.fecha_limite) detalle.push(`para el ${o.fecha_limite}`);
      if ((o.proximo_paso ?? "").trim()) {
        detalle.push(`sigue: ${recortar(o.proximo_paso as string, 70)}`);
      }

      const cola = detalle.length > 0 ? ` (${detalle.join(", ")})` : "";
      return `  - ${recortar(o.titulo as string, TOPES.linea)}${cola}`;
    });

    partes.push(`Lo que se propuso:\n${lineas.join("\n")}`);
  }

  const aprendizajes = sinRepetidos(
    (datos.aprendizajes ?? [])
      .filter((a) => (a.estado ?? "activo") === "activo")
      .filter((a) => (a.recomendacion ?? "").trim())
      .filter((a) => (a.confianza ?? 0) >= TOPES.confianzaMinima)
      .filter((a) => (a.evidence_count ?? 0) >= TOPES.evidenciaMinima)
      .sort((a, b) => (b.confianza ?? 0) - (a.confianza ?? 0)),
    (a) => a.recomendacion ?? "",
  ).slice(0, TOPES.aprendizajes);

  if (aprendizajes.length > 0) {
    const lineas = aprendizajes.map((a) => `  - ${recortar(a.recomendacion as string, TOPES.linea)}`);

    // "Con esta persona funcionó" y no "hacé esto": es una observación sobre
    // conversaciones anteriores, no una orden. Presentarla como orden le daría
    // a un patrón estadístico la misma autoridad que a una instrucción del
    // usuario.
    partes.push(`Lo que con esta persona funcionó antes:\n${lineas.join("\n")}`);
  }

  return partes.join("\n");
}
