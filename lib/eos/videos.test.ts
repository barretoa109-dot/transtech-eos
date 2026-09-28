import test from "node:test";
import assert from "node:assert/strict";

import { revisarAdjuntos, textoPorDefecto, type Adjunto } from "./adjuntos.ts";
import {
  CUADROS_POR_VIDEO,
  DURACION_MAXIMA_VIDEO,
  duracionDeFfmpeg,
  formatoDuracion,
  notaDelVideo,
  revisarVideo,
  segundosDeLosCuadros,
  tieneSonido,
  wavMono,
  wavTieneSonido,
} from "./videos.ts";

test("los cuadros caen en el medio de cada tramo, en orden", () => {
  assert.deepEqual(segundosDeLosCuadros(40), [5, 15, 25, 35]);
  assert.equal(segundosDeLosCuadros(7).length, CUADROS_POR_VIDEO);
  assert.deepEqual(segundosDeLosCuadros(0), []);
  assert.deepEqual(segundosDeLosCuadros(Number.NaN), []);
});

test("la duración se escribe como en un reproductor", () => {
  assert.equal(formatoDuracion(7.4), "0:07");
  assert.equal(formatoDuracion(60), "1:00");
  assert.equal(formatoDuracion(125), "2:05");
});

test("un video largo o que no abre se rechaza con un motivo claro", () => {
  assert.equal(revisarVideo("a.mp4", 10_000_000, 42), null);
  assert.equal(revisarVideo("a.mp4", 10_000_000, DURACION_MAXIMA_VIDEO), null);
  assert.match(revisarVideo("largo.mov", 10_000_000, 95) ?? "", /dura 1:35 y el máximo es 1:00/);
  assert.match(revisarVideo("roto.mov", 10_000_000, Number.NaN) ?? "", /No pude abrir/);
  assert.match(revisarVideo("enorme.mov", 200 * 1024 * 1024, 30) ?? "", /150 MB/);
});

test("el WAV sale mono, a la frecuencia pedida y con el largo justo", () => {
  const izquierda = new Float32Array([0, 0.5, -0.5, 1]);
  const derecha = new Float32Array([0, 0.5, 0.5, 1]);
  const wav = wavMono([izquierda, derecha], 16_000);
  const vista = new DataView(wav.buffer);

  assert.equal(String.fromCharCode(...wav.slice(0, 4)), "RIFF");
  assert.equal(String.fromCharCode(...wav.slice(8, 12)), "WAVE");
  assert.equal(vista.getUint16(22, true), 1);
  assert.equal(vista.getUint32(24, true), 16_000);
  assert.equal(vista.getUint32(40, true), 8);
  assert.equal(wav.length, 44 + 8);

  // (0.5 + 0.5) / 2 = 0.5; (-0.5 + 0.5) / 2 = 0; (1 + 1) / 2 = 1.
  assert.equal(vista.getInt16(46, true), Math.trunc(0.5 * 0x7fff));
  assert.equal(vista.getInt16(48, true), 0);
  assert.equal(vista.getInt16(50, true), 0x7fff);
});

test("una pista de silencio no se manda a transcribir", () => {
  assert.equal(tieneSonido([new Float32Array(1000)]), false);
  const conVoz = new Float32Array(1000);
  conVoz[500] = 0.2;
  assert.equal(tieneSonido([new Float32Array(1000), conVoz]), true);
});

test("la nota le dice a EOS que los cuadros son un solo video, en orden", () => {
  const nota = notaDelVideo({ nombre: "local.mov", duracion: 40, segundos: [5, 15, 25, 35], conAudio: true });
  assert.match(nota, /Video "local\.mov", dura 0:40/);
  assert.match(nota, /4 cuadros de ese video, en orden \(0:05, 0:15, 0:25, 0:35\)/);
  assert.match(nota, /transcripto como \[Audio\]/);

  const mudo = notaDelVideo({ nombre: "m.mp4", duracion: 8, segundos: [1, 3, 5, 7], conAudio: false });
  assert.match(mudo, /no tiene sonido/);
});

function video(nombre: string, partes: number): Adjunto {
  return {
    nombre,
    tipo: "video/mp4",
    tamanio: 40 * 1024 * 1024,
    base64: "cG9zdGVy",
    partes: Array.from({ length: partes }, () => ({ base64: "eA==" })),
  };
}

const foto = (i: number): Adjunto => ({ nombre: `f${i}.jpg`, tipo: "image/jpeg", base64: "eA==" });

test("un video ocupa un lugar por pieza, no uno solo", () => {
  // Pesa 40 MB, pero viaja desarmado: no lo frena el tope por archivo.
  assert.equal(revisarAdjuntos([video("v.mp4", 5)]), null);
  assert.equal(revisarAdjuntos([video("v.mp4", 5), ...[1, 2, 3, 4, 5].map(foto)]), null);

  const rechazo = revisarAdjuntos([video("v.mp4", 5), ...[1, 2, 3, 4, 5, 6].map(foto)]);
  assert.match(rechazo?.motivo ?? "", /Un video ocupa 5 de los 10 lugares/);
});

test("el texto por defecto nombra al video", () => {
  assert.equal(textoPorDefecto([video("local.mov", 5)]), "Analizá este video: local.mov");
  assert.equal(textoPorDefecto([video("a.mov", 5), video("b.mov", 5)]), "Analizá estos 2 videos");
});

test("la duración se lee de lo que imprime ffmpeg", () => {
  assert.equal(duracionDeFfmpeg("  Duration: 00:00:42.50, start: 0.000000, bitrate: 812 kb/s"), 42.5);
  assert.equal(duracionDeFfmpeg("Duration: 00:02:05.00,"), 125);
  assert.equal(duracionDeFfmpeg("Invalid data found when processing input"), null);
  assert.equal(duracionDeFfmpeg("Duration: N/A, bitrate: N/A"), null);
});

test("un WAV de silencio no se manda a transcribir", () => {
  const silencio = wavMono([new Float32Array(800)], 16_000);
  assert.equal(wavTieneSonido(silencio), false);

  const voz = new Float32Array(800);
  voz[400] = 0.3;
  assert.equal(wavTieneSonido(wavMono([voz], 16_000)), true);
  assert.equal(wavTieneSonido(new Uint8Array(10)), false);
});
