import * as XLSX from "xlsx";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const { searchParams } = new URL(request.url);

  const tipo = searchParams.get("tipo") || "excel";
  const nombre = searchParams.get("nombre") || "planilla_eos";

  if (tipo !== "excel") {
    return new Response("Tipo de archivo no soportado", { status: 400 });
  }

  const datos = [
    ["Fecha", "Categoría", "Descripción", "Monto", "Forma de pago", "Observación"],
    ["2026-06-27", "Ingresos", "Venta del día", 0, "Efectivo/Transferencia", ""],
    ["2026-06-27", "Costos variables", "Compra de mercadería", 0, "Transferencia", ""],
    ["2026-06-27", "Costos fijos", "Alquiler / servicios", 0, "Transferencia", ""],
    [],
    ["Resumen", ""],
    ["Total ingresos", { f: 'SUMIF(B:B,"Ingresos",D:D)' }],
    ["Total costos variables", { f: 'SUMIF(B:B,"Costos variables",D:D)' }],
    ["Total costos fijos", { f: 'SUMIF(B:B,"Costos fijos",D:D)' }],
    ["Resultado", { f: "B7-B8-B9" }],
  ];

  const hoja = XLSX.utils.aoa_to_sheet(datos);

  hoja["!cols"] = [
    { wch: 14 },
    { wch: 22 },
    { wch: 35 },
    { wch: 14 },
    { wch: 24 },
    { wch: 30 },
  ];

  const libro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(libro, hoja, "Planilla EOS");

  const buffer = XLSX.write(libro, {
    type: "buffer",
    bookType: "xlsx",
  });

  return new Response(buffer, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${nombre}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
