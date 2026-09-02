import { NextResponse } from "next/server";

import { exigirModulo } from "@/lib/modulos/acceso";
import { adminSinTipos } from "@/lib/supabase/sin-tipos";
import { registrarOperacionErp } from "@/lib/auditoria/registrar";

export const dynamic = "force-dynamic";

/**
 * Corregir el costo que quedó mal cargado en una venta.
 *
 * ============================================================
 * POR QUÉ HACE FALTA UNA RUTA SOLO PARA ESTO
 * ============================================================
 *
 * Cada línea de venta congela el costo que el producto tenía al venderse. Es
 * lo correcto: si mañana sube el proveedor, el margen de la venta de ayer no
 * puede cambiar solo. Pero deja un agujero — un costo mal tipeado queda mal
 * para siempre, y corregir la ficha del producto no arregla las ventas ya
 * hechas.
 *
 * Lo pidió Sofía, que usa EOS para su negocio. Corregir un error de carga no
 * es reescribir la historia: es escribirla bien.
 *
 * ============================================================
 * SOLO EL COSTO
 * ============================================================
 *
 * No el precio, ni la cantidad, ni el total, ni el stock, ni el movimiento de
 * dinero. Todo eso ya se contó en otros lados y cambiarlo por atrás dejaría
 * dos verdades. Para eso está anular y volver a cargar, que deja rastro de
 * las dos cosas.
 */
export async function PATCH(request: Request, contexto: { params: Promise<{ id: string }> }) {
  const puerta = await exigirModulo("erp");
  if (puerta.respuesta) return puerta.respuesta;

  const { id } = await contexto.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return respuesta("Venta no encontrada.", 404);

  const cuerpo = await request.json().catch(() => null);
  const entrada = Array.isArray(cuerpo?.costos) ? cuerpo.costos : null;

  if (!entrada || entrada.length === 0) {
    return respuesta("No mandaste ningún costo para corregir.", 400);
  }

  if (entrada.length > 100) {
    return respuesta("Demasiadas líneas en una sola corrección.", 400);
  }

  /*
   * El costo se valida acá y también en la base.
   *
   * Acá para poder decir cuál línea está mal en lugar de un error genérico de
   * Postgres; allá porque la base es la que manda y no puede confiar en que
   * quien la llama haya mirado.
   */
  const costos: { item_id: string; costo_unitario: string | null }[] = [];

  for (const fila of entrada) {
    const itemId = String(fila?.item_id ?? "");
    if (!/^[0-9a-f-]{36}$/i.test(itemId)) {
      return respuesta("Una de las líneas no tiene un identificador válido.", 400);
    }

    const crudo = fila?.costo_unitario;

    // Vacío es "no sé cuánto costó", que no es lo mismo que cero: un costo en
    // cero mostraría 100% de margen, que es el número más caro que puede
    // mostrar un sistema.
    if (crudo === null || crudo === undefined || String(crudo).trim() === "") {
      costos.push({ item_id: itemId, costo_unitario: null });
      continue;
    }

    const numero = Number(crudo);
    if (!Number.isFinite(numero) || numero < 0) {
      return respuesta("El costo tiene que ser un número mayor o igual a cero.", 400);
    }

    costos.push({ item_id: itemId, costo_unitario: String(numero) });
  }

  const admin = adminSinTipos();

  const { data, error } = await admin.rpc("eos_erp_corregir_costo_venta_v105", {
    p_usuario_id: puerta.usuarioId,
    p_venta_id: id,
    p_costos: costos,
    p_actualizar_producto: cuerpo?.actualizar_producto !== false,
  });

  if (error) {
    const texto = String(error.message ?? "");

    // El intento fallido también se asienta: la consulta más frecuente a una
    // bitácora es por qué algo NO pasó.
    await registrarOperacionErp(admin, {
      usuarioId: puerta.usuarioId,
      evento: "costo_corregido",
      origen: "panel",
      resumen: `Intento de corregir el costo de la venta ${id.slice(0, 8)}, rechazado`,
      referencia: id,
      resultado: texto.includes("EOS_VENTA_ANULADA") ? "rechazado" : "error",
      extra: { error: texto.slice(0, 120) },
    });

    if (texto.includes("EOS_VENTA_NO_EXISTE")) return respuesta("Venta no encontrada.", 404);
    if (texto.includes("EOS_VENTA_ANULADA")) {
      return respuesta("La venta está anulada: no cuenta en ningún margen.", 409);
    }
    if (texto.includes("EOS_ITEM_NO_EXISTE")) {
      return respuesta("Una de las líneas no pertenece a esta venta.", 400);
    }

    console.error("ERP: no se pudo corregir el costo:", error);
    return respuesta("No pudimos corregir el costo.", 503);
  }

  const corregidos = Number(data?.items_corregidos ?? 0);

  if (corregidos > 0) {
    await registrarOperacionErp(admin, {
      usuarioId: puerta.usuarioId,
      evento: "costo_corregido",
      origen: "panel",
      resumen:
        `Costo corregido en ${corregidos} ${corregidos === 1 ? "línea" : "líneas"} ` +
        `de la venta ${id.slice(0, 8)}`,
      referencia: id,
      resultado: "ok",
      antes: { lineas: data?.antes ?? [] },
      despues: { lineas: data?.despues ?? [] },
      extra: { productos_actualizados: Number(data?.productos_actualizados ?? 0) },
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
