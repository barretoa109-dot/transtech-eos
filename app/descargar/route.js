import ExcelJS from "exceljs";
import { crearExcelNegocioUniversal } from "@/lib/documents/excel/business";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const { searchParams } = new URL(request.url);

  const tipo = searchParams.get("tipo") || "excel";
  const nombre = searchParams.get("nombre") || "archivo_eos";
  const rubro = searchParams.get("rubro") || "negocio_general";
  const nombreNegocio = searchParams.get("negocio") || "Mi Negocio";

  if (tipo !== "excel") {
    return new Response("Tipo de archivo no soportado", { status: 400 });
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
    },
  });
}