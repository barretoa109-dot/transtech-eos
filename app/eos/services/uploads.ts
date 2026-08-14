import type { DocumentoAdjunto, ImagenAdjunta } from "../types/chat";

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

export async function subirDocumentoEOS(
  file: File,
  conversacionId?: string,
): Promise<DocumentoAdjunto> {
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
    intelligence_status: analysis ? "ready" : String(document.intelligence_status || "pending"),
    duplicate: Boolean(data.duplicate),
  };
}
