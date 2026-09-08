import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { hoyEnParaguay, sumarDias } from "@/lib/fecha";
import { armarPanorama } from "@/lib/finanzas/panorama";
import { armarPresupuesto, diasDelMes, type Obligacion } from "@/lib/finanzas/presupuesto";
import { codigoMoneda } from "@/lib/finanzas/monedas";
import { exigirModulo } from "@/lib/modulos/acceso";
import type { Deuda } from "@/lib/finanzas/deudas";
import type { Fijo } from "@/lib/finanzas/fijos";

export const dynamic = "force-dynamic";

/**
 * El presupuesto del mes, armado por EOS con lo que ya sabe.
 *
 * ============================================================
 * DE DÓNDE SALE CADA LÍNEA
 * ============================================================
 *
 *   · Ingreso esperado: lo que `armarPanorama` proyecta que entra este mes —
 *     los fijos de tipo ingreso y las series de ingreso que EOS detectó.
 *   · Obligaciones: los fijos de gasto y las cuotas de deuda que vencen antes
 *     de fin de mes, del mismo panorama.
 *   · Ahorro: el porcentaje que la persona declaró en su Constitución.
 *   · Hábito: la mediana de lo gastado en los meses anteriores completos.
 *
 * Ninguna de las cuatro se la pedimos al usuario en un formulario. Ésa es toda
 * la idea.
 *
 * ============================================================
 * SEIS MESES HACIA ATRÁS
 * ============================================================
 *
 * Suficiente para que la mediana describa un mes típico y corto como para que
 * un cambio real de vida —una mudanza, un sueldo nuevo— se refleje en un par
 * de meses en vez de quedar diluido en un año de historia vieja.
 */

/** Meses completos hacia atrás que se miran para saber cuánto gasta. */
const MESES_DE_HISTORIA = 6;

export async function GET() {
  const puerta = await exigirModulo("dashboard");
  if (puerta.respuesta) return puerta.respuesta;

  const supabase = await createClient();
  const usuarioId = puerta.usuarioId;

  const hoy = hoyEnParaguay();
  const { restantes } = diasDelMes(hoy);
  const finDeMes = sumarDias(hoy, restantes);
  const [anio, mes] = hoy.split("-").map(Number);
  const inicioDelMes = `${hoy.slice(0, 7)}-01`;
  const desdeHistoria = `${new Date(Date.UTC(anio, mes - 1 - MESES_DE_HISTORIA, 1)).toISOString().slice(0, 7)}-01`;

  const [politicaRes, movimientosRes, conciliacionesRes, fijosRes, deudasRes] = await Promise.all([
    supabase
      .from("eos_finanzas_politica")
      .select("moneda,saldo_inicial,saldo_inicial_fecha,reserva_minima,porcentaje_ahorro")
      .eq("usuario_id", usuarioId)
      .maybeSingle(),
    supabase
      .from("eos_movimientos_financieros")
      .select("tipo,monto,fecha,descripcion")
      .eq("usuario_id", usuarioId)
      .eq("ambito", "personal")
      .gte("fecha", desdeHistoria)
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

  if (!politica) {
    return NextResponse.json({ configurado: false }, { headers: noStore() });
  }

  const principal = codigoMoneda(politica.moneda, "PYG");

  const movimientos = ((movimientosRes.data ?? []) as Record<string, unknown>[]).map((m) => ({
    tipo: m.tipo as "ingreso" | "gasto" | "compromiso",
    monto: num(m.monto),
    fecha: m.fecha as string,
    descripcion: (m.descripcion as string | null) ?? null,
  }));

  const panorama = armarPanorama({
    hoy,
    hasta: finDeMes,
    saldoInicial: num(politica.saldo_inicial),
    saldoInicialFecha: politica.saldo_inicial_fecha,
    reservaMinima: num(politica.reserva_minima),
    movimientos,
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

  /*
   * El ingreso del mes: lo ya cobrado más lo que falta cobrar.
   *
   * El panorama solo proyecta hacia adelante, así que el sueldo que entró el 5
   * no está en `panorama.ingresos` el día 15. Sumar solo la proyección diría
   * que esa persona cobra cero justo después de haber cobrado.
   */
  const yaCobrado = movimientos
    .filter((m) => m.tipo === "ingreso" && m.fecha >= inicioDelMes && m.fecha <= hoy)
    .reduce((t, m) => t + m.monto, 0);

  const porCobrar = panorama.ingresos.reduce((t, i) => t + i.monto, 0);

  const obligaciones: Obligacion[] = panorama.egresos
    .filter((e) => e.fuente !== "anotado")
    .map((e) => ({ descripcion: e.descripcion, monto: e.monto }));

  const gastosDelMes = movimientos
    .filter((m) => m.tipo === "gasto" && m.fecha >= inicioDelMes && m.fecha <= hoy)
    .map((m) => m.monto);

  const presupuesto = armarPresupuesto({
    hoy,
    ingresoEsperado: yaCobrado + porCobrar,
    obligaciones,
    porcentajeAhorro: num(politica.porcentaje_ahorro),
    gastosDelMes,
    totalesPorMes: totalesDeMesesCompletos(movimientos, inicioDelMes),
  });

  return NextResponse.json(
    { configurado: true, moneda: principal, mes: hoy.slice(0, 7), presupuesto },
    { headers: noStore() },
  );
}

/**
 * Lo gastado en cada mes anterior COMPLETO.
 *
 * El mes en curso queda afuera a propósito: si entrara, un día 3 con poco
 * gastado bajaría el hábito y haría creer que esa persona gasta menos de lo
 * que gasta, justo cuando se lo compara contra su presupuesto.
 */
function totalesDeMesesCompletos(
  movimientos: { tipo: string; monto: number; fecha: string }[],
  inicioDelMes: string,
): number[] {
  const porMes = new Map<string, number>();

  for (const m of movimientos) {
    if (m.tipo !== "gasto" || m.fecha >= inicioDelMes) continue;
    const clave = m.fecha.slice(0, 7);
    porMes.set(clave, (porMes.get(clave) ?? 0) + m.monto);
  }

  return [...porMes.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([, total]) => total);
}

function num(valor: unknown): number {
  const n = typeof valor === "string" ? Number(valor) : Number(valor ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function noStore() {
  return { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" };
}
