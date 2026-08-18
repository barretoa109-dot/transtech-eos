import type { ArchivoAdjunto } from "../types/chat";

const TAMANIO_MAXIMO = 15 * 1024 * 1024; // 15 MB

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

export function convertirArchivoABase64(
  file: File,
): Promise<ArchivoAdjunto> {
  return new Promise((resolve, reject) => {
    if (!tipoPermitido(file.type)) {
      reject(
        new Error(
          "Formato no soportado. EOS acepta imágenes, PDF, Word, Excel, CSV y TXT.",
        ),
      );
      return;
    }

    if (file.size > TAMANIO_MAXIMO) {
      reject(
        new Error(
          "El archivo supera el tamaño máximo permitido (15 MB).",
        ),
      );
      return;
    }

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