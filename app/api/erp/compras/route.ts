import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase-admin";
import { createClient } from "@/lib/supabase/server";
import { exigirModulo } from "@/lib/modulos/acceso";
import { monedaConocida } from "@/lib/finanzas/monedas";
import { tasaValida } from "@/lib/erp/impuestos";

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

  const crudos = Array.isArray(cuerpo.items) ? cuerpo.items : [];

  const items = crudos
    .filter((i): i is Record<string, unknown> => typeof i === "object" && i !== null)
    .slice(0, MAX_ITEMS)
    .map((i) => ({
      producto_id: typeof i.producto_id === "string" ? i.producto_id : null,
      descripcion: String(i.descripcion ?? "").trim().slice(0, 300) || null,
      cantidad: Number(i.cantidad ?? 1),
      precio_unitario:
        i.precio_unitario === undefined || i.precio_unitario === null
          ? null
          : Number(i.precio_unitario),
      iva: i.iva === undefined || i.iva === null ? null : tasaValida(i.iva),
    }))
    .filter((i) => Number.isFinite(i.cantidad) && i.cantidad > 0);

  if (items.length === 0) {
    return NextResponse.json(
      { error: "La compra necesita al menos un ítem." },
      { status: 400, headers: noStore() },
    );
  }

  const fecha = /^\d{4}-\d{2}-\d{2}$/.test(String(cuerpo.fecha ?? "")) ? String(cuerpo.fecha) : null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- el cliente tipado no conoce esta función
  const { data, error } = await (createAdminClient() as any).rpc("eos_erp_registrar_compra", {
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
