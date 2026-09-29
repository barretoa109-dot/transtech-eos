import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { exigirModulo } from "@/lib/modulos/acceso";
import { adminSinTipos } from "@/lib/supabase/sin-tipos";
import { empresaDe, filtroDeEmpresa } from "@/lib/empresa/acceso";
import { esFechaISOValida, hoyEnParaguay } from "@/lib/fecha";
import { armarLibro } from "@/lib/erp/libro-contador";
import { crearExcelContador } from "@/lib/erp/libro-contador-excel";

export const dynamic = "force-dynamic";

/**
 * El Excel para el contador (negocio-03 del tablero de lanzamiento).
 *
 *   GET /api/erp/libro-contador?desde=2026-09-01&hasta=2026-09-30
 *
 * Sin fechas, el mes pasado entero: es lo que el contador pide a principio de
 * mes. Lee con la sesión de la persona (RLS) y el filtro de su empresa, igual
 * que la pantalla de Ventas: el archivo nunca puede traer algo que la pantalla
 * no muestra. La cuenta la hace `lib/erp/libro-contador.ts`.
 */

const MAX_DIAS = 370;
const LIMITE = 5000;

function mesPasado(hoy: string): { desde: string; hasta: string } {
  const [a, m] = hoy.split("-").map(Number);
  const inicio = new Date(Date.UTC(a, m - 2, 1));
  const fin = new Date(Date.UTC(a, m - 1, 0));
  return { desde: inicio.toISOString().slice(0, 10), hasta: fin.toISOString().slice(0, 10) };
}

export async function GET(request: Request) {
  const puerta = await exigirModulo("erp");
  if (puerta.respuesta) return puerta.respuesta;

  const { searchParams } = new URL(request.url);
  const defecto = mesPasado(hoyEnParaguay());
  const desdeP = searchParams.get("desde");
  const hastaP = searchParams.get("hasta");
  const desde = desdeP && esFechaISOValida(desdeP) ? desdeP : defecto.desde;
  const hasta = hastaP && esFechaISOValida(hastaP) ? hastaP : defecto.hasta;

  const dias = (Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / 86_400_000;
  if (dias < 0 || dias > MAX_DIAS) {
    return NextResponse.json({ error: "Elegí un período de hasta un año." }, { status: 400, headers: noStore() });
  }

  const supabase = await createClient();
  const empresaId = await empresaDe(adminSinTipos(), puerta.usuarioId);
  const filtro = filtroDeEmpresa(puerta.usuarioId, empresaId);

  const [ventas, compras, movimientos] = await Promise.all([
    supabase
      .from("eos_erp_ventas")
      .select("id,fecha,moneda,condicion,estado,total,contacto:eos_crm_contactos(nombre,ruc,ruc_dv),items:eos_erp_venta_items(iva,total)")
      .or(filtro)
      .gte("fecha", desde)
      .lte("fecha", hasta)
      .limit(LIMITE),
    supabase
      .from("eos_erp_compras")
      .select(
        "id,fecha,moneda,condicion,estado,total,numero_comprobante,contacto:eos_crm_contactos(nombre,ruc,ruc_dv),items:eos_erp_compra_items(iva,total)",
      )
      .or(filtro)
      .gte("fecha", desde)
      .lte("fecha", hasta)
      .limit(LIMITE),
    /*
     * Los cobros y pagos de ventas y compras a crédito: pueden ser de un
     * documento de ANTES del período, así que se traen todos los del período
     * y el nombre del contacto sale del documento cuando está en el libro.
     */
    supabase
      .from("eos_erp_cuenta_movimientos_v107")
      .select("fecha,monto,moneda,venta_id,compra_id,nota")
      .or(filtro)
      .gte("fecha", desde)
      .lte("fecha", hasta)
      .limit(LIMITE),
  ]);

  const error = ventas.error || compras.error || movimientos.error;
  if (error) {
    console.error("Libro del contador: no se pudo leer:", error);
    return NextResponse.json({ error: "No disponible." }, { status: 503, headers: noStore() });
  }

  const { data: perfil } = await supabase.from("usuarios").select("nombre").eq("id", puerta.usuarioId).maybeSingle();
  const negocio = (perfil?.nombre as string | null)?.trim() || "Mi negocio";

  const libro = armarLibro({
    desde,
    hasta,
    ventas: (ventas.data ?? []) as never,
    compras: (compras.data ?? []) as never,
    movimientos: (movimientos.data ?? []) as never,
  });

  const cuerpo = Buffer.from(await crearExcelContador(libro, negocio));
  const nombre = `libro-contador-${desde}-a-${hasta}.xlsx`;

  return new Response(new Uint8Array(cuerpo), {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Length": String(cuerpo.length),
      "Content-Disposition": `attachment; filename="${nombre}"`,
      "Cache-Control": "private, no-store, max-age=0",
      Vary: "Cookie",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function noStore() {
  return { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" };
}
