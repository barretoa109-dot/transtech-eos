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
 * Corregir una compra ya cargada. El espejo de
 * app/api/erp/ventas/[id]/editar: mismo motivo, misma forma
 * (`eos_erp_editar_compra`, v116, anula y vuelve a registrar en una sola
 * transacción en vez de actualizar en el lugar).
 */
export async function POST(request: Request, contexto: { params: Promise<{ id: string }> }) {
  const puerta = await exigirModulo("erp");
  if (puerta.respuesta) return puerta.respuesta;

  const { id } = await contexto.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return respuesta("Compra no encontrada.", 404);

  const cuerpo = await request.json().catch(() => null);

  const resultadoItems = normalizarItemsErp(cuerpo?.items, tasaValida, MAX_ITEMS);

  if (!resultadoItems.ok) {
    const mensaje =
      resultadoItems.motivo === "precio-invalido"
        ? "Los precios tienen que ser números mayores o iguales a cero."
        : resultadoItems.motivo === "cantidad-invalida"
          ? "Las cantidades tienen que ser números mayores a cero."
          : resultadoItems.motivo === "demasiados-items"
            ? `La compra admite como máximo ${MAX_ITEMS} ítems.`
            : resultadoItems.motivo === "item-invalido"
              ? "Cada ítem de la compra debe ser un objeto válido."
              : "La compra necesita al menos un ítem.";

    return respuesta(mensaje, 400);
  }

  const items = resultadoItems.items;
  const motivo = String(cuerpo?.motivo ?? "").trim().slice(0, 500) || "Editada";
  const fecha = /^\d{4}-\d{2}-\d{2}$/.test(String(cuerpo?.fecha ?? "")) ? String(cuerpo.fecha) : null;

  const admin = adminSinTipos();

  const { data: antes } = await admin
    .from("eos_erp_compras")
    .select("estado,total,moneda,fecha")
    .eq("id", id)
    .eq("usuario_id", puerta.usuarioId)
    .maybeSingle();

  const { data, error } = await admin.rpc("eos_erp_editar_compra", {
    p_usuario_id: puerta.usuarioId,
    p_compra_id: id,
    p_items: items,
    p_contacto_id: typeof cuerpo?.contacto_id === "string" ? cuerpo.contacto_id : null,
    p_fecha: fecha,
    p_moneda: monedaConocida(cuerpo?.moneda),
    p_condicion: cuerpo?.condicion === "credito" ? "credito" : "contado",
    p_pagada: cuerpo?.condicion === "credito" ? false : cuerpo?.pagada !== false,
    p_numero_comprobante: String(cuerpo?.numero_comprobante ?? "").trim().slice(0, 40) || null,
    p_notas: String(cuerpo?.notas ?? "").trim().slice(0, 2000) || null,
    p_motivo: motivo,
  });

  if (error) {
    const texto = String(error.message ?? "");

    await registrarOperacionErp(admin, {
      usuarioId: puerta.usuarioId,
      evento: "compra_editada",
      origen: "panel",
      resumen: `Intento de editar la compra ${id.slice(0, 8)}, rechazado`,
      referencia: id,
      resultado: "error",
      motivo,
      extra: { error: texto.slice(0, 120) },
    });

    if (texto.includes("EOS_COMPRA_NO_EXISTE")) return respuesta("Compra no encontrada.", 404);
    if (texto.includes("EOS_COMPRA_YA_ANULADA")) {
      return respuesta("Esa compra ya está anulada: no hay nada que editar.", 409);
    }
    if (texto.includes("EOS_COMPRA_PRODUCTO_AJENO")) {
      return respuesta("Uno de los productos no es tuyo.", 400);
    }
    if (texto.includes("EOS_CONTACTO_AJENO")) {
      return respuesta("El contacto no pertenece a tu cuenta.", 400);
    }
    if (texto.includes("EOS_MONEDA_INCOMPATIBLE")) {
      return respuesta(
        "Hay un producto en otra moneda que la de la compra. Un total no puede estar en dos monedas.",
        400,
      );
    }

    console.error("ERP: no se pudo editar la compra:", error);
    return respuesta("No pudimos editar la compra.", 503);
  }

  await registrarOperacionErp(admin, {
    usuarioId: puerta.usuarioId,
    evento: "compra_editada",
    origen: "panel",
    resumen: `Compra editada: ${formatearMonto(Number(antes?.total ?? 0), String(antes?.moneda ?? "PYG"))} → ${formatearMonto(Number(data?.total ?? 0), monedaConocida(cuerpo?.moneda))}`,
    referencia: String(data?.compra_id ?? id),
    resultado: "ok",
    motivo,
    antes: { estado: antes?.estado ?? null, total: Number(antes?.total ?? 0), fecha: antes?.fecha ?? null },
    despues: { compra_id: data?.compra_id ?? null, total: Number(data?.total ?? 0) },
    extra: { compra_anterior_id: id, items: items.length },
  });

  return NextResponse.json(data, { status: 201, headers: noStore() });
}

function respuesta(error: string, status: number) {
  return NextResponse.json({ error }, { status, headers: noStore() });
}

function noStore() {
  return { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" };
}
