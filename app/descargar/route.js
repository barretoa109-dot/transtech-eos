import ExcelJS from "exceljs";
import { crearExcelNegocioUniversal } from "@/lib/documents/excel/business";

export const dynamic = "force-dynamic";

const MAX_RUBRO_LENGTH = 120;
const MAX_BUSINESS_NAME_LENGTH = 180;
const MAX_FILE_NAME_LENGTH = 100;

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

export async function GET(request) {
  const { searchParams } = new URL(request.url);

  const tipo = searchParams.get("tipo") || "excel";
  const nombre = safeFileName(searchParams.get("nombre"));
  const rubro = boundedText(
    searchParams.get("rubro"),
    "negocio_general",
    MAX_RUBRO_LENGTH,
  );
  const nombreNegocio = boundedText(
    searchParams.get("negocio"),
    "Mi Negocio",
    MAX_BUSINESS_NAME_LENGTH,
  );

  if (tipo !== "excel") {
    return new Response("Tipo de archivo no soportado", {
      status: 400,
      headers: { "Cache-Control": "no-store" },
    });
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
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
