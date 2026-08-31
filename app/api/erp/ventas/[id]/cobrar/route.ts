import { NextResponse } from "next/server";

import { exigirModulo } from "@/lib/modulos/acceso";
import { adminSinTipos } from "@/lib/supabase/sin-tipos";
import { registrarOperacionErp } from "@/lib/auditoria/registrar";

export const dynamic = "force-dynamic";

/**
 * Cobrar una venta que se había hecho a crédito.
 *
 * Es el momento en que la plata pasa de ser una promesa a estar en la cuenta, y
 * por eso es también el momento en que aparece en el panel financiero. Antes
 * no: mostrar como disponible lo que un cliente todavía no pagó es exactamente
 * la clase de optimismo que hace que a fin de mes no alcance.
 *
 * La función de la base es idempotente —una venta ya cobrada devuelve
 * `ya_estaba: true` sin duplicar el ingreso— porque un doble clic no puede
 * inventarle plata a nadie.
 */
export async function POST(_request: Request, contexto: { params: Promise<{ id: string }> }) {
  const puerta = await exigirModulo("erp");
  if (puerta.respuesta) return puerta.respuesta;

  const { id } = await contexto.params;

  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: "Venta no encontrada." }, { status: 404, headers: noStore() });
  }

  const { data, error } = await adminSinTipos().rpc("eos_erp_cobrar_venta", {
    p_usuario_id: puerta.usuarioId,
    p_venta_id: id,
  });

  if (error) {
    const texto = String(error.message ?? "");

    if (texto.includes("EOS_VENTA_NO_EXISTE")) {
      return NextResponse.json(
        { error: "Venta no encontrada." },
        { status: 404, headers: noStore() },
      );
    }

    if (texto.includes("EOS_VENTA_ANULADA")) {
      return NextResponse.json(
        { error: "Esa venta está anulada." },
        { status: 409, headers: noStore() },
      );
    }

    console.error("ERP: no se pudo cobrar la venta:", error);
    return NextResponse.json(
      { error: "No pudimos registrar el cobro." },
      { status: 503, headers: noStore() },
    );
  }

  /*
   * Cobrar y pagar crean un movimiento financiero: es el momento exacto en
   * que un número del panel cambia sin que el usuario haya tocado finanzas.
   * Sin esta línea, ese ingreso aparece y no hay dónde ver de dónde salió.
   */
  await registrarOperacionErp(adminSinTipos(), {
    usuarioId: puerta.usuarioId,
    evento: "venta_cobrada",
    origen: "panel",
    resumen: "Venta cobrada: el ingreso entró al panel",
    referencia: id,
    resultado: "ok",
    despues: { movimiento_id: String(data?.movimiento_id ?? "") },
    extra: { ya_estaba: data?.ya_estaba === true },
  });

  return NextResponse.json(data, { headers: noStore() });
}

function noStore() {
  return { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" };
}
