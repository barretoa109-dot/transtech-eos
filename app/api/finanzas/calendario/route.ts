import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { hoyEnParaguay, sumarDias } from "@/lib/fecha";
import { armarPanorama } from "@/lib/finanzas/panorama";
import { codigoMoneda } from "@/lib/finanzas/monedas";
import { exigirModulo } from "@/lib/modulos/acceso";
import type { Deuda } from "@/lib/finanzas/deudas";
import type { Fijo } from "@/lib/finanzas/fijos";

export const dynamic = "force-dynamic";

/**
 * Lo que viene, día por día.
 *
 * ============================================================
 * EL MOTOR YA SABÍA TODO ESTO Y NADIE PODÍA VERLO
 * ============================================================
 *
 * `armarPanorama` devuelve, desde hace semanas, cada ingreso y cada egreso
 * previsto con su fecha: los gastos fijos declarados, las series que EOS
 * detectó viéndolas repetirse, las cuotas de cada deuda y los compromisos ya
 * anotados. Es lo que alimenta la curva del saldo y el detector de "el 28 te
 * vas a quedar corto".
 *
 * Pero la curva contesta *cuánto* va a haber, no *qué* va a pasar. Alguien que
 * ve la línea bajar el 25 no sabe si es el alquiler, la tarjeta o la cuota del
 * auto — y esas tres se resuelven de maneras distintas. La lista es lo que
 * convierte un pronóstico en algo sobre lo que se puede actuar.
 *
 * ============================================================
 * TRES HORIZONTES, UNA SOLA LECTURA
 * ============================================================
 *
 * Se calcula a 90 días y se devuelve entero. Los cortes de 7 y 30 los hace la
 * pantalla sobre la misma respuesta: pedirle al servidor tres veces lo mismo
 * para mostrar menos filas sería gastar tres viajes en recortar una lista.
 *
 * ============================================================
 * CADA EVENTO DICE DE DÓNDE SALIÓ
 * ============================================================
 *
 * `fuente` distingue lo anotado —que es un hecho— de lo previsible, que es una
 * deducción de EOS a partir de haberlo visto repetirse. La diferencia importa:
 * un alquiler declarado va a pasar; una serie detectada con poca confianza
 * puede no pasar, y presentar las dos igual convertiría una estimación en un
 * compromiso.
 */

/** 90 días: el horizonte más largo que el usuario pidió ver. */
const DIAS = 90;

export async function GET() {
  // El calendario es parte del panel financiero, que se contrata.
  const puerta = await exigirModulo("dashboard");
  if (puerta.respuesta) return puerta.respuesta;

  const supabase = await createClient();
  const usuarioId = puerta.usuarioId;

  const hoy = hoyEnParaguay();
  const hasta = sumarDias(hoy, DIAS);

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
  if (!politica) {
    return NextResponse.json({ configurado: false }, { headers: noStore() });
  }

  const principal = codigoMoneda(politica.moneda, "PYG");

  const panorama = armarPanorama({
    hoy,
    hasta,
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

  /*
   * Un solo hilo ordenado por fecha, con lo que entra y lo que sale mezclado.
   *
   * Separarlos en dos listas obligaría a la persona a hacer la cuenta que este
   * producto existe para hacerle: si el sueldo llega el 30 y el alquiler vence
   * el 28, lo que importa es ese orden, no que uno sea ingreso y otro egreso.
   */
  const eventos = [
    ...panorama.ingresos.map((i) => ({
      fecha: i.fecha,
      descripcion: i.descripcion,
      monto: i.monto,
      direccion: "entra" as const,
      fuente: "anotado" as const,
      confianza: i.confianza,
    })),
    ...panorama.egresos.map((e) => ({
      fecha: e.fecha,
      descripcion: e.descripcion,
      monto: e.monto,
      direccion: "sale" as const,
      fuente: e.fuente,
      confianza: e.confianza,
    })),
  ].sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0));

  return NextResponse.json(
    {
      configurado: true,
      moneda: principal,
      desde: hoy,
      hasta,
      saldo_actual: panorama.saldoActual,
      reserva_minima: panorama.reservaMinima,
      eventos,
    },
    { headers: noStore() },
  );
}

function num(valor: unknown): number {
  const n = typeof valor === "string" ? Number(valor) : Number(valor ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function noStore() {
  return { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" };
}
