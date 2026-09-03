import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { exigirModulo } from "@/lib/modulos/acceso";
import { filtroDeEmpresa, miEmpresa } from "@/lib/empresa/acceso";
import { tasaValida } from "@/lib/erp/impuestos";
import { monedaConocida } from "@/lib/finanzas/monedas";
import { numeroProducto, numeroProductoOpcional } from "@/lib/erp/entrada-producto";

export const dynamic = "force-dynamic";

/**
 * Editar y dar de baja un producto.
 *
 * Los precios cambian, los nombres se escriben mal y los códigos se repiten.
 * Sin esto, la única forma de corregir un precio era crear un producto nuevo, y
 * a la tercera vez el catálogo tiene tres versiones de la misma cosa y el
 * informe de ventas no significa nada.
 *
 * ============================================================
 * ESTA RUTA NO TOCA `stock_actual`
 * ============================================================
 *
 * A propósito, y es la regla más importante del módulo. El stock se mueve
 * únicamente por una venta, una compra o un ajuste, y cada uno de esos deja su
 * fila en `eos_erp_movimientos_stock` con el saldo resultante.
 *
 * Si esta pantalla pudiera escribir el saldo directamente, dentro de seis meses
 * nadie podría explicar por qué el sistema dice 12 y en el estante hay 9: el
 * rastro tendría agujeros justo donde alguien corrigió a mano. Para eso está
 * `POST /api/erp/productos/[id]/ajustar-stock`, que pide un motivo.
 *
 * La baja es lógica (`activo = false`) y no un DELETE: las ventas viejas
 * apuntan a este producto y borrarlo dejaría el historial sin nombres.
 */

const COLUMNAS =
  "id,codigo,nombre,descripcion,unidad,precio_venta,costo,moneda,iva," +
  "controla_stock,stock_actual,stock_minimo,activo,creado_en";

export async function PATCH(request: Request, contexto: { params: Promise<{ id: string }> }) {
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

  /*
   * Sólo se escribe lo que vino. Un PATCH que rellena con valores por defecto
   * lo que el formulario no mandó borra datos que nadie pidió borrar.
   */
  const cambios: Record<string, unknown> = {};

  if (cuerpo.nombre !== undefined) {
    const nombre = String(cuerpo.nombre ?? "").trim().slice(0, 200);

    if (!nombre) {
      return NextResponse.json(
        { error: "El producto necesita un nombre." },
        { status: 400, headers: noStore() },
      );
    }

    cambios.nombre = nombre;
  }

  if (cuerpo.precio_venta !== undefined) {
    const precio = numeroProducto(cuerpo.precio_venta);
    if (!precio.ok) {
      return NextResponse.json(
        { error: "El precio tiene que ser un número mayor o igual a cero.", campo: "precio_venta" },
        { status: 400, headers: noStore() },
      );
    }
    cambios.precio_venta = precio.valor;
  }

  if (cuerpo.costo !== undefined) {
    const costo = numeroProductoOpcional(cuerpo.costo);
    if (!costo.ok) {
      return NextResponse.json(
        { error: "El costo tiene que ser un número mayor o igual a cero.", campo: "costo" },
        { status: 400, headers: noStore() },
      );
    }
    cambios.costo = costo.valor;
  }

  if (cuerpo.codigo !== undefined) {
    cambios.codigo = String(cuerpo.codigo ?? "").trim().slice(0, 60) || null;
  }

  if (cuerpo.descripcion !== undefined) {
    cambios.descripcion = String(cuerpo.descripcion ?? "").trim().slice(0, 2000) || null;
  }

  if (cuerpo.unidad !== undefined) {
    cambios.unidad = String(cuerpo.unidad ?? "").trim().slice(0, 20) || "unidad";
  }

  if (cuerpo.moneda !== undefined) cambios.moneda = monedaConocida(cuerpo.moneda);
  if (cuerpo.iva !== undefined) cambios.iva = tasaValida(cuerpo.iva);
  if (cuerpo.stock_minimo !== undefined) {
    const minimo = numeroProducto(cuerpo.stock_minimo);
    if (!minimo.ok) {
      return NextResponse.json(
        { error: "El stock mínimo tiene que ser un número mayor o igual a cero.", campo: "stock_minimo" },
        { status: 400, headers: noStore() },
      );
    }
    cambios.stock_minimo = minimo.valor;
  }
  if (cuerpo.activo !== undefined) cambios.activo = cuerpo.activo === true;

  /*
   * Encender el control de stock no inventa existencias: arranca en el saldo
   * que ya tenía —cero para un producto que nunca lo controló— y de ahí en
   * adelante se mueve con ventas, compras y ajustes. Apagarlo tampoco borra
   * nada: el saldo queda quieto y deja de mostrarse.
   */
  if (cuerpo.controla_stock !== undefined) cambios.controla_stock = cuerpo.controla_stock === true;

  if (Object.keys(cambios).length === 0) {
    return NextResponse.json({ error: "No hay nada que cambiar." }, { status: 400, headers: noStore() });
  }

  cambios.actualizado_en = new Date().toISOString();

  const supabase = await createClient();

  // Las dos fronteras mientras dure la transición de la v109/v110.
  const empresaId = await miEmpresa(supabase);

  // Sale del cliente del usuario: la RLS de la tabla ya impide tocar lo ajeno.
  const { data, error } = await supabase
    .from("eos_erp_productos")
    .update(cambios)
    .eq("id", id)
    .or(filtroDeEmpresa(puerta.usuarioId, empresaId))
    .select(COLUMNAS)
    .maybeSingle();

  if (error) {
    if (String(error.code) === "23505") {
      return NextResponse.json(
        { error: "Ya tenés un producto con ese código.", campo: "codigo" },
        { status: 409, headers: noStore() },
      );
    }

    console.error("ERP: no se pudo editar el producto:", error);
    return NextResponse.json(
      { error: "No pudimos guardar los cambios." },
      { status: 503, headers: noStore() },
    );
  }

  if (!data) {
    return NextResponse.json({ error: "Producto no encontrado." }, { status: 404, headers: noStore() });
  }

  return NextResponse.json({ producto: data }, { headers: noStore() });
}

/* Baja lógica: el producto deja de ofrecerse pero el historial lo sigue nombrando. */
export async function DELETE(_request: Request, contexto: { params: Promise<{ id: string }> }) {
  const puerta = await exigirModulo("erp");
  if (puerta.respuesta) return puerta.respuesta;

  const { id } = await contexto.params;

  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: "Producto no encontrado." }, { status: 404, headers: noStore() });
  }

  const supabase = await createClient();

  // Las dos fronteras mientras dure la transición de la v109/v110.
  const empresaId = await miEmpresa(supabase);

  const { data, error } = await supabase
    .from("eos_erp_productos")
    .update({ activo: false, actualizado_en: new Date().toISOString() })
    .eq("id", id)
    .or(filtroDeEmpresa(puerta.usuarioId, empresaId))
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("ERP: no se pudo dar de baja el producto:", error);
    return NextResponse.json(
      { error: "No pudimos dar de baja el producto." },
      { status: 503, headers: noStore() },
    );
  }

  if (!data) {
    return NextResponse.json({ error: "Producto no encontrado." }, { status: 404, headers: noStore() });
  }

  return NextResponse.json({ ok: true, id: data.id }, { headers: noStore() });
}

function noStore() {
  return { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" };
}
