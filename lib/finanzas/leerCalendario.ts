import { leerTarjetas } from "./leerTarjetas.ts";
import { armarPanorama } from "./panorama.ts";
import { codigoMoneda } from "./monedas.ts";
import type { Deuda } from "./deudas.ts";
import type { Fijo } from "./fijos.ts";
import type { ClienteSinTipos } from "../supabase/sin-tipos.ts";

/**
 * Lo que viene en la plata PERSONAL, entre `hoy` y `hasta`.
 *
 * ============================================================
 * POR QUÉ ESTÁ ACÁ Y NO EN LA RUTA
 * ============================================================
 *
 * Nació dentro de `app/api/finanzas/calendario/route.ts`. Cuando el calendario
 * general de EOS necesitó los mismos vencimientos (alquiler, cuotas, tarjetas),
 * la alternativa a moverlo era copiar las cinco consultas y el armado del
 * panorama. Dos copias de eso se desincronizan: un día el panel financiero
 * diría que el alquiler vence el 5 y el calendario el 6.
 *
 * Es la lectura, sin más. La ruta sigue siendo quien decide el módulo, el
 * formato de respuesta y los encabezados.
 */

export type PanoramaPersonal =
  | { configurado: false }
  | {
      configurado: true;
      moneda: string;
      panorama: ReturnType<typeof armarPanorama>;
    };

export async function leerPanoramaPersonal(
  supabase: ClienteSinTipos,
  usuarioId: string,
  hoy: string,
  hasta: string,
): Promise<PanoramaPersonal> {
  const [politicaRes, movimientosRes, conciliacionesRes, fijosRes, deudasRes] = await Promise.all([
    supabase
      .from("eos_finanzas_politica")
      .select("moneda,saldo_inicial,saldo_inicial_fecha,reserva_minima")
      .eq("usuario_id", usuarioId)
      .maybeSingle(),
    supabase
      .from("eos_movimientos_financieros")
      .select("tipo,monto,fecha,descripcion")
      .eq("usuario_id", usuarioId)
      .eq("ambito", "personal")
      .order("fecha", { ascending: true }),
    supabase
      .from("eos_finanzas_conciliaciones")
      .select("fecha,saldo_declarado")
      .eq("usuario_id", usuarioId),
    supabase
      .from("eos_finanzas_fijos")
      .select("tipo,descripcion,monto,dia_del_mes")
      .eq("usuario_id", usuarioId)
      .eq("ambito", "personal")
      .eq("activo", true),
    supabase
      .from("eos_finanzas_deudas")
      .select("acreedor,tipo,moneda,saldo_declarado,cuota_monto,cuota_dia,cuotas_totales,cuotas_pagadas,estado")
      .eq("ambito", "personal")
      .eq("usuario_id", usuarioId)
      .neq("estado", "saldada"),
  ]);

  const politica = politicaRes.data;

  // Sin Constitución Financiera no hay de dónde partir, y un calendario
  // armado sobre supuestos diría que no viene nada cuando puede venir todo.
  if (!politica) return { configurado: false };

  /*
   * Las tarjetas, en la misma línea de tiempo que todo lo demás.
   *
   * El pago del resumen es lo que SALE del bolsillo; las compras en cuotas ya
   * están adentro de ese pago y no se proyectan aparte. `leerTarjetas` lo
   * resuelve en un solo lugar para las cinco pantallas, y `armarPanorama` las
   * pasa por el mismo filtro de duplicados que las cuotas de deuda.
   */
  const { obligaciones: deTarjetas } = await leerTarjetas(supabase, usuarioId, {
    desde: hoy,
    hasta,
  });

  const panorama = armarPanorama({
    hoy,
    hasta,
    obligacionesTarjeta: deTarjetas,
    saldoInicial: num(politica.saldo_inicial),
    saldoInicialFecha: politica.saldo_inicial_fecha,
    reservaMinima: num(politica.reserva_minima),
    movimientos: ((movimientosRes.data ?? []) as Record<string, unknown>[]).map((m) => ({
      tipo: m.tipo as "ingreso" | "gasto" | "compromiso",
      monto: num(m.monto),
      fecha: m.fecha as string,
      descripcion: (m.descripcion as string | null) ?? null,
    })),
    conciliaciones: ((conciliacionesRes.data ?? []) as Record<string, unknown>[]).map((c) => ({
      fecha: c.fecha as string,
      saldo_declarado: num(c.saldo_declarado),
    })),
    fijos: ((fijosRes.data ?? []) as Record<string, unknown>[]).map<Fijo>((f) => ({
      tipo: f.tipo === "ingreso" ? "ingreso" : "gasto",
      descripcion: f.descripcion as string,
      monto: num(f.monto),
      dia_del_mes: f.dia_del_mes as number,
    })),
    deudas: ((deudasRes.data ?? []) as unknown as Deuda[]).map((d) => ({
      ...d,
      saldo_declarado: num(d.saldo_declarado),
      cuota_monto: d.cuota_monto === null ? null : num(d.cuota_monto),
    })),
  });

  return { configurado: true, moneda: codigoMoneda(politica.moneda, "PYG"), panorama };
}

function num(valor: unknown): number {
  const n = typeof valor === "string" ? Number(valor) : Number(valor ?? 0);
  return Number.isFinite(n) ? n : 0;
}
