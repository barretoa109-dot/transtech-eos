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
  if (!/^[0-9a-f-]{36}$/i.test(id)) return respuesta("Venta no encontrada.", 404);

  const cuerpo = await request.json().catch(() => null);
  const motivo = String(cuerpo?.motivo ?? "").trim().slice(0, 500);
  if (motivo.length < 3) return respuesta("Indicá por qué anulás la venta.", 400);

  const admin = adminSinTipos();

  // El estado y el total ANTES de tocar nada. Después de anular ya no se puede
  // saber cuánto valía, y "cuánto era" es la primera pregunta que se hace
  // alguien seis meses más tarde mirando por qué el saldo no cierra.
  const { data: antes } = await admin
    .from("eos_erp_ventas")
    .select("estado,total,moneda,fecha")
    .eq("id", id)
    .or(filtroDeEmpresa(puerta.usuarioId, empresaId))
    .maybeSingle();

  const { data, error } = await admin.rpc("eos_erp_anular_venta", {
    p_usuario_id: puerta.usuarioId,
    p_venta_id: id,
    p_motivo: motivo,
  });

  if (error) {
    const texto = String(error.message ?? "");

    /*
     * El intento fallido también se asienta.
     *
     * Una bitácora que solo guarda lo que salió bien no sirve para la consulta
     * más frecuente: por qué algo NO pasó. "Se intentó anular y la base lo
     * rechazó porque hay una factura emitida" es la línea que le contesta al
     * usuario que jura haberla anulado.
     */
    await registrarOperacionErp(admin, {
      usuarioId: puerta.usuarioId,
      evento: "venta_anulada",
      origen: "panel",
      resumen: `Intento de anular la venta ${id.slice(0, 8)}, rechazado`,
      referencia: id,
      resultado: texto.includes("EOS_VENTA_CON_FACTURA") ? "rechazado" : "error",
      motivo,
      extra: { error: texto.slice(0, 120) },
    });

    if (texto.includes("EOS_VENTA_NO_EXISTE")) return respuesta("Venta no encontrada.", 404);
    if (texto.includes("EOS_VENTA_CON_FACTURA")) {
      return respuesta("La venta tiene un documento fiscal emitido y requiere una anulación fiscal.", 409);
    }
    console.error("ERP: no se pudo anular la venta:", error);
    return respuesta("No pudimos anular la venta.", 503);
  }

  await registrarOperacionErp(admin, {
    usuarioId: puerta.usuarioId,
    evento: "venta_anulada",
    origen: "panel",
    resumen: `Venta anulada por ${formatearMonto(Number(antes?.total ?? 0), String(antes?.moneda ?? "PYG"))}`,
    referencia: id,
    resultado: "ok",
    motivo,
    antes: { estado: antes?.estado ?? null, total: Number(antes?.total ?? 0), fecha: antes?.fecha ?? null },
    despues: { estado: "anulada" },
    extra: {
      ya_estaba: data?.ya_estaba === true,
      productos_devueltos: Number(data?.productos_devueltos ?? 0),
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
