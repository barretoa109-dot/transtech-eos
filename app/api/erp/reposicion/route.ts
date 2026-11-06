import { NextResponse } from "next/server";

import { exigirModulo } from "@/lib/modulos/acceso";
import { adminSinTipos } from "@/lib/supabase/sin-tipos";
import { empresaDe, filtroDeEmpresa } from "@/lib/empresa/acceso";
import { hoyEnParaguay } from "@/lib/fecha";
import {
  proyectarAgotamiento,
  VENTANA_DIAS,
  type ProductoAgotable,
  type SalidaDeStock,
} from "@/lib/erp/agotamiento";

export const dynamic = "force-dynamic";

/**
 * Lo que EOS propone reponer, con cuánto — no solo que algo se está por
 * acabar.
 *
 * Es el "Autonomous Business Operations" del documento EOS 2030 (ítem 14),
 * en su forma más chica y más segura: Nivel 2 de la escala de autonomía que
 * el propio documento propone — "preparar y recomendar" — nunca Nivel 3 o 4.
 * Esta ruta no escribe nada: es una lectura con una cuenta hecha encima.
 *
 * La detección (`proyectarAgotamiento`) ya existía y ya se usaba para el
 * aviso por correo de `stock_por_agotarse`. Lo que no existía en NINGÚN
 * lugar —ni en el correo, ni en el panel: `stock_por_agotarse` no tenía
 * pantalla propia— era CUÁNTO pedir, y un lugar donde verlo sin esperar al
 * cron del día siguiente.
 */
export async function GET() {
  const puerta = await exigirModulo("erp");
  if (puerta.respuesta) return puerta.respuesta;

  const admin = adminSinTipos();
  const empresaId = await empresaDe(admin, puerta.usuarioId);
  const hoy = hoyEnParaguay();
  const desde = new Date(Date.parse(`${hoy}T00:00:00Z`) - VENTANA_DIAS * 86_400_000)
    .toISOString()
    .slice(0, 10);

  const [productosRes, salidasRes] = await Promise.all([
    admin
      .from("eos_erp_productos")
      .select("id,nombre,stock_actual,stock_minimo,controla_stock,activo")
      .or(filtroDeEmpresa(puerta.usuarioId, empresaId))
      .eq("activo", true)
      .eq("controla_stock", true)
      .limit(1000),
    admin
      .from("eos_erp_movimientos_stock")
      .select("producto_id,fecha,cantidad")
      .or(filtroDeEmpresa(puerta.usuarioId, empresaId))
      .eq("tipo", "salida")
      .gte("fecha", desde)
      .limit(5000),
  ]);

  if (productosRes.error) {
    console.error("ERP: no se pudo leer el stock para proponer reposición:", productosRes.error);
    return NextResponse.json({ error: "No pudimos calcular la reposición." }, { status: 503, headers: noStore() });
  }

  if (salidasRes.error) {
    console.error("ERP: no se pudo leer el kardex para proponer reposición:", salidasRes.error);
  }

  const productos: ProductoAgotable[] = (productosRes.data ?? []).map((p: Record<string, unknown>) => ({
    id: String(p.id),
    nombre: String(p.nombre ?? "Producto"),
    stock_actual: Number(p.stock_actual ?? 0),
    stock_minimo: Number(p.stock_minimo ?? 0),
    controla_stock: p.controla_stock === true,
    activo: p.activo !== false,
  }));

  const salidas: SalidaDeStock[] = (salidasRes.data ?? []).map((s: Record<string, unknown>) => ({
    producto_id: String(s.producto_id ?? ""),
    fecha: String(s.fecha ?? ""),
    cantidad: Number(s.cantidad ?? 0),
  }));

  const propuesta = proyectarAgotamiento({ hoy, productos, salidas });

  return NextResponse.json({ propuesta }, { headers: noStore() });
}

function noStore() {
  return { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" };
}
