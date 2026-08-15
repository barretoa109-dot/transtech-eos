import ExcelJS from "exceljs";
import { crearExcelNegocioUniversal } from "@/lib/documents/excel/business";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_RUBRO_LENGTH = 120;
const MAX_BUSINESS_NAME_LENGTH = 180;
const MAX_FILE_NAME_LENGTH = 100;
const DOWNLOAD_PARAMS = [
  "tipo",
  "plantilla",
  "nombre",
  "rubro",
  "negocio",
  "tema",
  "command_id",
];

function boundedText(value, fallback, maxLength) {
  if (typeof value !== "string") return fallback;
  const normalized = value.trim().slice(0, maxLength);
  return normalized || fallback;
}

function safeFileName(value) {
  const bounded = boundedText(value, "archivo_eos", MAX_FILE_NAME_LENGTH);
  const sanitized = bounded
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\r\n"\\/;:]+/g, "_")
    .replace(/[^a-zA-Z0-9._ -]+/g, "_")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^[-_. ]+|[-_. ]+$/g, "")
    .slice(0, MAX_FILE_NAME_LENGTH);

  return sanitized || "archivo_eos";
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(value || "").trim(),
  );
}

function objectValue(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : null;
}

function errorResponse(message, status) {
  return new Response(message, {
    status,
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
      Vary: "Cookie",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function GET(request) {
  try {
    const requestedUrl = new URL(request.url);
    const commandId = requestedUrl.searchParams.get("command_id") || "";

    if (!isUuid(commandId)) {
      return errorResponse("Enlace de descarga inválido", 400);
    }

    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return errorResponse("Debés iniciar sesión para descargar este archivo", 401);
    }

    const admin = createAdminClient();
    const { data: command, error: commandError } = await admin
      .from("eos_action_commands")
      .select("id,usuario_id,accion,estado,resultado")
      .eq("id", commandId)
      .eq("usuario_id", user.id)
      .maybeSingle();

    if (commandError) {
      console.error("Excel download: no se pudo verificar command:", commandError);
      return errorResponse("No pudimos verificar este archivo", 500);
    }

    if (!command) {
      return errorResponse("Archivo no encontrado", 404);
    }

    if (command.accion !== "GENERAR_EXCEL" || command.estado !== "completada") {
      return errorResponse("Este archivo todavía no está disponible", 409);
    }

    const result = objectValue(command.resultado);
    const canonicalDownload =
      typeof result?.archivo_url === "string" ? result.archivo_url.trim() : "";

    if (!canonicalDownload) {
      return errorResponse("La orden no contiene un archivo descargable", 409);
    }

    let canonicalUrl;
    try {
      canonicalUrl = new URL(canonicalDownload, requestedUrl.origin);
    } catch {
      return errorResponse("La orden contiene un enlace de descarga inválido", 409);
    }

    if (
      canonicalUrl.pathname !== "/descargar" ||
      canonicalUrl.searchParams.get("command_id") !== commandId
    ) {
      return errorResponse("El archivo no coincide con la orden autorizada", 409);
    }

    for (const key of DOWNLOAD_PARAMS) {
      if (requestedUrl.searchParams.get(key) !== canonicalUrl.searchParams.get(key)) {
        return errorResponse("El enlace de descarga fue modificado", 409);
      }
    }

    const tipo = canonicalUrl.searchParams.get("tipo") || "excel";
    const nombre = safeFileName(canonicalUrl.searchParams.get("nombre"));
    const rubro = boundedText(
      canonicalUrl.searchParams.get("rubro"),
      "negocio_general",
      MAX_RUBRO_LENGTH,
    );
    const nombreNegocio = boundedText(
      canonicalUrl.searchParams.get("negocio"),
      "Mi Negocio",
      MAX_BUSINESS_NAME_LENGTH,
    );

    if (tipo !== "excel") {
      return errorResponse("Tipo de archivo no soportado", 400);
    }

    const workbook = new ExcelJS.Workbook();

    await crearExcelNegocioUniversal(workbook, {
      rubro,
      nombreNegocio,
    });

    const buffer = await workbook.xlsx.writeBuffer();

    return new Response(buffer, {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${nombre}.xlsx"`,
        "Cache-Control": "private, no-store, max-age=0",
        Vary: "Cookie",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error("Excel download unexpected error:", error);
    return errorResponse("No pudimos generar este archivo", 500);
  }
}
