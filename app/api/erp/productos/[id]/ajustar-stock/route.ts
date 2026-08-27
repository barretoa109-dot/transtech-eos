import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase-admin";
import { exigirModulo } from "@/lib/modulos/acceso";

export const dynamic = "force-dynamic";

/**
 * Ajustar el stock de un producto.
 *
 * Dos formas, porque son dos gestos distintos de la vida real:
 *
 *   `stock_contado`  "conté y hay 47"     -> el conteo físico de fin de mes
 *   `delta`          "se rompieron 3"     -> la merma puntual, sin contar todo
 *
 * Va una o la otra. Sin esto el saldo se desvía de la realidad en semanas y no
 * hay forma de volver a alinearlo: el usuario deja de mirar el número, y un
 * stock que nadie mira es peor que no tener stock, porque igual ocupa pantalla
 * y de vez en cuando alguien le cree.
 *
 * El ajuste queda registrado como movimiento con su motivo. Nunca se escribe el
 * saldo en silencio: esa es la única razón por la que después se puede explicar
 * una diferencia.
 */
export async function POST(request: Request, contexto: { params: Promise<{ id: string }> }) {
  const puerta = await exigirModulo("erp");
  if (puerta.respuesta) return puerta.respuesta;

  const { id } = await contexto.params;

  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: "Producto no encontrado." }, { status: 404, headers: noStore() });
  }

  let cuerpo: Record<string, unknown>;
  try {
    cuerpo = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido." }, { status: 400, headers: noStore() });
  }

  const contado = numeroOpcional(cuerpo.stock_contado);
  const delta = numeroOpcional(cuerpo.delta);

  if ((contado === null) === (delta === null)) {
    return NextResponse.json(
      { error: "Mandá el conteo o la diferencia, una sola de las dos." },
      { status: 400, headers: noStore() },
    );
  }

  const motivo = String(cuerpo.motivo ?? "").trim().slice(0, 300) || null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- el cliente tipado no conoce esta función
  const { data, error } = await (createAdminClient() as any).rpc("eos_erp_ajustar_stock", {
    p_usuario_id: puerta.usuarioId,
    p_producto_id: id,
    p_stock_contado: contado,
    p_delta: delta,
    p_motivo: motivo,
  });

  if (error) {
    const texto = String(error.message ?? "");

    if (texto.includes("EOS_PRODUCTO_NO_EXISTE")) {
      return NextResponse.json(
        { error: "Producto no encontrado." },
        { status: 404, headers: noStore() },
      );
    }

    if (texto.includes("EOS_PRODUCTO_SIN_STOCK")) {
      return NextResponse.json(
        {
          error: "Ese producto no lleva control de stock. Activalo primero desde su ficha.",
          codigo: "sin_control",
        },
        { status: 409, headers: noStore() },
      );
    }

    if (texto.includes("EOS_AJUSTE_CONTEO_NEGATIVO")) {
      return NextResponse.json(
        { error: "El conteo no puede ser negativo." },
        { status: 400, headers: noStore() },
      );
    }

    console.error("ERP: no se pudo ajustar el stock:", error);
    return NextResponse.json(
      { error: "No pudimos ajustar el stock." },
      { status: 503, headers: noStore() },
    );
  }

  return NextResponse.json(data, { headers: noStore() });
}

/* null cuando no vino, para poder distinguirlo de un cero legítimo. */
function numeroOpcional(valor: unknown) {
  if (valor === undefined || valor === null || valor === "") return null;

  const n = Number(valor);

  return Number.isFinite(n) ? n : null;
}

function noStore() {
  return { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" };
}
