import { NextResponse } from "next/server";

import { exigirModulo } from "@/lib/modulos/acceso";
import { adminSinTipos } from "@/lib/supabase/sin-tipos";
import { empresaDe, filtroDeEmpresa } from "@/lib/empresa/acceso";
import { hoyEnParaguay } from "@/lib/fecha";
import { monedaConocida } from "@/lib/finanzas/monedas";
import {
  costoDeLoVendido,
  diasDeInventario,
  inventarioPromedio,
  rotacion,
  stockQuieto,
  valorInventario,
  type MovimientoKardex,
  type ProductoStock,
} from "@/lib/erp/kardex";

export const dynamic = "force-dynamic";

/**
 * El inventario valorizado, y qué no se mueve.
 *
 * Los indicadores de rotación ya salen por `GET /api/kpi` y se ven en el
 * panel. Lo que esta ruta agrega es la parte accionable, que un número no
 * puede dar: CUÁLES productos están quietos y cuánta plata tienen adentro.
 *
 * La aritmética es la misma de `lib/erp/kardex.ts` que usa el motor de KPIs.
 * Si esto calculara por su cuenta, la pantalla y el panel podrían mostrar dos
 * rotaciones distintas del mismo mes.
 */

const DIAS = 90;

export async function GET() {
  const puerta = await exigirModulo("erp");
  if (puerta.respuesta) return puerta.respuesta;

  const admin = adminSinTipos();
  // Las dos fronteras mientras dure la transición de la v109/v110.
  const empresaId = await empresaDe(admin, puerta.usuarioId);
  const hasta = hoyEnParaguay();
  const desde = new Date(Date.parse(`${hasta}T00:00:00Z`) - DIAS * 86_400_000)
    .toISOString()
    .slice(0, 10);

  const [productosRes, kardexRes] = await Promise.all([
    admin
      .from("eos_erp_productos")
      .select("id,nombre,moneda,activo,controla_stock,stock_actual,costo_promedio")
      .or(filtroDeEmpresa(puerta.usuarioId, empresaId))
      .limit(1000),
    // Sin filtro de fecha: la rotación necesita el valor del inventario
    // ANTERIOR al período, que vive en el último movimiento previo.
    admin
      .from("eos_erp_movimientos_stock")
      .select("fecha,tipo,cantidad,costo_unitario,valor_resultante,producto_id")
      .or(filtroDeEmpresa(puerta.usuarioId, empresaId))
      .order("fecha", { ascending: false })
      .limit(5000),
  ]);

  if (productosRes.error) {
    console.error("ERP: no se pudo leer el inventario:", productosRes.error);
    return NextResponse.json(
      { error: "No pudimos leer tu inventario." },
      { status: 503, headers: noStore() },
    );
  }

  const productos: ProductoStock[] = (productosRes.data ?? []).map((p: Record<string, unknown>) => ({
    id: String(p.id),
    nombre: String(p.nombre ?? "Producto"),
    moneda: monedaConocida(p.moneda as string | null),
    stock_actual: Number(p.stock_actual ?? 0),
    costo_promedio:
      p.costo_promedio === null || p.costo_promedio === undefined ? null : Number(p.costo_promedio),
    activo: p.activo !== false,
    controla_stock: p.controla_stock === true,
  }));

  const monedaDe = new Map(productos.map((p) => [p.id, p.moneda]));

  // El kardex es un extra: sin él se puede valorizar igual, solo que no se
  // puede calcular rotación. Se registra y se sigue.
  if (kardexRes.error) {
    console.error("ERP: no se pudo leer el kardex:", kardexRes.error);
  }

  const movimientos: MovimientoKardex[] = (kardexRes.data ?? []).map(
    (m: Record<string, unknown>) => ({
      fecha: String(m.fecha ?? ""),
      tipo: m.tipo === "entrada" ? "entrada" : m.tipo === "salida" ? "salida" : "ajuste",
      cantidad: Number(m.cantidad ?? 0),
      costo_unitario:
        m.costo_unitario === null || m.costo_unitario === undefined ? null : Number(m.costo_unitario),
      valor_resultante:
        m.valor_resultante === null || m.valor_resultante === undefined
          ? null
          : Number(m.valor_resultante),
      producto_id: String(m.producto_id ?? ""),
      moneda: monedaDe.get(String(m.producto_id ?? "")) ?? "PYG",
    }),
  );

  const valores = valorInventario(productos);

  return NextResponse.json(
    {
      periodo: { desde, hasta, dias: DIAS },
      monedas: valores.map((v) => {
        const costo = costoDeLoVendido(movimientos, v.moneda, desde, hasta);
        const promedio = inventarioPromedio(movimientos, v.moneda, desde, hasta, v.valor);
        const rot = rotacion(costo, promedio);

        return {
          ...v,
          rotacion: rot,
          dias_inventario: diasDeInventario(rot, DIAS),
          // Cuando la rotación no se puede calcular, se dice por qué en vez de
          // dejar un guion mudo que nadie sabe cómo resolver.
          falta_rotacion:
            rot !== null
              ? null
              : costo === null
                ? "Todavía no hubo salidas de stock con costo conocido en estos 90 días."
                : "Falta el valor del inventario al inicio del período: el kardex arrancó después.",
          quietos: stockQuieto(productos, movimientos, desde, hasta, v.moneda).slice(0, 20),
        };
      }),
    },
    { headers: noStore() },
  );
}

function noStore() {
  return { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" };
}
