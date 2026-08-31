import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { exigirModulo } from "@/lib/modulos/acceso";
import { monedaConocida } from "@/lib/finanzas/monedas";
import { tasaValida } from "@/lib/erp/impuestos";
import { normalizarItemsErp } from "@/lib/erp/entrada";
import { adminSinTipos } from "@/lib/supabase/sin-tipos";

export const dynamic = "force-dynamic";

/**
 * Las compras.
 *
 * El espejo de las ventas, con la diferencia que importa: acá la plata SALE y
 * el stock ENTRA. Y una compra a crédito no descuenta nada todavía — anotarla
 * como gasto mostraría menos disponible del que hay, y el usuario dejaría de
 * gastar plata que sí tiene.
 *
 * Igual que las ventas, el registro vive en una función de la base
 * (`eos_erp_registrar_compra`, migración v70): cabecera, ítems, stock, costo del
 * producto y el gasto son cinco escrituras que no pueden quedar a medias.
 */

const MAX_ITEMS = 200;

export async function GET(request: Request) {
  const puerta = await exigirModulo("erp");
  if (puerta.respuesta) return puerta.respuesta;

  const supabase = await createClient();
  const limite = Math.min(Number(new URL(request.url).searchParams.get("limite") ?? 50) || 50, 200);

  const { data, error } = await supabase
    .from("eos_erp_compras")
    .select(
      "id,fecha,moneda,subtotal,iva_total,total,condicion,estado,numero_comprobante," +
        "movimiento_id,notas,creado_en," +
        "contacto:eos_crm_contactos(id,nombre)," +
        "items:eos_erp_compra_items(id,descripcion,cantidad,precio_unitario,iva,total,orden)",
    )
    .eq("usuario_id", puerta.usuarioId)
    .order("fecha", { ascending: false })
    .order("creado_en", { ascending: false })
    .limit(limite);

  if (error) {
    console.error("ERP: no se pudieron leer las compras:", error);
    return NextResponse.json({ error: "No disponible." }, { status: 503, headers: noStore() });
  }

  return NextResponse.json({ compras: data ?? [] }, { headers: noStore() });
}

export async function POST(request: Request) {
  const puerta = await exigirModulo("erp");
  if (puerta.respuesta) return puerta.respuesta;

  let cuerpo: Record<string, unknown>;
  try {
    cuerpo = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido." }, { status: 400, headers: noStore() });
  }

  const resultadoItems = normalizarItemsErp(cuerpo.items, tasaValida, MAX_ITEMS);

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

    return NextResponse.json(
      { error: mensaje },
      { status: 400, headers: noStore() },
    );
  }

  const items = resultadoItems.items;

  const fecha = /^\d{4}-\d{2}-\d{2}$/.test(String(cuerpo.fecha ?? "")) ? String(cuerpo.fecha) : null;

  const { data, error } = await adminSinTipos().rpc("eos_erp_registrar_compra", {
    p_usuario_id: puerta.usuarioId,
    p_items: items,
    p_contacto_id: typeof cuerpo.contacto_id === "string" ? cuerpo.contacto_id : null,
    p_fecha: fecha,
    p_moneda: monedaConocida(cuerpo.moneda),
    p_condicion: cuerpo.condicion === "credito" ? "credito" : "contado",
    p_pagada: cuerpo.condicion === "credito" ? false : cuerpo.pagada !== false,
    p_numero_comprobante: String(cuerpo.numero_comprobante ?? "").trim().slice(0, 40) || null,
    p_notas: String(cuerpo.notas ?? "").trim().slice(0, 2000) || null,
  });

  if (error) {
    const texto = String(error.message ?? "");

    if (texto.includes("EOS_COMPRA_PRODUCTO_AJENO")) {
      return NextResponse.json(
        { error: "Uno de los productos no es tuyo." },
        { status: 400, headers: noStore() },
      );
    }

    if (texto.includes("EOS_COMPRA_CANTIDAD_INVALIDA")) {
      return NextResponse.json(
        { error: "Las cantidades tienen que ser mayores a cero." },
        { status: 400, headers: noStore() },
      );
    }

    if (texto.includes("EOS_CONTACTO_AJENO")) {
      return NextResponse.json(
        { error: "El contacto no pertenece a tu cuenta." },
        { status: 400, headers: noStore() },
      );
    }

    if (texto.includes("eos_erp_compra_items_precio_valido_v76")) {
      return NextResponse.json(
        { error: "Los precios tienen que ser números mayores o iguales a cero." },
        { status: 400, headers: noStore() },
      );
    }

    // Trigger v93: un producto en una moneda dentro de un documento en otra.
    if (texto.includes("EOS_MONEDA_INCOMPATIBLE")) {
      return NextResponse.json(
        {
          error:
            "Hay un producto en otra moneda que la de la compra. Un total no puede estar en dos monedas.",
        },
        { status: 400, headers: noStore() },
      );
    }

    console.error("ERP: no se pudo registrar la compra:", error);
    return NextResponse.json(
      { error: "No pudimos registrar la compra." },
      { status: 503, headers: noStore() },
    );
  }

  return NextResponse.json(data, { status: 201, headers: noStore() });
}

function noStore() {
  return { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" };
}
