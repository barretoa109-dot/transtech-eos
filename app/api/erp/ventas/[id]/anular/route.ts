import { NextResponse } from "next/server";

import { exigirModulo } from "@/lib/modulos/acceso";
import { adminSinTipos } from "@/lib/supabase/sin-tipos";

export const dynamic = "force-dynamic";

export async function POST(request: Request, contexto: { params: Promise<{ id: string }> }) {
  const puerta = await exigirModulo("erp");
  if (puerta.respuesta) return puerta.respuesta;

  const { id } = await contexto.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return respuesta("Venta no encontrada.", 404);

  const cuerpo = await request.json().catch(() => null);
  const motivo = String(cuerpo?.motivo ?? "").trim().slice(0, 500);
  if (motivo.length < 3) return respuesta("Indicá por qué anulás la venta.", 400);

  const { data, error } = await adminSinTipos().rpc("eos_erp_anular_venta", {
    p_usuario_id: puerta.usuarioId,
    p_venta_id: id,
    p_motivo: motivo,
  });

  if (error) {
    const texto = String(error.message ?? "");
    if (texto.includes("EOS_VENTA_NO_EXISTE")) return respuesta("Venta no encontrada.", 404);
    if (texto.includes("EOS_VENTA_CON_FACTURA")) {
      return respuesta("La venta tiene un documento fiscal emitido y requiere una anulación fiscal.", 409);
    }
    console.error("ERP: no se pudo anular la venta:", error);
    return respuesta("No pudimos anular la venta.", 503);
  }

  return NextResponse.json(data, { headers: noStore() });
}

function respuesta(error: string, status: number) {
  return NextResponse.json({ error }, { status, headers: noStore() });
}

function noStore() {
  return { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" };
}
