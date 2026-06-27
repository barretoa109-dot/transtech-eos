import ExcelJS from "exceljs";
import { crearExcelRestaurante } from "@/lib/excel/restaurant";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const { searchParams } = new URL(request.url);

  const tipo = searchParams.get("tipo") || "excel";
  const nombre = searchParams.get("nombre") || "planilla_eos";
  const rubro = searchParams.get("rubro") || "restaurante";

  if (tipo !== "excel") {
    return new Response("Tipo de archivo no soportado", { status: 400 });
  }

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "TransTech EOS";
  workbook.created = new Date();

  if (rubro === "restaurante") {
    await crearExcelRestaurante(workbook);
  }

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
