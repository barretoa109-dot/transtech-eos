import { NextResponse } from "next/server";

import { exigirModulo } from "@/lib/modulos/acceso";
import { adminSinTipos } from "@/lib/supabase/sin-tipos";

export const dynamic = "force-dynamic";

/**
 * Pagar una compra que se había hecho a crédito.
 *
 * El momento en que la plata sale de verdad, y por eso el momento en que se
 * descuenta del panel. Antes no: una deuda con el proveedor no es plata gastada
 * todavía, y descontarla haría que el usuario deje de gastar plata que sí tiene.
 *
 * Idempotente: pagar dos veces la misma compra duplicaría el gasto, y un doble
 * clic alcanza para eso.
 */
export async function POST(_request: Request, contexto: { params: Promise<{ id: string }> }) {
  const puerta = await exigirModulo("erp");
  if (puerta.respuesta) return puerta.respuesta;

  const { id } = await contexto.params;

  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: "Compra no encontrada." }, { status: 404, headers: noStore() });
  }

  const { data, error } = await adminSinTipos().rpc("eos_erp_pagar_compra", {
    p_usuario_id: puerta.usuarioId,
    p_compra_id: id,
  });

  if (error) {
    const texto = String(error.message ?? "");

    if (texto.includes("EOS_COMPRA_NO_EXISTE")) {
      return NextResponse.json(
        { error: "Compra no encontrada." },
        { status: 404, headers: noStore() },
      );
    }

    if (texto.includes("EOS_COMPRA_ANULADA")) {
      return NextResponse.json(
        { error: "Esa compra está anulada." },
        { status: 409, headers: noStore() },
      );
    }

    console.error("ERP: no se pudo pagar la compra:", error);
    return NextResponse.json(
      { error: "No pudimos registrar el pago." },
      { status: 503, headers: noStore() },
    );
  }

  return NextResponse.json(data, { headers: noStore() });
}

function noStore() {
  return { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" };
}
