import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import ffmpeg from "ffmpeg-static";

import type { ArchivoEOS } from "@/lib/eos/procesar-mensaje";
import {
  CUADROS_POR_VIDEO,
  DURACION_MAXIMA_VIDEO_WHATSAPP,
  LADO_CUADRO_VIDEO,
  MUESTRAS_POR_SEGUNDO_AUDIO,
  duracionDeFfmpeg,
  formatoDuracion,
  notaDelVideo,
  segundosDeLosCuadros,
  wavTieneSonido,
} from "@/lib/eos/videos";

import { descargarBytes } from "./media";

const ejecutar = promisify(execFile);

/** Lo que se le da a ffmpeg por paso. Cuatro cuadros y el audio tardan menos de un segundo. */
const ESPERA_MS = 20_000;

/** Salida de ffmpeg que se acepta: un minuto de WAV a 16 kHz son 1,9 MB; tres, 5,8. */
const MAX_SALIDA = 12 * 1024 * 1024;

export type VideoDesarmado =
  | { ok: true; archivos: ArchivoEOS[]; nota: string }
  | { ok: false; aviso: string };

/**
 * Un video de WhatsApp, desarmado como en la app: cuadros para que EOS lo vea
 * y el audio para que lo oiga (`lib/eos/videos.ts` explica por qué).
 *
 * En la app lo hace el navegador; acá el video llega al servidor, así que lo
 * hace ffmpeg (`ffmpeg-static`, incluido en la función por
 * `outputFileTracingIncludes` en `next.config.ts`).
 *
 * Nunca lanza: si algo falla devuelve el aviso que se le manda a la persona.
 */
export async function desarmarVideoDeWhatsapp(
  mediaId: string,
  mimeType: string,
  nombre: string,
): Promise<VideoDesarmado> {
  const noPude = {
    ok: false as const,
    aviso: "No pude abrir el video que me mandaste. Probá mandarlo de nuevo, o una captura de lo que querés que mire.",
  };

  if (!ffmpeg) {
    console.error("WhatsApp: ffmpeg-static no trae binario para esta plataforma.");
    return noPude;
  }

  const bajado = await descargarBytes(mediaId, mimeType);
  if (!bajado) {
    return { ok: false, aviso: "No pude bajar el video que me mandaste desde WhatsApp. Mandalo de nuevo y lo miro." };
  }

  const carpeta = await mkdtemp(path.join(tmpdir(), "eos-video-"));
  const archivo = path.join(carpeta, "video");

  try {
    await writeFile(archivo, bajado.bytes);

    const duracion = await duracionDe(ffmpeg, archivo);
    if (!duracion) return noPude;

    if (duracion > DURACION_MAXIMA_VIDEO_WHATSAPP + 0.5) {
      return {
        ok: false,
        aviso: `El video dura ${formatoDuracion(duracion)} y puedo mirar hasta ${formatoDuracion(
          DURACION_MAXIMA_VIDEO_WHATSAPP,
        )}. Mandame un recorte con la parte que importa.`,
      };
    }

    const segundos = segundosDeLosCuadros(duracion, CUADROS_POR_VIDEO);
    const [cuadros, audio] = await Promise.all([
      Promise.all(segundos.map((s) => cuadroEn(ffmpeg!, archivo, s))),
      audioDe(ffmpeg, archivo),
    ]);

    const tomados = segundos
      .map((segundo, i) => ({ segundo, bytes: cuadros[i] }))
      .filter((c): c is { segundo: number; bytes: Buffer } => c.bytes !== null);

    if (tomados.length === 0) return noPude;

    const base = nombre.replace(/\.[^.]+$/, "") || "whatsapp-video";

    const archivos: ArchivoEOS[] = tomados.map(({ segundo, bytes }, i) => ({
      nombre: `${base} - cuadro ${i + 1} (${formatoDuracion(segundo)}).jpg`,
      tipo: "image/jpeg",
      tamanio: bytes.length,
      base64: bytes.toString("base64"),
      extension: "jpg",
    }));

    if (audio) {
      archivos.push({
        nombre: `${base} - audio.wav`,
        tipo: "audio/wav",
        tamanio: audio.length,
        base64: audio.toString("base64"),
        extension: "wav",
      });
    }

    return {
      ok: true,
      archivos,
      nota: notaDelVideo({
        nombre: base,
        duracion,
        segundos: tomados.map((c) => c.segundo),
        conAudio: Boolean(audio),
      }),
    };
  } catch (error) {
    console.error("WhatsApp: error desarmando un video:", error);
    return noPude;
  } finally {
    await rm(carpeta, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** ffmpeg sin salida imprime los datos del archivo y termina con error: es lo esperado. */
async function duracionDe(binario: string, archivo: string): Promise<number | null> {
  try {
    const { stderr } = await ejecutar(binario, ["-hide_banner", "-i", archivo], {
      timeout: ESPERA_MS,
    });
    return duracionDeFfmpeg(stderr);
  } catch (error) {
    return duracionDeFfmpeg(String((error as { stderr?: string }).stderr ?? ""));
  }
}

async function cuadroEn(binario: string, archivo: string, segundo: number): Promise<Buffer | null> {
  const lado = LADO_CUADRO_VIDEO;

  try {
    const { stdout } = await ejecutar(
      binario,
      [
        "-hide_banner",
        "-loglevel", "error",
        "-ss", String(segundo),
        "-i", archivo,
        "-frames:v", "1",
        // El lado largo a 1024 como mucho, sin agrandar ni deformar.
        "-vf", `scale='if(gt(iw,ih),min(${lado},iw),-2)':'if(gt(iw,ih),-2,min(${lado},ih))'`,
        "-q:v", "4",
        "-f", "image2",
        "-c:v", "mjpeg",
        "pipe:1",
      ],
      { encoding: "buffer", maxBuffer: MAX_SALIDA, timeout: ESPERA_MS },
    );

    return stdout.length > 0 ? stdout : null;
  } catch {
    return null;
  }
}

/** El audio en mono a 16 kHz. `null` si no tiene, o si es silencio. */
async function audioDe(binario: string, archivo: string): Promise<Buffer | null> {
  try {
    const { stdout } = await ejecutar(
      binario,
      [
        "-hide_banner",
        "-loglevel", "error",
        "-i", archivo,
        "-vn",
        "-map_metadata", "-1",
        "-fflags", "+bitexact",
        "-flags:a", "+bitexact",
        "-ac", "1",
        "-ar", String(MUESTRAS_POR_SEGUNDO_AUDIO),
        "-t", String(DURACION_MAXIMA_VIDEO_WHATSAPP),
        "-f", "wav",
        "pipe:1",
      ],
      { encoding: "buffer", maxBuffer: MAX_SALIDA, timeout: ESPERA_MS },
    );

    return wavTieneSonido(stdout) ? stdout : null;
  } catch {
    // Sin pista de audio ffmpeg termina con error: el video va sin audio.
    return null;
  }
}
