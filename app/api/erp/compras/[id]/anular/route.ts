import { NextResponse } from "next/server";

import { exigirModulo } from "@/lib/modulos/acceso";
import { empresaDe, filtroDeEmpresa } from "@/lib/empresa/acceso";
import { adminSinTipos } from "@/lib/supabase/sin-tipos";
import { registrarOperacionErp } from "@/lib/auditoria/registrar";
import { formatearMonto } from "@/lib/finanzas/formato";

export const dynamic = "force-dynamic";

export async function POST(request: Request, contexto: { params: Promise<{ id: string }> }) {
  const puerta = await exigirModulo("erp");
  if (puerta.respuesta) return puerta.respuesta;

  // Las dos fronteras mientras dure la transición de la v109/v110.
  const empresaId = await empresaDe(adminSinTipos(), puerta.usuarioId);

  const { id } = await contexto.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return respuesta("Compra no encontrada.", 404);

  const cuerpo = await request.json().catch(() => null);
  const motivo = String(cuerpo?.motivo ?? "").trim().slice(0, 500);
  if (motivo.length < 3) return respuesta("Indicá por qué anulás la compra.", 400);

  const admin = adminSinTipos();

  // El estado y el total antes de tocar nada: después de anular ya no se puede
  // saber cuánto valía.
  const { data: antes } = await admin
    .from("eos_erp_compras")
    .select("estado,total,moneda,fecha")
    .eq("id", id)
    .or(filtroDeEmpresa(puerta.usuarioId, empresaId))
    .maybeSingle();

  const { data, error } = await admin.rpc("eos_erp_anular_compra", {
    p_usuario_id: puerta.usuarioId,
    p_compra_id: id,
    p_motivo: motivo,
  });

  if (error) {
    const texto = String(error.message ?? "");

    await registrarOperacionErp(admin, {
      usuarioId: puerta.usuarioId,
      evento: "compra_anulada",
      origen: "panel",
      resumen: `Intento de anular la compra ${id.slice(0, 8)}, rechazado`,
      referencia: id,
      resultado: "error",
      motivo,
      extra: { error: texto.slice(0, 120) },
    });

    if (texto.includes("EOS_COMPRA_NO_EXISTE")) return respuesta("Compra no encontrada.", 404);
    console.error("ERP: no se pudo anular la compra:", error);
    return respuesta("No pudimos anular la compra.", 503);
  }

  /*
   * El detalle del costo va al registro completo.
   *
   * Anular una compra decide si el costo del producto se rebobina o se
   * preserva, según haya compras posteriores o ediciones manuales. Esa decisión
   * es exactamente la que después nadie puede reconstruir mirando la tabla, así
   * que queda asentada acá con sus tres números.
   */
  await registrarOperacionErp(admin, {
    usuarioId: puerta.usuarioId,
    evento: "compra_anulada",
    origen: "panel",
    resumen: `Compra anulada por ${formatearMonto(Number(antes?.total ?? 0), String(antes?.moneda ?? "PYG"))}`,
    referencia: id,
    resultado: "ok",
    motivo,
    antes: { estado: antes?.estado ?? null, total: Number(antes?.total ?? 0), fecha: antes?.fecha ?? null },
    despues: { estado: "anulada" },
    extra: {
      ya_estaba: data?.ya_estaba === true,
      productos_retirados: Number(data?.productos_retirados ?? 0),
      costos_restaurados: Number(data?.costos_restaurados ?? 0),
      costos_preservados: Number(data?.costos_preservados ?? 0),
      movimiento_borrado: data?.movimiento_borrado === true,
    },
  });

  return NextResponse.json(data, { headers: noStore() });
}

function respuesta(error: string, status: number) {
  return NextResponse.json({ error }, { status, headers: noStore() });
}

function noStore() {
  return { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" };
}
