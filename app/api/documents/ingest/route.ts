import { createHash, randomUUID } from "crypto";
import ExcelJS from "exceljs";
import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 12 * 1024 * 1024;
const MAX_EXTRACTED_CHARS = 250_000;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const XLS_MIME_TYPE = "application/vnd.ms-excel";
const XLSX_MIME_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const SUPPORTED_MIME_TYPES = new Set([
  "text/plain",
  "text/csv",
  "application/json",
  "application/pdf",
  XLS_MIME_TYPE,
  XLSX_MIME_TYPE,
  "image/jpeg",
  "image/png",
  "image/webp",
]);

const TEXT_MIME_TYPES = new Set([
  "text/plain",
  "text/csv",
  "application/json",
]);

const EXCEL_MIME_TYPES = new Set([XLS_MIME_TYPE, XLSX_MIME_TYPE]);

type ExtractionResult = {
  text: string;
  status: "ready" | "partial" | "unsupported" | "error";
  language: string | null;
  metadata: Record<string, unknown>;
};

function cleanFileName(value: string) {
  return (
    value
      .trim()
      .replace(/[\\/]+/g, "-")
      .replace(/[^\p{L}\p{N}._()\- ]/gu, "")
      .slice(0, 180) || "documento"
  );
}

function extensionFromName(name: string) {
  const value = name.trim();
  const lastDot = value.lastIndexOf(".");
  if (lastDot <= 0 || lastDot === value.length - 1) return "";
  return value
    .slice(lastDot + 1)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 12);
}

function documentTypeFromMime(mimeType: string) {
  if (EXCEL_MIME_TYPES.has(mimeType) || mimeType === "text/csv") {
    return "spreadsheet";
  }
  if (mimeType === "application/pdf") return "report";
  if (mimeType.startsWith("image/")) return "image";
  if (TEXT_MIME_TYPES.has(mimeType)) return "text";
  return "unknown";
}

function clipText(text: string) {
  const normalized = text.replace(/\u0000/g, "").trim();
  if (normalized.length <= MAX_EXTRACTED_CHARS) {
    return { text: normalized, clipped: false };
  }

  return {
    text: normalized.slice(0, MAX_EXTRACTED_CHARS),
    clipped: true,
  };
}

