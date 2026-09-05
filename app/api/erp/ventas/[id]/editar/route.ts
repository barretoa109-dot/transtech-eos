import { NextResponse } from "next/server";

import { exigirModulo } from "@/lib/modulos/acceso";
import { monedaConocida } from "@/lib/finanzas/monedas";
import { tasaValida } from "@/lib/erp/impuestos";
import { normalizarItemsErp } from "@/lib/erp/entrada";
import { adminSinTipos } from "@/lib/supabase/sin-tipos";
import { registrarOperacionErp } from "@/lib/auditoria/registrar";
import { formatearMonto } from "@/lib/finanzas/formato";

export const dynamic = "force-dynamic";

const MAX_ITEMS = 200;

/**
 * Corregir una venta ya cargada: cantidad, precio, producto, lo que sea.
 *
 * ============================================================
 * POR QUÉ ESTO NO ES UN UPDATE
 * ============================================================
 *
 * `eos_erp_editar_venta` (v116) anula la venta vieja y registra una nueva con
 * los datos corregidos, las dos cosas en una sola transacción. No hay un
 * tercer camino que reescriba `eos_erp_ventas` en el lugar: el stock ya se
 * movió, la plata ya entró (o no) al panel, y una venta con factura
 * electrónica activa no se puede tocar sin pasar por el circuito fiscal. Ya
 * existían esas reglas en `eos_erp_anular_venta` — esta ruta las hereda en
 * vez de reinventarlas.
 *
 * Por fuera se ve como "editar"; por dentro, la venta que resulta tiene un id
 * nuevo. `venta_anterior_id` en la respuesta es el rastro de esa diferencia.
 */
export async function POST(request: Request, contexto: { params: Promise<{ id: string }> }) {
  const puerta = await exigirModulo("erp");
  if (puerta.respuesta) return puerta.respuesta;

  const { id } = await contexto.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return respuesta("Venta no encontrada.", 404);

  const cuerpo = await request.json().catch(() => null);

  const resultadoItems = normalizarItemsErp(cuerpo?.items, tasaValida, MAX_ITEMS);

  if (!resultadoItems.ok) {
    const mensaje =
      resultadoItems.motivo === "precio-invalido"
        ? "Los precios tienen que ser números mayores o iguales a cero."
        : resultadoItems.motivo === "cantidad-invalida"
          ? "Las cantidades tienen que ser números mayores a cero."
          : resultadoItems.motivo === "demasiados-items"
            ? `La venta admite como máximo ${MAX_ITEMS} ítems.`
            : resultadoItems.motivo === "item-invalido"
              ? "Cada ítem de la venta debe ser un objeto válido."
              : "La venta necesita al menos un ítem.";

    return respuesta(mensaje, 400);
  }

  const items = resultadoItems.items;
  const motivo = String(cuerpo?.motivo ?? "").trim().slice(0, 500) || "Editada";
  const fecha = /^\d{4}-\d{2}-\d{2}$/.test(String(cuerpo?.fecha ?? "")) ? String(cuerpo.fecha) : null;

  const admin = adminSinTipos();

  const { data: antes } = await admin
    .from("eos_erp_ventas")
    .select("estado,total,moneda,fecha")
    .eq("id", id)
    .eq("usuario_id", puerta.usuarioId)
    .maybeSingle();

  const { data, error } = await admin.rpc("eos_erp_editar_venta", {
    p_usuario_id: puerta.usuarioId,
    p_venta_id: id,
    p_items: items,
    p_contacto_id: typeof cuerpo?.contacto_id === "string" ? cuerpo.contacto_id : null,
    p_fecha: fecha,
    p_moneda: monedaConocida(cuerpo?.moneda),
    p_condicion: cuerpo?.condicion === "credito" ? "credito" : "contado",
    p_cobrada: cuerpo?.condicion === "credito" ? false : cuerpo?.cobrada !== false,
    p_notas: String(cuerpo?.notas ?? "").trim().slice(0, 2000) || null,
    p_motivo: motivo,
  });

  if (error) {
    const texto = String(error.message ?? "");

    await registrarOperacionErp(admin, {
      usuarioId: puerta.usuarioId,
      evento: "venta_editada",
      origen: "panel",
      resumen: `Intento de editar la venta ${id.slice(0, 8)}, rechazado`,
      referencia: id,
      resultado: texto.includes("EOS_VENTA_CON_FACTURA") ? "rechazado" : "error",
      motivo,
      extra: { error: texto.slice(0, 120) },
    });

    if (texto.includes("EOS_VENTA_NO_EXISTE")) return respuesta("Venta no encontrada.", 404);
    if (texto.includes("EOS_VENTA_YA_ANULADA")) {
      return respuesta("Esa venta ya está anulada: no hay nada que editar.", 409);
    }
    if (texto.includes("EOS_VENTA_CON_FACTURA")) {
      return respuesta("La venta tiene un documento fiscal emitido y requiere una anulación fiscal.", 409);
    }
    if (texto.includes("EOS_VENTA_PRODUCTO_AJENO")) {
      return respuesta("Uno de los productos no es tuyo.", 400);
    }
    if (texto.includes("EOS_CONTACTO_AJENO")) {
      return respuesta("El contacto no pertenece a tu cuenta.", 400);
    }
    if (texto.includes("EOS_MONEDA_INCOMPATIBLE")) {
      return respuesta(
        "Hay un producto en otra moneda que la de la venta. Un total no puede estar en dos monedas.",
        400,
      );
    }

    console.error("ERP: no se pudo editar la venta:", error);
    return respuesta("No pudimos editar la venta.", 503);
  }

  await registrarOperacionErp(admin, {
    usuarioId: puerta.usuarioId,
    evento: "venta_editada",
    origen: "panel",
    resumen: `Venta editada: ${formatearMonto(Number(antes?.total ?? 0), String(antes?.moneda ?? "PYG"))} → ${formatearMonto(Number(data?.total ?? 0), monedaConocida(cuerpo?.moneda))}`,
    referencia: String(data?.venta_id ?? id),
    resultado: "ok",
    motivo,
    antes: { estado: antes?.estado ?? null, total: Number(antes?.total ?? 0), fecha: antes?.fecha ?? null },
    despues: { venta_id: data?.venta_id ?? null, total: Number(data?.total ?? 0) },
    extra: { venta_anterior_id: id, items: items.length },
  });

  return NextResponse.json(data, { status: 201, headers: noStore() });
}

function respuesta(error: string, status: number) {
  return NextResponse.json({ error }, { status, headers: noStore() });
}

function noStore() {
  return { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" };
}
