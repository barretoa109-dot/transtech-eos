import { LADO_MAXIMO_IMAGEN, MAX_BYTES_POR_ARCHIVO, medidaParaModelo } from "@/lib/eos/adjuntos";
import type { ArchivoAdjunto } from "../types/chat";

const TAMANIO_MAXIMO = MAX_BYTES_POR_ARCHIVO;

/**
 * La calidad del JPEG al que se achican las fotos.
 *
 * 0,82 es donde una foto de una factura o de una boleta sigue siendo
 * perfectamente legible y el archivo pesa una fracción. Más arriba se paga
 * subida por detalle que el modelo no usa; más abajo empiezan a costar los
 * números chicos, que es justo lo que hay que leer.
 */
const CALIDAD_JPEG = 0.82;

const TIPOS_PERMITIDOS = [
  // Imágenes
  "image/",

  // PDF
  "application/pdf",

  // Word
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",

  // Excel
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",

  // CSV
  "text/csv",

  // TXT
  "text/plain",
];

function tipoPermitido(tipo: string) {
  return TIPOS_PERMITIDOS.some((permitido) =>
    permitido.endsWith("/")
      ? tipo.startsWith(permitido)
      : tipo === permitido,
  );
}

/**
 * Achica una imagen antes de que salga del navegador.
 *
 * Una foto de un teléfono actual pesa entre 3 y 5 MB y tiene 4000 píxeles de
 * lado. El modelo no lee más de ~1568: los otros 2400 se suben, se pagan y se
 * descartan del otro lado. Achicada, la misma foto pesa entre 200 y 400 KB.
 *
 * Con diez fotos la diferencia es entre un mensaje que viaja y uno que no; con
 * una sola —el caso de siempre— es la diferencia entre esperar la subida y no
 * esperarla.
 *
 * Devuelve el archivo original sin tocar cuando ya entra, cuando el navegador
 * no puede decodificarla, o ante cualquier falla. Nunca tira: que una foto no
 * se pueda achicar no es motivo para que no se pueda mandar.
 */
async function achicarImagen(file: File): Promise<File> {
  if (!file.type.startsWith("image/")) return file;

  // Los GIF se van animados o no se van: el canvas se queda con un cuadro.
  if (file.type === "image/gif") return file;

  if (typeof createImageBitmap !== "function" || typeof document === "undefined") return file;

  let bitmap: ImageBitmap;

  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return file;
  }

  try {
    const medida = medidaParaModelo(bitmap.width, bitmap.height, LADO_MAXIMO_IMAGEN);
    if (!medida) return file;

    const lienzo = document.createElement("canvas");
    lienzo.width = medida.ancho;
    lienzo.height = medida.alto;

    const pincel = lienzo.getContext("2d");
    if (!pincel) return file;

    pincel.drawImage(bitmap, 0, 0, medida.ancho, medida.alto);

    const blob = await new Promise<Blob | null>((resolve) =>
      lienzo.toBlob(resolve, "image/jpeg", CALIDAD_JPEG),
    );

    // Si el "achicado" pesa más que el original —pasa con capturas de pantalla
    // planas, donde el PNG comprime mejor que el JPEG— se manda el original.
    if (!blob || blob.size >= file.size) return file;

    const nombre = file.name.replace(/\.[^.]+$/, "") + ".jpg";
    return new File([blob], nombre, { type: "image/jpeg" });
  } catch {
    return file;
  } finally {
    bitmap.close();
  }
}

/**
 * El archivo listo para viajar: validado, achicado si es una foto, en base64.
 *
 * El orden importa. La validación mira el archivo ORIGINAL, no el achicado: si
 * midiera el resultado, una foto de 40 MB pasaría por quedar en 300 KB, y
 * decodificar 40 MB en el navegador de un teléfono lo cuelga antes de llegar a
 * achicarla. Se rechaza primero y se trabaja después.
 */
export async function convertirArchivoABase64(file: File): Promise<ArchivoAdjunto> {
  if (!tipoPermitido(file.type)) {
    throw new Error("Formato no soportado. EOS acepta imágenes, PDF, Word, Excel, CSV y TXT.");
  }

  if (file.size > TAMANIO_MAXIMO) {
    throw new Error(`"${file.name}" supera el tamaño máximo permitido (15 MB).`);
  }

  return leerComoBase64(await achicarImagen(file));
}

function leerComoBase64(
  file: File,
): Promise<ArchivoAdjunto> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      const resultado = String(reader.result ?? "");
      const base64 = resultado.split(",")[1] ?? "";

      resolve({
        nombre: file.name,
        tipo: file.type,
        tamanio: file.size,
        base64,
      });
    };

    reader.onerror = () => {
      reject(
        new Error(
          "No fue posible leer el archivo seleccionado.",
        ),
      );
    };

    reader.readAsDataURL(file);
  });
}

export function esImagen(tipo: string) {
  return tipo.startsWith("image/");
}

export function obtenerExtension(nombre: string) {
  const partes = nombre.split(".");
  return partes.length > 1
    ? partes.pop()!.toLowerCase()
    : "";
}