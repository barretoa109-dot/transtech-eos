/**
 * Las fotos que la persona manda en el chat, guardadas para poder verlas.
 *
 * ============================================================
 * POR QUÉ SE GUARDAN Y DÓNDE
 * ============================================================
 *
 * De un mensaje, la base guardaba solo el texto. Una foto viajaba al modelo y
 * se perdía: la burbuja quedaba diciendo "[Imagen adjunta: IMG_4957.jpg]", y
 * quien volvía a la conversación veía su pregunta sobre "esta factura" sin la
 * factura.
 *
 * Ahora cada foto se sube al bucket privado `eos-chat-imagenes`, bajo
 * `<usuario_id>/`, y el mensaje anota las rutas en `metadata.imagenes`. La
 * línea de texto se sigue guardando igual: es lo que lee el modelo en el
 * historial y lo que se ve si la subida falló.
 *
 * Acá están las reglas que se pueden probar sin navegador ni servidor: qué
 * se acepta, cómo se arma y se valida una ruta, cómo se lee la metadata y qué
 * línea sacar del texto cuando las miniaturas ya la dicen.
 */

import { MAX_ADJUNTOS } from "./adjuntos.ts";

export const BUCKET_FOTOS_CHAT = "eos-chat-imagenes";

/** Lo mismo que acepta el bucket. Una foto de teléfono ya llega achicada. */
export const MAX_BYTES_FOTO = 5 * 1024 * 1024;

/** Cuánto dura un enlace firmado. Alcanza para una sesión de chat. */
export const SEGUNDOS_ENLACE_FOTO = 60 * 60;

const EXTENSIONES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

export function tipoDeFotoAceptado(tipo: string): boolean {
  return Object.prototype.hasOwnProperty.call(EXTENSIONES, tipo.toLowerCase());
}

export function extensionDeFoto(tipo: string): string {
  return EXTENSIONES[tipo.toLowerCase()] ?? "jpg";
}

/**
 * La ruta de una foto nueva.
 *
 * El usuario va primero porque es lo que se exige al firmar: una ruta que no
 * empieza con el id de la sesión no se firma, la hayan adivinado o no.
 */
export function rutaDeFoto(usuarioId: string, id: string, tipo: string): string {
  return `${usuarioId}/${id}.${extensionDeFoto(tipo)}`;
}

/**
 * ¿Esta ruta es de este usuario?
 *
 * No alcanza con `startsWith`: `abc/../otro/x.jpg` empieza con `abc/`. Se exige
 * exactamente dos partes, la primera igual al usuario y la segunda un nombre
 * de archivo sin nada raro.
 */
export function rutaEsDe(usuarioId: string, ruta: unknown): ruta is string {
  if (!usuarioId || typeof ruta !== "string") return false;

  const partes = ruta.split("/");
  if (partes.length !== 2) return false;

  const [dueno, archivo] = partes;
  return dueno === usuarioId && /^[A-Za-z0-9-]{1,64}\.(jpg|png|webp|gif)$/.test(archivo);
}

export type FotoGuardada = {
  ruta: string;
  nombre: string;
  tipo: string;
};

/**
 * Las fotos anotadas en la metadata de un mensaje.
 *
 * La metadata la escribe el navegador, así que se lee con desconfianza: lo que
 * no tiene forma de foto se descarta, y nunca más de diez.
 */
export function fotosDeMetadata(metadata: unknown): FotoGuardada[] {
  if (!metadata || typeof metadata !== "object") return [];

  const crudas = (metadata as { imagenes?: unknown }).imagenes;
  if (!Array.isArray(crudas)) return [];

  const fotos: FotoGuardada[] = [];

  for (const cruda of crudas) {
    if (!cruda || typeof cruda !== "object") continue;

    const { ruta, nombre, tipo } = cruda as Record<string, unknown>;
    if (typeof ruta !== "string" || !ruta) continue;

    fotos.push({
      ruta,
      nombre: typeof nombre === "string" ? nombre : "",
      tipo: typeof tipo === "string" ? tipo : "",
    });

    if (fotos.length === MAX_ADJUNTOS) break;
  }

  return fotos;
}

/**
 * El texto de la burbuja sin la línea "[Imagen adjunta: …]".
 *
 * Solo se saca cuando cada foto nombrada en esa línea tiene su miniatura. Si el
 * mensaje llevaba además un PDF la línea dice "Archivos adjuntos" y se queda:
 * es lo único que nombra al PDF. Si una foto no se pudo guardar, también se
 * queda, porque es lo único que dice que esa foto existió.
 */
export function textoSinReferenciaDeFotos(texto: string, fotosVisibles: number): string {
  const linea = /\n*\[Im[áa]gen(?:es)? adjuntas?:([^\]]*)\]\s*$/i.exec(texto);
  if (!linea || fotosVisibles <= 0) return texto;

  const nombradas = linea[1].split(",").filter((n) => n.trim()).length;
  if (nombradas !== fotosVisibles) return texto;

  return texto.slice(0, linea.index).trimEnd();
}
