import { NextResponse } from "next/server";
import { exigirModulo } from "@/lib/modulos/acceso";
import { adminSinTipos } from "@/lib/supabase/sin-tipos";
import { calcularRentabilidad, type LineaRentabilidad } from "@/lib/erp/rentabilidad";

export const dynamic = "force-dynamic";

export async function GET() {
  const puerta = await exigirModulo("erp");
  if (puerta.respuesta) return puerta.respuesta;

  const { data, error } = await adminSinTipos()
    .from("eos_erp_ventas")
    .select(
      "id,moneda,estado,items:eos_erp_venta_items(" +
        "producto_id,descripcion,cantidad,total,costo_unitario,costo_estimado)",
    )
    .eq("usuario_id", puerta.usuarioId)
    .neq("estado", "anulada")
    .order("fecha", { ascending: false })
    .limit(500);

  if (error) {
    console.error("ERP: no se pudo calcular la rentabilidad:", error);
    return NextResponse.json(
      { error: "No pudimos calcular la rentabilidad." },
      { status: 503, headers: noStore() },
    );
  }

  const lineas: LineaRentabilidad[] = (data ?? []).flatMap((venta: Record<string, unknown>) => {
    const items = Array.isArray(venta.items) ? venta.items : [];
    return items.map((item: Record<string, unknown>) => ({
      producto_id: typeof item.producto_id === "string" ? item.producto_id : null,
      descripcion: String(item.descripcion ?? "Producto"),
      cantidad: Number(item.cantidad ?? 0),
      venta: Number(item.total ?? 0),
      costo_unitario: item.costo_unitario === null || item.costo_unitario === undefined
        ? null
        : Number(item.costo_unitario),
      estimado: item.costo_estimado === true,
      moneda: String(venta.moneda ?? "PYG"),
    }));
  });

  return NextResponse.json(
    { resumen: calcularRentabilidad(lineas) },
    { headers: noStore() },
  );
}

function noStore() {
  return { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" };
}
