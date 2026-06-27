import { NextResponse } from "next/server";

export async function GET(request) {
  const { searchParams } = new URL(request.url);

  const tipo = searchParams.get("tipo") || "excel";
  const nombre = searchParams.get("nombre") || "planilla_eos";

  if (tipo !== "excel") {
    return NextResponse.json(
      { error: "Tipo de archivo no soportado todavía" },
      { status: 400 }
    );
  }

  const csv = [
    ["Fecha", "Categoría", "Descripción", "Monto", "Forma de pago", "Observación"],
    ["2026-06-27", "Ingresos", "Venta del día", "0", "Efectivo/Transferencia", ""],
    ["2026-06-27", "Costos variables", "Compra de mercadería", "0", "Transferencia", ""],
    ["2026-06-27", "Costos fijos", "Alquiler / servicios", "0", "Transferencia", ""],
    [],
    ["Resumen", ""],
    ["Total ingresos", '=SUMIF(B:B,"Ingresos",D:D)'],
    ["Total costos variables", '=SUMIF(B:B,"Costos variables",D:D)'],
    ["Total costos fijos", '=SUMIF(B:B,"Costos fijos",D:D)'],
    ["Resultado", "=B7-B8-B9"],
  ]
    .map((row) =>
      row
        .map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`)
        .join(",")
    )
    .join("\n");

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${nombre}.csv"`,
    },
  });
}