function csvEscape(value: unknown) {
  if (value === null || value === undefined) return "";

  let text: string;
  if (value instanceof Date) {
    text = value.toISOString();
  } else if (typeof value === "object") {
    const candidate = value as Record<string, unknown>;
    if (typeof candidate.text === "string") {
      text = candidate.text;
    } else if (typeof candidate.result === "string" || typeof candidate.result === "number") {
      text = String(candidate.result);
    } else if (typeof candidate.formula === "string") {
      text = `=${candidate.formula}`;
    } else if (Array.isArray(candidate.richText)) {
      text = candidate.richText
        .map((part) =>
          part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string"
            ? String((part as { text: string }).text)
            : "",
        )
        .join("");
    } else {
      text = JSON.stringify(value);
    }
  } else {
    text = String(value);
  }

  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function extractTextFile(bytes: Uint8Array, mimeType: string): ExtractionResult {
  const decoded = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  const clipped = clipText(decoded);

  if (mimeType === "application/json") {
    try {
      const parsed = JSON.parse(decoded);
      const pretty = JSON.stringify(parsed, null, 2);
      const prettyClipped = clipText(pretty);
      return {
        text: prettyClipped.text,
        status: prettyClipped.clipped ? "partial" : "ready",
        language: null,
        metadata: {
          extractor: "utf8-json",
          clipped: prettyClipped.clipped,
        },
      };
    } catch {
      return {
        text: clipped.text,
        status: clipped.clipped ? "partial" : "ready",
        language: null,
        metadata: {
          extractor: "utf8-text",
          json_parse_error: true,
          clipped: clipped.clipped,
        },
      };
    }
  }

  return {
    text: clipped.text,
    status: clipped.clipped ? "partial" : "ready",
    language: null,
    metadata: {
      extractor: mimeType === "text/csv" ? "utf8-csv" : "utf8-text",
      clipped: clipped.clipped,
    },
  };
}

async function extractXlsx(bytes: Uint8Array): Promise<ExtractionResult> {
  const workbook = new ExcelJS.Workbook();
  const source = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  await workbook.xlsx.load(source as unknown as ExcelJS.Buffer);

  const sections: string[] = [];
  const sheets: Array<{ name: string; rows: number; columns: number }> = [];

  workbook.eachSheet((worksheet) => {
    const rows: string[] = [];
    let maxColumns = 0;

    worksheet.eachRow({ includeEmpty: false }, (row) => {
      const values = Array.isArray(row.values) ? row.values.slice(1) : [];
      maxColumns = Math.max(maxColumns, values.length);
      rows.push(values.map(csvEscape).join(","));
    });

    sheets.push({
      name: worksheet.name,
      rows: worksheet.rowCount,
      columns: Math.max(worksheet.columnCount, maxColumns),
    });

    if (rows.length > 0) {
      sections.push(`# Hoja: ${worksheet.name}\n${rows.join("\n")}`);
    }
  });

  const clipped = clipText(sections.join("\n\n"));

  return {
    text: clipped.text,
    status: clipped.clipped ? "partial" : "ready",
    language: null,
    metadata: {
      extractor: "exceljs-xlsx",
      sheets,
      sheet_count: workbook.worksheets.length,
      clipped: clipped.clipped,
    },
  };
}

async function extract(
  bytes: Uint8Array,
  mimeType: string,
): Promise<ExtractionResult> {
  if (TEXT_MIME_TYPES.has(mimeType)) {
    return extractTextFile(bytes, mimeType);
  }

  if (mimeType === XLSX_MIME_TYPE) {
    return extractXlsx(bytes);
  }

  if (mimeType === XLS_MIME_TYPE) {
    return {
      text: "",
      status: "unsupported",
      language: null,
      metadata: {
        extractor: "deferred",
        reason:
          "XLS binario legado almacenado de forma segura. La extracción inmediata se pospone hasta disponer de un parser XLS sin advisories conocidos.",
      },
    };
  }

  return {
    text: "",
    status: "unsupported",
    language: null,
    metadata: {
      extractor: "deferred",
      reason:
        mimeType === "application/pdf"
          ? "PDF guardado para extracción documental posterior."
          : "Imagen guardada para análisis visual posterior.",
    },
  };
}

function noStoreHeaders() {
  return {
    "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
    Pragma: "no-cache",
    Expires: "0",
  };
}

export async function POST(request: Request) {
  const uploadedPaths: string[] = [];

  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { error: "Debés iniciar sesión para adjuntar documentos." },
        { status: 401, headers: noStoreHeaders() },
      );
    }

    const formData = await request.formData();
    const file = formData.get("archivo");
    const conversacionId = String(formData.get("conversacion_id") || "").trim();

    if (conversacionId && !UUID_PATTERN.test(conversacionId)) {
      return NextResponse.json(
        { error: "La conversación indicada no es válida." },
        { status: 400, headers: noStoreHeaders() },
      );
    }

    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: "No recibí un archivo válido." },
        { status: 400, headers: noStoreHeaders() },
      );
    }

    if (!SUPPORTED_MIME_TYPES.has(file.type)) {
      return NextResponse.json(
        {
          error:
            "Formato no soportado. Podés adjuntar TXT, CSV, JSON, XLS, XLSX, PDF, JPG, PNG o WEBP.",
        },
        { status: 415, headers: noStoreHeaders() },
      );
    }

    if (file.size <= 0 || file.size > MAX_BYTES) {
      return NextResponse.json(
        { error: "El documento debe pesar menos de 12 MB." },
        { status: 400, headers: noStoreHeaders() },
      );
    }

    const raw = new Uint8Array(await file.arrayBuffer());
    const checksum = createHash("sha256").update(raw).digest("hex");
    const admin: any = createAdminClient();

    const { data: duplicate, error: duplicateError } = await admin
      .from("eos_documents_v11")
      .select(
        "id,nombre,mime_type,document_type,extraction_status,intelligence_status,summary,storage_path,created_at",
      )
      .eq("usuario_id", user.id)
      .eq("checksum_sha256", checksum)
      .maybeSingle();

    if (duplicateError) {
      console.error("No se pudo comprobar duplicado documental:", duplicateError);
      return NextResponse.json(
        { error: "No pudimos validar el documento." },
        { status: 500, headers: noStoreHeaders() },
      );
    }

    if (duplicate) {
      return NextResponse.json(
        { ok: true, duplicate: true, document: duplicate },
        { headers: noStoreHeaders() },
      );
    }

    let extraction: ExtractionResult;
    try {
      extraction = await extract(raw, file.type);
    } catch (extractionError) {
      console.error("No se pudo extraer el documento:", extractionError);
      extraction = {
        text: "",
        status: "error",
        language: null,
        metadata: {
          extractor: "error",
          extraction_error:
            extractionError instanceof Error
              ? extractionError.message
              : "No se pudo extraer el contenido.",
        },
      };
    }

    const safeName = cleanFileName(file.name || "documento");
    const extension = extensionFromName(safeName);
    const storagePath = `${user.id}/${new Date().toISOString().slice(0, 10)}/${randomUUID()}${extension ? `.${extension}` : ""}`;

    const { error: uploadError } = await admin.storage
      .from("eos-documents")
      .upload(storagePath, raw, {
        contentType: file.type,
        cacheControl: "3600",
        upsert: false,
      });

    if (uploadError) {
      console.error("No se pudo almacenar documento:", uploadError);
      return NextResponse.json(
        { error: "No pudimos guardar el documento." },
        { status: 500, headers: noStoreHeaders() },
      );
    }

    uploadedPaths.push(storagePath);

    const documentType = documentTypeFromMime(file.type);
    const now = new Date().toISOString();
    const extractionReady =
      extraction.status === "ready" || extraction.status === "partial";

    const { data: document, error: insertError } = await admin
      .from("eos_documents_v11")
      .insert({
        usuario_id: user.id,
        conversacion_id: conversacionId || null,
        nombre: safeName,
        mime_type: file.type,
        extension: extension || null,
        size_bytes: file.size,
        checksum_sha256: checksum,
        storage_path: storagePath,
        source: "chat_upload",
        document_type: documentType,
        extraction_status: extraction.status,
        intelligence_status: "pending",
        extracted_text: extraction.text || null,
        extracted_char_count: extraction.text.length,
        language: extraction.language,
        confidence: extractionReady ? 1 : null,
        processed_at: extractionReady ? now : null,
        metadata: {
          ...extraction.metadata,
          original_name: file.name,
          uploaded_at: now,
          ingestion_version: "document-intelligence-v11-exceljs",
        },
      })
      .select(
        "id,nombre,mime_type,extension,size_bytes,document_type,extraction_status,intelligence_status,extracted_char_count,storage_path,created_at",
      )
      .single();

    if (insertError || !document) {
      console.error("No se pudo registrar documento:", insertError);
      await admin.storage.from("eos-documents").remove([storagePath]);
      uploadedPaths.length = 0;

      return NextResponse.json(
        { error: "El archivo se subió, pero no pudimos registrarlo en EOS." },
        { status: 500, headers: noStoreHeaders() },
      );
    }

    return NextResponse.json(
      {
        ok: true,
        duplicate: false,
        document,
        extraction: {
          status: extraction.status,
          extracted_char_count: extraction.text.length,
          deferred: extraction.status === "unsupported",
        },
      },
      { status: 201, headers: noStoreHeaders() },
    );
  } catch (error) {
    console.error("Error en Document Intelligence ingest:", error);

    if (uploadedPaths.length > 0) {
      try {
        const admin: any = createAdminClient();
        await admin.storage.from("eos-documents").remove(uploadedPaths);
      } catch (cleanupError) {
        console.error("No se pudo limpiar documento huérfano:", cleanupError);
      }
    }

    return NextResponse.json(
      { error: "No se pudo procesar el documento." },
      { status: 500, headers: noStoreHeaders() },
    );
  }
}
