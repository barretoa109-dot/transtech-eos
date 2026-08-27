import { NextResponse } from "next/server";

import { exigirModulo } from "@/lib/modulos/acceso";
import { createAdminClient } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

export async function POST(request: Request, contexto: { params: Promise<{ id: string }> }) {
  const puerta = await exigirModulo("erp");
  if (puerta.respuesta) return puerta.respuesta;

  const { id } = await contexto.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return respuesta("Producto no encontrado.", 404);

  const cuerpo = await request.json().catch(() => null);
  const motivo = String(cuerpo?.motivo ?? "").trim().slice(0, 500);
  const stockContado = numeroOpcional(cuerpo?.stock_contado);

  if (motivo.length < 3) return respuesta("Indicá el motivo del ajuste.", 400);
  if (stockContado === null || stockContado < 0) {
    return respuesta("El stock contado debe ser un número mayor o igual a cero.", 400);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- RPC agregado por migración v78
  const { data, error } = await (createAdminClient() as any).rpc("eos_erp_ajustar_stock", {
    p_usuario_id: puerta.usuarioId,
    p_producto_id: id,
    p_stock_contado: stockContado,
    p_delta: null,
    p_motivo: motivo,
  });

  if (error) {
    const texto = String(error.message ?? "");
    if (texto.includes("EOS_PRODUCTO_NO_EXISTE")) return respuesta("Producto no encontrado.", 404);
    if (texto.includes("EOS_PRODUCTO_SIN_STOCK")) {
      return respuesta("Este producto no lleva control de stock.", 409);
    }
    console.error("ERP: no se pudo ajustar el stock:", error);
    return respuesta("No pudimos ajustar el stock.", 503);
  }

  return NextResponse.json(data, { headers: noStore() });
}

function numeroOpcional(valor: unknown) {
  if (valor === "" || valor === null || valor === undefined) return null;
  const numero = Number(valor);
  return Number.isFinite(numero) ? numero : null;
}

function respuesta(error: string, status: number) {
  return NextResponse.json({ error }, { status, headers: noStore() });
}

function noStore() {
  return { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" };
}
