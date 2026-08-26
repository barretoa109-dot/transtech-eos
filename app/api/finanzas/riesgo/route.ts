import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { hoyEnParaguay, sumarDias } from "@/lib/fecha";
import { armarPanorama } from "@/lib/finanzas/panorama";
import { codigoMoneda } from "@/lib/finanzas/monedas";
import { detectarRiesgo, redactarAviso } from "@/lib/finanzas/riesgo";
import { trazarTrayectoria } from "@/lib/finanzas/trayectoria";
import type { Deuda } from "@/lib/finanzas/deudas";
import type { Fijo } from "@/lib/finanzas/fijos";

export const dynamic = "force-dynamic";

/** Ventana de aviso: más lejos que esto todavía no es un problema. */
const HORIZONTE_DIAS = 45;

/**
 * ¿Se viene un aprieto?
 *
 * Devuelve `{ riesgo: null }` la mayoría de los días, y eso es el éxito, no la
 * falta de resultado: la fase 3 de la hoja de ruta pide que EOS avise antes de
 * que el problema exista, no que encuentre problemas.
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Sesión no válida." }, { status: 401, headers: noStore() });
  }

  const hoy = hoyEnParaguay();
  const hasta = sumarDias(hoy, HORIZONTE_DIAS);

  const [politicaRes, movimientosRes, conciliacionesRes, fijosRes, deudasRes] = await Promise.all([
    supabase
      .from("eos_finanzas_politica")
      .select("moneda,saldo_inicial,saldo_inicial_fecha,reserva_minima")
      .eq("usuario_id", user.id)
      .maybeSingle(),
    supabase
      .from("eos_movimientos_financieros")
      .select("tipo,monto,moneda,fecha,descripcion")
      .eq("usuario_id", user.id)
      .order("fecha", { ascending: true }),
    supabase
      .from("eos_finanzas_conciliaciones")
      .select("fecha,saldo_declarado")
      .eq("usuario_id", user.id)
      .order("fecha", { ascending: true }),
    supabase
      .from("eos_finanzas_fijos")
      .select("tipo,descripcion,monto,moneda,dia_del_mes")
      .eq("usuario_id", user.id)
      .eq("activo", true),
    supabase
      .from("eos_finanzas_deudas")
      .select(
        "acreedor,tipo,moneda,saldo_declarado,saldo_declarado_el,cuota_monto,cuota_dia,cuotas_totales,cuotas_pagadas,vence_el,estado,preocupa",
      )
      .eq("usuario_id", user.id)
      .neq("estado", "saldada"),
  ]);

  const politica = politicaRes.data as {
    moneda: string;
    saldo_inicial: number | string;
    saldo_inicial_fecha: string;
    reserva_minima: number | string;
  } | null;

  // Sin Constitución Financiera no hay punto de partida. EOS no inventa un
  // saldo para poder alarmar: informa que todavía no está configurado.
  if (!politica) {
    return NextResponse.json({ configurado: false, riesgo: null }, { headers: noStore() });
  }

  /*
   * El aviso mira SOLO la moneda principal.
   *
   * Antes miraba todo junto: los dólares del ahorro entraban al mismo saldo
   * que los guaraníes del día a día, y el aviso podía decir "te alcanza"
   * porque el faltante en guaraníes quedaba tapado por dólares que no se van a
   * vender. Es el mismo error que tenía el panel y por el que el panel y la
   * alerta daban números distintos sobre la misma plata.
   *
   * Que sea solo la principal y no una alerta por moneda es una decisión de
   * alcance: el aprieto que EOS avisa es el de la plata con la que se vive.
   * Una alerta por cada moneda necesita además su propia deduplicación, y sin
   * eso serían tres sustos por el mismo mes.
   */
  const principal = codigoMoneda(politica.moneda, "PYG");
  const deLaPrincipal = <T extends { moneda?: string | null }>(filas: T[]) =>
    filas.filter((f) => codigoMoneda(f.moneda, principal) === principal);

  const panorama = armarPanorama({
    hoy,
    hasta,
    saldoInicial: num(politica.saldo_inicial),
    saldoInicialFecha: politica.saldo_inicial_fecha,
    reservaMinima: num(politica.reserva_minima),
    movimientos: deLaPrincipal((movimientosRes.data ?? []) as Fila[]).map((m) => ({
      tipo: m.tipo as "ingreso" | "gasto" | "compromiso",
      monto: num(m.monto),
      fecha: m.fecha,
      descripcion: m.descripcion,
    })),
    conciliaciones: ((conciliacionesRes.data ?? []) as { fecha: string; saldo_declarado: number | string }[]).map(
      (c) => ({ fecha: c.fecha, saldo_declarado: num(c.saldo_declarado) }),
    ),
    fijos: deLaPrincipal((fijosRes.data ?? []) as FilaFijo[]).map<Fijo>((f) => ({
      tipo: f.tipo === "ingreso" ? "ingreso" : "gasto",
      descripcion: f.descripcion,
      monto: num(f.monto),
      dia_del_mes: f.dia_del_mes,
    })),
    deudas: deLaPrincipal((deudasRes.data ?? []) as unknown as Deuda[]).map((d) => ({
      ...d,
      saldo_declarado: num(d.saldo_declarado),
      cuota_monto: d.cuota_monto === null ? null : num(d.cuota_monto),
    })),
  });

  const riesgo = detectarRiesgo({
    hoy,
    saldoActual: panorama.saldoActual,
    reservaMinima: panorama.reservaMinima,
    egresos: panorama.egresos,
    ingresos: panorama.ingresos,
  });

  const trayectoria = trazarTrayectoria({
    hoy,
    hasta,
    saldoActual: panorama.saldoActual,
    reservaMinima: panorama.reservaMinima,
    egresos: panorama.egresos,
    ingresos: panorama.ingresos,
  });

  return NextResponse.json(
    {
      configurado: true,
      moneda: principal,
      riesgo,
      aviso: riesgo ? redactarAviso(riesgo, principal) : null,
      trayectoria,
      // Sirve para que la interfaz pueda decir "miré los próximos 45 días" en
      // vez de dejar al usuario adivinando qué tan lejos alcanza la promesa.
      horizonte: { desde: hoy, hasta },
    },
    { headers: noStore() },
  );
}

type Fila = {
  tipo: string;
  monto: number | string;
  moneda: string | null;
  fecha: string;
  descripcion: string | null;
};
type FilaFijo = {
  tipo: string;
  descripcion: string;
  monto: number | string;
  moneda: string | null;
  dia_del_mes: number;
};

function num(valor: number | string | null | undefined): number {
  const n = typeof valor === "string" ? Number(valor) : (valor ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function noStore() {
  return { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" };
}
