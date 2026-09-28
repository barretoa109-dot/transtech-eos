/**
 * Videos en el chat: lo que EOS ve y oye de un video.
 *
 * ============================================================
 * POR QUÉ UN VIDEO NO VIAJA COMO VIDEO
 * ============================================================
 *
 * El modelo del chat mira imágenes y Whisper transcribe audio; ninguno de los
 * dos recibe un video. Y un video de teléfono de medio minuto pesa 20 a 60 MB,
 * que no entran en el cuerpo de un pedido.
 *
 * Así que el navegador lo desarma antes de mandarlo:
 *
 *   - CUADROS_POR_VIDEO fotos, repartidas a lo largo del video, en orden. Es
 *     lo que el modelo ve.
 *   - El audio, en mono a 16 kHz, que es lo que Whisper usa por dentro. Es lo
 *     que el modelo oye, transcripto.
 *
 * Un video de un minuto queda en unos 2 MB en total. El video en sí no se
 * guarda: en la conversación queda el primer cuadro como miniatura, con su
 * duración.
 *
 * Acá están las reglas que se prueban sin navegador: cuánto puede durar, en
 * qué segundos se toman los cuadros, cuántos lugares del mensaje ocupa y cómo
 * se arma el WAV. Lo que necesita un `<video>` y un canvas vive en
 * `app/eos/services/video.ts`.
 */

/** Un minuto: alcanza para mostrar un local, un producto, una góndola. */
export const DURACION_MAXIMA_VIDEO = 60;

/** Lo que pesa un video antes de desarmarlo. Hay que abrirlo entero en memoria. */
export const MAX_BYTES_VIDEO = 150 * 1024 * 1024;

/**
 * Cuatro cuadros: se entiende qué pasa en el video, y cada uno se paga como
 * una imagen. Con un video y cinco fotos el mensaje llega a los diez lugares.
 */
export const CUADROS_POR_VIDEO = 4;

/** El lado largo de cada cuadro. Menos que una foto: es contexto, no un ticket. */
export const LADO_CUADRO_VIDEO = 1024;

/** La frecuencia a la que Whisper remuestrea todo igual. Más es subir de más. */
export const MUESTRAS_POR_SEGUNDO_AUDIO = 16_000;

/**
 * En qué segundos tomar los cuadros: en el medio de cada tramo, así ni el
 * primero cae en el negro del arranque ni el último en el del final.
 */
export function segundosDeLosCuadros(duracion: number, cuadros = CUADROS_POR_VIDEO): number[] {
  if (!Number.isFinite(duracion) || duracion <= 0 || cuadros <= 0) return [];

  return Array.from({ length: cuadros }, (_, i) =>
    Math.round(((i + 0.5) * duracion * 1000) / cuadros) / 1000,
  );
}

/** "0:07", "1:00". Para el nombre de cada cuadro y la miniatura. */
export function formatoDuracion(segundos: number): string {
  const total = Math.max(0, Math.round(Number.isFinite(segundos) ? segundos : 0));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/**
 * ¿Este video se puede mandar? `null` si sí; si no, el motivo para la persona.
 */
export function revisarVideo(nombre: string, bytes: number, duracion: number): string | null {
  if (bytes > MAX_BYTES_VIDEO) {
    return `"${nombre}" pesa más de 150 MB. Recortalo o mandá uno más corto.`;
  }

  if (!Number.isFinite(duracion) || duracion <= 0) {
    return `No pude abrir "${nombre}". Probá con otro video o grabalo de nuevo.`;
  }

  if (duracion > DURACION_MAXIMA_VIDEO + 0.5) {
    return `"${nombre}" dura ${formatoDuracion(duracion)} y el máximo es ${formatoDuracion(
      DURACION_MAXIMA_VIDEO,
    )}. Recortalo y mandalo de nuevo.`;
  }

  return null;
}

/**
 * Mezcla los canales a uno y lo escribe como WAV de 16 bits.
 *
 * WAV y no otro formato porque el navegador no sabe comprimir audio sin una
 * librería, y a 16 kHz en mono un minuto son 1,9 MB: entra.
 */
export function wavMono(canales: Float32Array[], muestrasPorSegundo: number): Uint8Array {
  const largo = canales.reduce((max, c) => Math.max(max, c.length), 0);
  const datos = new Uint8Array(44 + largo * 2);
  const vista = new DataView(datos.buffer);

  const texto = (desde: number, valor: string) => {
    for (let i = 0; i < valor.length; i += 1) vista.setUint8(desde + i, valor.charCodeAt(i));
  };

  texto(0, "RIFF");
  vista.setUint32(4, 36 + largo * 2, true);
  texto(8, "WAVE");
  texto(12, "fmt ");
  vista.setUint32(16, 16, true);
  vista.setUint16(20, 1, true); // PCM
  vista.setUint16(22, 1, true); // mono
  vista.setUint32(24, muestrasPorSegundo, true);
  vista.setUint32(28, muestrasPorSegundo * 2, true);
  vista.setUint16(32, 2, true);
  vista.setUint16(34, 16, true);
  texto(36, "data");
  vista.setUint32(40, largo * 2, true);

  for (let i = 0; i < largo; i += 1) {
    let suma = 0;
    for (const canal of canales) suma += canal[i] ?? 0;

    const muestra = Math.max(-1, Math.min(1, canales.length > 0 ? suma / canales.length : 0));
    vista.setInt16(44 + i * 2, muestra < 0 ? muestra * 0x8000 : muestra * 0x7fff, true);
  }

  return datos;
}

/**
 * ¿Tiene algo que escuchar? Un video grabado sin sonido trae una pista de
 * silencio, y mandarla a Whisper es pagar por transcribir nada (y a veces
 * "inventa" una frase sobre el silencio).
 */
export function tieneSonido(canales: Float32Array[], umbral = 0.01): boolean {
  for (const canal of canales) {
    for (let i = 0; i < canal.length; i += 1) {
      if (Math.abs(canal[i]) > umbral) return true;
    }
  }

  return false;
}

/**
 * Lo que se le dice a EOS junto con el video, para que sepa qué está mirando.
 *
 * Sin esto recibe cuatro fotos sueltas y una transcripción "[Audio]", y no hay
 * forma de saber que son el mismo video, en orden.
 */
export function notaDelVideo(video: {
  nombre: string;
  duracion: number;
  segundos: number[];
  conAudio: boolean;
}): string {
  const momentos = video.segundos.map(formatoDuracion).join(", ");
  const audio = video.conAudio
    ? "El audio del video va transcripto como [Audio]."
    : "El video no tiene sonido.";

  return `[Video "${video.nombre}", dura ${formatoDuracion(video.duracion)}. Las imágenes adjuntas son ${
    video.segundos.length
  } cuadros de ese video, en orden (${momentos}). ${audio}]`;
}
