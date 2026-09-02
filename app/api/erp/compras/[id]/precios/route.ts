import { NextResponse } from "next/server";

import { exigirModulo } from "@/lib/modulos/acceso";
import { adminSinTipos } from "@/lib/supabase/sin-tipos";
import { registrarOperacionErp } from "@/lib/auditoria/registrar";
import { formatearMonto } from "@/lib/finanzas/formato";

export const dynamic = "force-dynamic";

/**
 * Corregir los importes de una compra ya registrada.
 *
 * La compra es donde entra el costo: un número mal tipeado acá se convierte en
 * el costo del producto, en el margen de todo lo que se venda después y en un
 * gasto del panel. Hasta ahora la única salida era anular y volver a cargar la
 * compra entera.
 *
 * Los precios sí, las cantidades no: cambiar un precio mueve plata —el total y
 * el gasto, que la base actualiza en la misma transacción— mientras que cambiar
 * una cantidad movería mercadería que ya se sumó al stock con su propia fila de
 * movimiento. Para eso está anular y volver a cargar, que deja las dos huellas.
 */
export async function PATCH(request: Request, contexto: { params: Promise<{ id: string }> }) {
  const puerta = await exigirModulo("erp");
  if (puerta.respuesta) return puerta.respuesta;

  const { id } = await contexto.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return respuesta("Compra no encontrada.", 404);

  const cuerpo = await request.json().catch(() => null);
  const entrada = Array.isArray(cuerpo?.precios) ? cuerpo.precios : null;

  if (!entrada || entrada.length === 0) {
    return respuesta("No mandaste ningún precio para corregir.", 400);
  }

  if (entrada.length > 100) {
    return respuesta("Demasiadas líneas en una sola corrección.", 400);
  }

  const precios: { item_id: string; precio_unitario: string }[] = [];

  for (const fila of entrada) {
    const itemId = String(fila?.item_id ?? "");
    if (!/^[0-9a-f-]{36}$/i.test(itemId)) {
      return respuesta("Una de las líneas no tiene un identificador válido.", 400);
    }

    const numero = Number(fila?.precio_unitario);

    // Cero se admite —hay muestras y bonificaciones— pero vacío no: una
    // compra sin precio no existe, algo se pagó.
    if (!Number.isFinite(numero) || numero < 0) {
      return respuesta("El precio tiene que ser un número mayor o igual a cero.", 400);
    }

    precios.push({ item_id: itemId, precio_unitario: String(numero) });
  }

  const admin = adminSinTipos();

  const { data, error } = await admin.rpc("eos_erp_corregir_compra_v106", {
    p_usuario_id: puerta.usuarioId,
    p_compra_id: id,
    p_precios: precios,
    p_actualizar_producto: cuerpo?.actualizar_producto !== false,
  });

  if (error) {
    const texto = String(error.message ?? "");

    await registrarOperacionErp(admin, {
      usuarioId: puerta.usuarioId,
      evento: "costo_corregido",
      origen: "panel",
      resumen: `Intento de corregir la compra ${id.slice(0, 8)}, rechazado`,
      referencia: id,
      resultado: texto.includes("EOS_COMPRA_ANULADA") ? "rechazado" : "error",
      extra: { error: texto.slice(0, 120) },
    });

    if (texto.includes("EOS_COMPRA_NO_EXISTE")) return respuesta("Compra no encontrada.", 404);
    if (texto.includes("EOS_COMPRA_ANULADA")) {
      return respuesta("La compra está anulada: no cuenta en ningún costo.", 409);
    }
    if (texto.includes("EOS_ITEM_NO_EXISTE")) {
      return respuesta("Una de las líneas no pertenece a esta compra.", 400);
    }

    console.error("ERP: no se pudo corregir la compra:", error);
    return respuesta("No pudimos corregir la compra.", 503);
  }

  const corregidos = Number(data?.items_corregidos ?? 0);

  if (corregidos > 0) {
    const antes = Number(data?.total_anterior ?? 0);
    const despues = Number(data?.total ?? 0);

    await registrarOperacionErp(admin, {
      usuarioId: puerta.usuarioId,
      evento: "costo_corregido",
      origen: "panel",
      resumen:
        `Compra corregida de ${formatearMonto(antes, "PYG")} a ${formatearMonto(despues, "PYG")} ` +
        `en ${corregidos} ${corregidos === 1 ? "línea" : "líneas"}`,
      referencia: id,
      resultado: "ok",
      antes: { total: antes, lineas: data?.antes ?? [] },
      despues: { total: despues, lineas: data?.despues ?? [] },
      extra: {
        productos_actualizados: Number(data?.productos_actualizados ?? 0),
        movimiento_actualizado: data?.movimiento_actualizado === true,
      },
    });
  }

  return NextResponse.json(data, { headers: noStore() });
}

function respuesta(error: string, status: number) {
  return NextResponse.json({ error }, { status, headers: noStore() });
}

function noStore() {
  return { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" };
}
