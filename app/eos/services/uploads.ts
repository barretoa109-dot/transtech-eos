import type { ImagenAdjunta } from "../types/chat";

export function convertirImagenABase64(file: File): Promise<ImagenAdjunta> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith("image/")) {
      reject(new Error("El archivo seleccionado no es una imagen."));
      return;
    }

    const reader = new FileReader();

    reader.onload = () => {
      const result = String(reader.result || "");
      const base64 = result.split(",")[1] || "";

      resolve({
        nombre: file.name,
        tipo: file.type,
        base64,
      });
    };

    reader.onerror = () => {
      reject(new Error("No se pudo leer la imagen."));
    };

    reader.readAsDataURL(file);
  });
}