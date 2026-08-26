import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { exigirModulo } from "@/lib/modulos/acceso";
import { ivaIncluido, tasaValida } from "@/lib/erp/impuestos";
import { monedaConocida } from "@/lib/finanzas/monedas";

export const dynamic = "force-dynamic";

/**
 * Los productos y servicios que vende el usuario.
 *
 * `precio_venta` es SIEMPRE el precio final, con IVA adentro, porque es como se
 * dicen los precios en Paraguay. La respuesta incluye el impuesto ya calculado
 * para que ninguna pantalla lo derive por su cuenta: dos derivaciones del mismo
 * número terminan siempre en dos números.
 */

const COLUMNAS =
  "id,codigo,nombre,descripcion,unidad,precio_venta,costo,moneda,iva," +
  "controla_stock,stock_actual,stock_minimo,activo,creado_en";

const MAX_FILAS = 500;

export async function GET(request: Request) {
  const puerta = await exigirModulo("erp");
  if (puerta.respuesta) return puerta.respuesta;

  const supabase = await createClient();
  const busqueda = (new URL(request.url).searchParams.get("busca") ?? "").trim().slice(0, 80);

  let consulta = supabase
    .from("eos_erp_productos")
    .select(COLUMNAS)
    .eq("usuario_id", puerta.usuarioId)
    .eq("activo", true)
    .order("nombre", { ascending: true })
    .limit(MAX_FILAS);

  if (busqueda) consulta = consulta.ilike("nombre", `%${busqueda}%`);

  const { data, error } = await consulta;

  if (error) {
    console.error("ERP: no se pudieron leer los productos:", error);
    return NextResponse.json({ error: "No disponible." }, { status: 503, headers: noStore() });
  }

  const productos = ((data ?? []) as unknown as Record<string, unknown>[]).map((p) => {
    const precio = Number(p.precio_venta ?? 0);
    const iva = tasaValida(p.iva);

    return {
      ...p,
      precio_venta: precio,
      iva,
      /** El impuesto contenido en el precio, para no derivarlo en pantalla. */
      iva_monto: ivaIncluido(precio, iva),
      stock_actual: Number(p.stock_actual ?? 0),
      stock_minimo: Number(p.stock_minimo ?? 0),
      /** Que la lista pueda gritar antes de que se acabe. */
      bajo_minimo:
        p.controla_stock === true && Number(p.stock_actual ?? 0) <= Number(p.stock_minimo ?? 0),
    };
  });

  return NextResponse.json({ productos }, { headers: noStore() });
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

  const nombre = String(cuerpo.nombre ?? "").trim().slice(0, 200);
  if (!nombre) {
    return NextResponse.json(
      { error: "El producto necesita un nombre." },
      { status: 400, headers: noStore() },
    );
  }

  const precio = numero(cuerpo.precio_venta);
  if (precio < 0) {
    return NextResponse.json(
      { error: "El precio no puede ser negativo." },
      { status: 400, headers: noStore() },
    );
  }

  const controlaStock = cuerpo.controla_stock === true;
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("eos_erp_productos")
    .insert({
      usuario_id: puerta.usuarioId,
      codigo: String(cuerpo.codigo ?? "").trim().slice(0, 60) || null,
      nombre,
      descripcion: String(cuerpo.descripcion ?? "").trim().slice(0, 2000) || null,
      unidad: String(cuerpo.unidad ?? "unidad").trim().slice(0, 20) || "unidad",
      precio_venta: precio,
      costo: cuerpo.costo === undefined || cuerpo.costo === null ? null : numero(cuerpo.costo),
      moneda: monedaConocida(cuerpo.moneda),
      iva: tasaValida(cuerpo.iva),
      controla_stock: controlaStock,
      // Sin control de stock, el saldo no significa nada: se guarda en cero para
      // que no quede un número viejo confundiendo si algún día se activa.
      stock_actual: controlaStock ? numero(cuerpo.stock_actual) : 0,
      stock_minimo: controlaStock ? numero(cuerpo.stock_minimo) : 0,
    })
    .select(COLUMNAS)
    .single();

  if (error) {
    // El código de producto es único por usuario: repetirlo es un error del
    // usuario, no del sistema, y merece decirlo en castellano.
    if (String(error.code) === "23505") {
      return NextResponse.json(
        { error: "Ya tenés un producto con ese código.", campo: "codigo" },
        { status: 409, headers: noStore() },
      );
    }

    console.error("ERP: no se pudo guardar el producto:", error);
    return NextResponse.json(
      { error: "No pudimos guardar el producto." },
      { status: 503, headers: noStore() },
    );
  }

  return NextResponse.json({ producto: data }, { status: 201, headers: noStore() });
}

function numero(valor: unknown): number {
  const n = Number(valor);
  return Number.isFinite(n) ? n : 0;
}

function noStore() {
  return { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" };
}
