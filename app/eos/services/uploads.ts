import type { DocumentoAdjunto, ImagenAdjunta } from "../types/chat";

const MAX_DOCUMENT_BYTES = 4 * 1024 * 1024;
const MAX_IMAGE_INPUT_BYTES = 20 * 1024 * 1024;
const MAX_IMAGE_PAYLOAD_BYTES = 2 * 1024 * 1024;
const MAX_IMAGE_DIMENSION = 1800;
const DIRECT_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

function leerComoBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      const result = String(reader.result || "");
      const base64 = result.split(",")[1] || "";

      if (!base64) {
        reject(new Error("No se pudo preparar la imagen."));
        return;
      }

      resolve(base64);
    };

    reader.onerror = () => {
      reject(new Error("No se pudo leer la imagen."));
    };

    reader.readAsDataURL(blob);
  });
}

function cargarImagen(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();

    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };

    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("El formato de esta imagen no puede procesarse en el dispositivo."));
    };

    image.src = objectUrl;
  });
}

function canvasComoBlob(
  canvas: HTMLCanvasElement,
  quality: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("No se pudo optimizar la imagen."));
          return;
        }
        resolve(blob);
      },
      "image/jpeg",
      quality,
    );
  });
}

async function comprimirImagen(file: File): Promise<Blob> {
  const image = await cargarImagen(file);
  const originalWidth = image.naturalWidth || image.width;
  const originalHeight = image.naturalHeight || image.height;

  if (!originalWidth || !originalHeight) {
    throw new Error("La imagen no tiene dimensiones válidas.");
  }

  const initialScale = Math.min(
    1,
    MAX_IMAGE_DIMENSION / Math.max(originalWidth, originalHeight),
  );

  const attempts = [
    { dimensionScale: 1, quality: 0.84 },
    { dimensionScale: 1, quality: 0.72 },
    { dimensionScale: 0.82, quality: 0.66 },
    { dimensionScale: 0.68, quality: 0.58 },
  ];

  let lastBlob: Blob | null = null;

  for (const attempt of attempts) {
    const scale = initialScale * attempt.dimensionScale;
    const width = Math.max(1, Math.round(originalWidth * scale));
    const height = Math.max(1, Math.round(originalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("No se pudo preparar la imagen en este dispositivo.");
    }

    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);

    const blob = await canvasComoBlob(canvas, attempt.quality);
    lastBlob = blob;

    if (blob.size <= MAX_IMAGE_PAYLOAD_BYTES) {
      return blob;
    }
  }

  if (lastBlob && lastBlob.size <= MAX_IMAGE_PAYLOAD_BYTES) {
    return lastBlob;
  }

  throw new Error(
    "La imagen es demasiado grande incluso después de optimizarla. Probá con otra imagen.",
  );
}

export async function convertirImagenABase64(
  file: File,
): Promise<ImagenAdjunta> {
  if (!file.type.startsWith("image/")) {
    throw new Error("El archivo seleccionado no es una imagen.");
  }

  if (file.size <= 0) {
    throw new Error("La imagen está vacía.");
  }

  if (file.size > MAX_IMAGE_INPUT_BYTES) {
    throw new Error("La imagen original debe pesar como máximo 20 MB.");
  }

  const puedeUsarseDirectamente =
    DIRECT_IMAGE_TYPES.has(file.type) && file.size <= MAX_IMAGE_PAYLOAD_BYTES;
  const payload = puedeUsarseDirectamente ? file : await comprimirImagen(file);

  return {
    nombre: file.name,
    tipo: puedeUsarseDirectamente ? file.type : "image/jpeg",
    base64: await leerComoBase64(payload),
  };
}

export async function subirDocumentoEOS(
  file: File,
  conversacionId?: string,
): Promise<DocumentoAdjunto> {
  if (file.size <= 0 || file.size > MAX_DOCUMENT_BYTES) {
    throw new Error("El documento debe pesar como máximo 4 MB.");
  }

  const formData = new FormData();
  formData.append("archivo", file);

  if (conversacionId) {
    formData.append("conversacion_id", conversacionId);
  }

  const response = await fetch("/api/documents/ingest", {
    method: "POST",
    body: formData,
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok || !data?.document?.id) {
    throw new Error(data?.error || "No se pudo adjuntar el documento.");
  }

  const document = data.document;
  let analysis: Record<string, unknown> | null = null;
  const extractionReady =
    document.extraction_status === "ready" ||
    document.extraction_status === "partial";
  const alreadyAnalyzed = document.intelligence_status === "ready";

  if (extractionReady && !alreadyAnalyzed) {
    const analysisResponse = await fetch(
      `/api/documents/${document.id}/analyze`,
      { method: "POST" },
    );

    if (analysisResponse.ok) {
      analysis = await analysisResponse.json().catch(() => null);
    }
  }

  return {
    id: String(document.id),
    nombre: String(document.nombre || file.name),
    tipo: String(document.mime_type || file.type),
    tamanio: Number(document.size_bytes || file.size),
    document_type: String(document.document_type || "unknown"),
    extraction_status: String(document.extraction_status || "pending"),
    intelligence_status: analysis
      ? "ready"
      : String(document.intelligence_status || "pending"),
    duplicate: Boolean(data.duplicate),
  };
}
