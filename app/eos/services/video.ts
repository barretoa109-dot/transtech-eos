import {
  CUADROS_POR_VIDEO,
  LADO_CUADRO_VIDEO,
  MUESTRAS_POR_SEGUNDO_AUDIO,
  revisarVideo,
  segundosDeLosCuadros,
  tieneSonido,
  wavMono,
} from "@/lib/eos/videos";
import { medidaParaModelo } from "@/lib/eos/adjuntos";

import type { ArchivoAdjunto } from "../types/chat";

/**
 * Desarma un video en el navegador: cuadros para que EOS lo vea y el audio
 * para que lo oiga. Las reglas y el porqué están en `lib/eos/videos.ts`.
 *
 * El video en sí nunca sale del teléfono.
 */

/** Lo que se espera a que el navegador abra el video o salte a un cuadro. */
const ESPERA_MS = 15_000;

const CALIDAD_CUADRO = 0.8;

export async function procesarVideo(file: File): Promise<ArchivoAdjunto> {
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");

  // Mudo y en línea: sin esto Safari en el iPhone no carga ni un cuadro sin
  // que la persona toque "reproducir".
  video.muted = true;
  video.playsInline = true;
  video.setAttribute("playsinline", "");
  video.preload = "auto";
  video.src = url;

  try {
    await esperar(video, "loadedmetadata");

    const duracion = await duracionDe(video);
    const rechazo = revisarVideo(file.name, file.size, duracion);
    if (rechazo) throw new Error(rechazo);

    // Los cuadros y el audio en paralelo: el audio lee el archivo entero y
    // los cuadros esperan al decodificador de video, no se estorban.
    const segundos = segundosDeLosCuadros(duracion, CUADROS_POR_VIDEO);
    const [cuadros, audio] = await Promise.all([
      tomarCuadros(video, segundos),
      extraerAudio(file, duracion),
    ]);

    if (cuadros.length === 0) {
      throw new Error(`No pude leer las imágenes de "${file.name}". Probá con otro video.`);
    }

    const partes = [...cuadros, ...(audio ? [audio] : [])].map((base64) => ({ base64 }));

    return {
      nombre: file.name,
      tipo: file.type || "video/mp4",
      tamanio: file.size,
      // Lo que se ve como miniatura: el primer cuadro.
      base64: cuadros[0],
      partes,
      video: {
        duracion,
        segundos: segundos.slice(0, cuadros.length),
        cuadros,
        audio,
      },
    };
  } finally {
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
}

async function tomarCuadros(video: HTMLVideoElement, segundos: number[]): Promise<string[]> {
  const medida =
    medidaParaModelo(video.videoWidth, video.videoHeight, LADO_CUADRO_VIDEO) ?? {
      ancho: video.videoWidth,
      alto: video.videoHeight,
    };

  if (!medida.ancho || !medida.alto) return [];

  const lienzo = document.createElement("canvas");
  lienzo.width = medida.ancho;
  lienzo.height = medida.alto;
  const pincel = lienzo.getContext("2d");
  if (!pincel) return [];

  const cuadros: string[] = [];

  for (const segundo of segundos) {
    video.currentTime = segundo;
    await esperar(video, "seeked");

    pincel.drawImage(video, 0, 0, medida.ancho, medida.alto);

    const blob = await new Promise<Blob | null>((resolve) =>
      lienzo.toBlob(resolve, "image/jpeg", CALIDAD_CUADRO),
    );

    if (blob) cuadros.push(await blobABase64(blob));
  }

  return cuadros;
}

/**
 * El audio del video, en mono a 16 kHz, como WAV en base64.
 *
 * Devuelve `null` si no tiene audio, si es silencio o si el navegador no sabe
 * decodificarlo: el video se manda igual, con los cuadros solos.
 */
async function extraerAudio(file: File, duracion: number): Promise<string | null> {
  const Contexto =
    typeof OfflineAudioContext !== "undefined"
      ? OfflineAudioContext
      : (window as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext })
          .webkitOfflineAudioContext;

  if (!Contexto) return null;

  try {
    const largo = Math.max(1, Math.ceil(duracion * MUESTRAS_POR_SEGUNDO_AUDIO));
    const contexto = new Contexto(1, largo, MUESTRAS_POR_SEGUNDO_AUDIO);

    // decodeAudioData remuestrea a la frecuencia del contexto: 16 kHz.
    const decodificado = await contexto.decodeAudioData(await file.arrayBuffer());

    const canales = Array.from({ length: decodificado.numberOfChannels }, (_, i) =>
      decodificado.getChannelData(i),
    );

    if (!tieneSonido(canales)) return null;

    return bytesABase64(wavMono(canales, decodificado.sampleRate));
  } catch {
    return null;
  }
}

/**
 * La duración, aunque el archivo no la diga.
 *
 * Un WebM grabado desde un navegador no trae la duración en la cabecera y
 * `duration` da `Infinity`. Saltar a un punto imposible obliga al navegador a
 * recorrerlo hasta el final, y ahí la sabe.
 */
async function duracionDe(video: HTMLVideoElement): Promise<number> {
  if (Number.isFinite(video.duration)) return video.duration;

  video.currentTime = Number.MAX_SAFE_INTEGER;
  await esperar(video, "seeked").catch(() => undefined);

  const duracion = video.duration;
  video.currentTime = 0;
  await esperar(video, "seeked").catch(() => undefined);

  return duracion;
}

function esperar(video: HTMLVideoElement, evento: "loadedmetadata" | "seeked"): Promise<void> {
  return new Promise((resolve, reject) => {
    const reloj = window.setTimeout(() => {
      limpiar();
      reject(new Error("El video tardó demasiado en abrirse. Probá con uno más corto."));
    }, ESPERA_MS);

    const listo = () => {
      limpiar();
      resolve();
    };

    const fallo = () => {
      limpiar();
      reject(new Error("No pude abrir el video. Probá con otro formato (MP4 o MOV)."));
    };

    function limpiar() {
      window.clearTimeout(reloj);
      video.removeEventListener(evento, listo);
      video.removeEventListener("error", fallo);
    }

    video.addEventListener(evento, listo, { once: true });
    video.addEventListener("error", fallo, { once: true });
  });
}

function blobABase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const lector = new FileReader();
    lector.onload = () => resolve(String(lector.result ?? "").split(",")[1] ?? "");
    lector.onerror = () => reject(new Error("No se pudo leer un cuadro del video."));
    lector.readAsDataURL(blob);
  });
}

function bytesABase64(bytes: Uint8Array): string {
  let binario = "";
  const bloque = 0x8000;

  // De a bloques: `String.fromCharCode(...bytes)` con 2 MB revienta la pila.
  for (let i = 0; i < bytes.length; i += bloque) {
    binario += String.fromCharCode(...bytes.subarray(i, i + bloque));
  }

  return btoa(binario);
}
