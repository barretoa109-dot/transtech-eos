const OPENAI_TRANSCRIBE_URL = "https://api.openai.com/v1/audio/transcriptions";
const MODELO_TRANSCRIPCION = "whisper-1";

export type ArchivoParaTranscribir = { nombre: string; tipo: string; base64: string };

/**
 * La extensión que le importa a Whisper, no la que mandó el emisor.
 *
 * WhatsApp manda `mime_type: "audio/ogg; codecs=opus"` —con parámetros—, y
 * un `nombre` que puede no tener extensión. Whisper decide el formato por el
 * nombre del archivo, así que hace falta una extensión real.
 */
export function extensionDe(tipo: string): string {
  const base = tipo.split(";")[0].trim().toLowerCase();

  if (base.includes("ogg")) return "ogg";
  if (base.includes("mp4") || base.includes("m4a")) return "m4a";
  if (base.includes("mpeg") || base.includes("mp3")) return "mp3";
  if (base.includes("wav")) return "wav";
  if (base.includes("webm")) return "webm";

  return "ogg";
}

/**
 * Transcribe un audio a texto con Whisper.
 *
 * Devuelve `null` ante cualquier problema —sin `OPENAI_API_KEY`, de red, o
 * que la API falle—: quien llama sigue con el mensaje de texto que haya, si
 * lo hay, igual que con el análisis de documentos adjuntos
 * (`analizarArchivoSincrono` en `procesar-mensaje.ts`).
 */
export async function transcribirAudio(archivo: ArchivoParaTranscribir): Promise<string | null> {
  const clave = process.env.OPENAI_API_KEY;
  if (!clave) return null;

  try {
    const bytes = Buffer.from(archivo.base64, "base64");
    const nombre = archivo.nombre || `audio.${extensionDe(archivo.tipo)}`;

    const formulario = new FormData();
    formulario.append("model", MODELO_TRANSCRIPCION);
    formulario.append("file", new Blob([new Uint8Array(bytes)], { type: archivo.tipo }), nombre);

    const respuesta = await fetch(OPENAI_TRANSCRIBE_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${clave}` },
      body: formulario,
    });

    if (!respuesta.ok) {
      console.error("Audio: la transcripción falló con status", respuesta.status);
      return null;
    }

    const datos = (await respuesta.json()) as { text?: string };
    const texto = (datos.text || "").trim();

    return texto || null;
  } catch (error) {
    console.error("Audio: error transcribiendo:", error);
    return null;
  }
}
