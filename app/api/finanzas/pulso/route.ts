import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { adminSinTipos } from "@/lib/supabase/sin-tipos";
import { hoyEnParaguay, sumarDias } from "@/lib/fecha";
import { armarPanorama, tramoHastaElProximoIngreso } from "@/lib/finanzas/panorama";
import { codigoMoneda } from "@/lib/finanzas/monedas";
import { detectarAnomalias, ordenar, type Anomalia } from "@/lib/kpi/anomalias";
import { calcularScore, explicarCambio, avisoDeCobertura } from "@/lib/kpi/score";
import { exigirModulo } from "@/lib/modulos/acceso";
import { leerTarjetas } from "@/lib/finanzas/leerTarjetas";
import { simularCompra, type Antes } from "@/lib/finanzas/escenarios";
import {
  CON_UMBRALES_PERSONALES,
  DIMENSIONES_PERSONALES,
  indicadoresPersonales,
  type EntradaPulso,
} from "@/lib/finanzas/pulso";
import type { Deuda } from "@/lib/finanzas/deudas";
import type { Fijo } from "@/lib/finanzas/fijos";
import type { PuntoHistoria } from "@/lib/kpi/historia";

export const dynamic = "force-dynamic";

/**
 * "¿Cómo estoy?" y "¿qué cambió?", con la evidencia al lado.
 *
 * ============================================================
 * NO ESTRENA UN MOTOR
 * ============================================================
 *
 * Los hallazgos salen de `lib/kpi/anomalias.ts` y el score de
 * `lib/kpi/score.ts`, los mismos que usa el tablero del negocio. Lo único
 * propio de Personal es `lib/finanzas/pulso.ts`, que traduce su estado a
 * indicadores comparables.
 *
 * Dos motores de "qué es grave" habrían divergido en un mes, y entonces la
 * misma persona vería un criterio en su negocio y otro en su vida.
 *
 * ============================================================
 * LA HISTORIA ES LA QUE YA SE ESCRIBE
 * ============================================================
 *
 * `eos_kpi_historia_v105` guarda una foto diaria por indicador. Hasta la v147
 * solo tenía indicadores del negocio; ahora también los personales, con el
 * prefijo `pers_` que impide confundirlos. De ahí sale "qué cambió", sin
 * recalcular nada con datos de ayer.
 *
 * ============================================================
 * EL POST NO ESCRIBE
 * ============================================================
 *
 * Es un escenario: "¿puedo comprar esto?". Se calcula sobre una copia del
 * estado y no toca la base. Preguntarlo no puede dejar rastro de una compra
 * que nadie hizo.
 */

/** Cuánto se mira hacia atrás para el "qué cambió". */
const DIAS_DE_HISTORIA = 35;

/** Meses completos que se miran para saber cuánto gasta normalmente. */
const MESES_DE_HISTORIA = 6;

/** Horizonte del panorama, igual que el del panel. */
const HORIZONTE_DIAS = 90;

/** Cuántos hallazgos vuelven. Una lista larga es una lista que no se lee. */
const TECHO_HALLAZGOS = 5;

export async function GET() {
  const armado = await armarPulso();
  if ("respuesta" in armado) return armado.respuesta;

  const { entrada, historia, moneda } = armado;

  const resultados = indicadoresPersonales(entrada);

  const hallazgos: Anomalia[] = ordenar(
    detectarAnomalias(
      resultados.map((r) => ({ resultado: r, puntos: historia.get(r.id) })),
    ),
  ).slice(0, TECHO_HALLAZGOS);

  const score = calcularScore(resultados, CON_UMBRALES_PERSONALES, moneda, DIMENSIONES_PERSONALES);

  /*
   * El score de hace un mes, armado con los indicadores de ese día.
   *
   * Se reconstruye desde la historia y no desde un cálculo nuevo: comparar
   * contra algo calculado hoy con la fórmula de hoy sobre datos de ayer daría
   * diferencias que son de la fórmula y no de la plata.
   */
  const deAntes = resultadosDeHace(resultados, historia, DIAS_DE_HISTORIA, entrada.hoy);

  const scoreAntes =
    deAntes === null
      ? null
      : calcularScore(deAntes, CON_UMBRALES_PERSONALES, moneda, DIMENSIONES_PERSONALES);

  return NextResponse.json(
    {
      configurado: true,
      moneda,
      indicadores: resultados,
      hallazgos,
      salud: {
        ...score,
        aviso: avisoDeCobertura(score, "de tu situación"),
        cambio: scoreAntes === null ? [] : explicarCambio(score, scoreAntes),
        antes: scoreAntes?.puntaje ?? null,
      },
    },
    { headers: noStore() },
  );
}

/** "¿Puedo comprar esto?" — no escribe nada. */
export async function POST(request: Request) {
  const armado = await armarPulso();
  if ("respuesta" in armado) return armado.respuesta;

  let body: { monto?: unknown; cuotas?: unknown };
  try {
    body = (await request.json()) as { monto?: unknown; cuotas?: unknown };
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido." }, { status: 400, headers: noStore() });
  }

  const monto = Number(body.monto);
  if (!Number.isFinite(monto) || monto <= 0) {
    return NextResponse.json(
      { error: "Decime cuánto querés gastar." },
      { status: 400, headers: noStore() },
    );
  }

  const cuotasCrudas = Number(body.cuotas);
  const cuotas = Number.isFinite(cuotasCrudas) ? Math.min(60, Math.max(1, Math.round(cuotasCrudas))) : 1;

  return NextResponse.json(
    {
      escenario: simularCompra({
        hoy: armado.entrada.hoy,
        antes: armado.antes,
        monto,
        cuotas,
        margenMensual: armado.margenMensual,
      }),
    },
    { headers: noStore() },
  );
}

/**
 * Todo lo que hace falta para contestar las dos preguntas, leído una vez.
 *
 * El GET y el POST parten del MISMO estado: si cada uno lo armara por su lado,
 * el escenario podría decir "entra" sobre un disponible distinto del que la
 * pantalla acaba de mostrar.
 */
async function armarPulso(): Promise<
  | { respuesta: NextResponse }
  | {
      entrada: EntradaPulso;
      historia: Map<string, PuntoHistoria[]>;
      moneda: string;
      antes: Antes;
      margenMensual: number | null;
    }
> {
  const puerta = await exigirModulo("dashboard");
  if (puerta.respuesta) return { respuesta: puerta.respuesta };

  const supabase = await createClient();
  const usuarioId = puerta.usuarioId;

  const hoy = hoyEnParaguay();
  const hasta = sumarDias(hoy, HORIZONTE_DIAS);
  const inicioDelMes = `${hoy.slice(0, 7)}-01`;
  const [anio, mes] = hoy.split("-").map(Number);
  const desdeHistoria = `${new Date(Date.UTC(anio, mes - 1 - MESES_DE_HISTORIA, 1)).toISOString().slice(0, 7)}-01`;

  const [politicaRes, movimientosRes, conciliacionesRes, fijosRes, deudasRes, objetivosRes, lectura] =
    await Promise.all([
      supabase
        .from("eos_finanzas_politica")
        .select("moneda,saldo_inicial,saldo_inicial_fecha,reserva_minima,porcentaje_ahorro")
        .eq("usuario_id", usuarioId)
        .maybeSingle(),
      supabase
        .from("eos_movimientos_financieros")
        .select("tipo,monto,fecha,descripcion")
        .eq("ambito", "personal")
        .eq("usuario_id", usuarioId)
        .gte("fecha", desdeHistoria)
        .order("fecha", { ascending: true }),
      supabase
        .from("eos_finanzas_conciliaciones")
        .select("fecha,saldo_declarado")
        .eq("usuario_id", usuarioId),
      supabase
        .from("eos_finanzas_fijos")
        .select("tipo,descripcion,monto,dia_del_mes")
        .eq("ambito", "personal")
        .eq("usuario_id", usuarioId)
        .eq("activo", true),
      supabase
        .from("eos_finanzas_deudas")
        .select("acreedor,tipo,moneda,saldo_declarado,cuota_monto,cuota_dia,cuotas_totales,cuotas_pagadas,estado")
        .eq("ambito", "personal")
        .eq("usuario_id", usuarioId)
        .neq("estado", "saldada"),
      supabase
        .from("eos_goals")
        .select("valor_objetivo,valor_actual,fecha_limite,estado,tipo_medicion,meses_cobertura,clase")
        .eq("ambito", "personal")
        .eq("usuario_id", usuarioId)
        .eq("estado", "activo"),
      leerTarjetas(supabase, usuarioId, { desde: hoy, hasta }),
    ]);

  const politica = politicaRes.data;
  if (!politica) {
    return { respuesta: NextResponse.json({ configurado: false }, { headers: noStore() }) };
  }

  const moneda = codigoMoneda(politica.moneda, "PYG");

  const movimientos = filas(movimientosRes.data).map((m) => ({
    tipo: m.tipo as "ingreso" | "gasto" | "compromiso",
    monto: num(m.monto),
    fecha: m.fecha as string,
    descripcion: (m.descripcion as string | null) ?? null,
  }));

  const deudas = (filas(deudasRes.data) as unknown as Deuda[]).map((d) => ({
    ...d,
    saldo_declarado: num(d.saldo_declarado),
    cuota_monto: d.cuota_monto === null ? null : num(d.cuota_monto),
  }));

  const panorama = armarPanorama({
    hoy,
    hasta,
    saldoInicial: num(politica.saldo_inicial),
    saldoInicialFecha: politica.saldo_inicial_fecha,
    reservaMinima: num(politica.reserva_minima),
    movimientos,
    conciliaciones: filas(conciliacionesRes.data).map((c) => ({
      fecha: c.fecha as string,
      saldo_declarado: num(c.saldo_declarado),
    })),
    fijos: filas(fijosRes.data).map<Fijo>((f) => ({
      tipo: f.tipo === "ingreso" ? "ingreso" : "gasto",
      descripcion: f.descripcion as string,
      monto: num(f.monto),
      dia_del_mes: f.dia_del_mes as number,
    })),
    deudas,
    obligacionesTarjeta: lectura.obligaciones,
  });

  // El mismo tramo que usa el panel, calculado por la misma función: dos
  // horizontes distintos darían dos disponibles distintos sobre la misma plata.
  const tramo = tramoHastaElProximoIngreso(panorama, hoy);
  const { proximoIngreso, total: comprometido } = tramo;

  const ingresoDelMes = movimientos
    .filter((m) => m.tipo === "ingreso" && m.fecha >= inicioDelMes && m.fecha <= hoy)
    .reduce((t, m) => t + m.monto, 0);

  const gastoDelMes = movimientos
    .filter((m) => m.tipo === "gasto" && m.fecha >= inicioDelMes && m.fecha <= hoy)
    .reduce((t, m) => t + m.monto, 0);

  const ahorroComprometido = (ingresoDelMes * num(politica.porcentaje_ahorro)) / 100;
  const reserva = num(politica.reserva_minima);
  const disponibleReal = panorama.saldoActual - comprometido - reserva - ahorroComprometido;

  const gastoHabitual = medianaDeMeses(movimientos, inicioDelMes);

  /*
   * Lo que los objetivos piden por mes.
   *
   * Se calcula acá con la aritmética mínima —lo que falta sobre los meses que
   * quedan— y no llamando a `/api/finanzas/objetivos`: una ruta que llama a
   * otra ruta duplica la sesión, el módulo y la lectura entera.
   */
  const objetivos = filas(objetivosRes.data);
  const aporteObjetivos = objetivos
    .filter((g) => g.tipo_medicion === "monetario" && num(g.valor_objetivo) > 0 && g.fecha_limite)
    .reduce((t, g) => {
      const falta = Math.max(0, num(g.valor_objetivo) - num(g.valor_actual));
      const meses = Math.max(1, mesesHasta(hoy, g.fecha_limite as string));
      return t + falta / meses;
    }, 0);

  const fondo = objetivos.find((g) => g.clase === "fondo_emergencia");
  const gastoEsencial = gastoHabitual;

  const mesesCubiertos =
    fondo && gastoEsencial !== null && gastoEsencial > 0
      ? Math.round((num(fondo.valor_actual) / gastoEsencial) * 100) / 100
      : null;

  const historia = await leerHistoriaPersonal(usuarioId, hoy);

  return {
    moneda,
    historia,
    margenMensual:
      gastoHabitual === null ? null : Math.max(0, ingresoDelMes - gastoHabitual - ahorroComprometido),
    entrada: {
      hoy,
      moneda,
      periodo: { desde: inicioDelMes, hasta: hoy },
      disponibleReal: redondear(disponibleReal),
      gastoHabitualMensual: gastoHabitual,
      gastoDelMes: redondear(gastoDelMes),
      ingresoDelMes: redondear(ingresoDelMes),
      deudaTotal: redondear(deudas.reduce((t, d) => t + d.saldo_declarado, 0)),
      // Las cuotas de deuda MÁS lo que pagan las tarjetas por mes. Sin las
      // tarjetas, la carga de deuda de quien vive de la tarjeta daría cero.
      cuotasMensuales: redondear(
        deudas.reduce((t, d) => t + (d.cuota_monto ?? 0), 0) +
          lectura.tarjetas.reduce((t, x) => t + (x.a_pagar ?? 0), 0),
      ),
      porcentajeAhorroDeclarado: num(politica.porcentaje_ahorro),
      mesesCubiertos,
      mesesElegidos: fondo?.meses_cobertura === undefined ? null : Number(fondo.meses_cobertura),
      utilizacionMaxima:
        lectura.tarjetas.length === 0
          ? null
          : Math.max(...lectura.tarjetas.map((x) => x.utilizacion ?? 0)) || null,
    } satisfies EntradaPulso,
    antes: {
      moneda,
      disponible_real: redondear(disponibleReal),
      saldo: redondear(panorama.saldoActual),
      reserva,
      comprometido: redondear(comprometido),
      proximo_ingreso: proximoIngreso
        ? { fecha: proximoIngreso.fecha, monto: proximoIngreso.monto }
        : null,
      aporte_objetivos: redondear(aporteObjetivos),
    },
  };
}

/** La serie de cada indicador personal, del más viejo al más nuevo. */
async function leerHistoriaPersonal(
  usuarioId: string,
  hoy: string,
): Promise<Map<string, PuntoHistoria[]>> {
  const admin = adminSinTipos();

  const { data } = await admin
    .from("eos_kpi_historia_v105")
    .select("indicador,fecha,valor,estado,confianza,motivo")
    .eq("usuario_id", usuarioId)
    .like("indicador", "pers_%")
    .gte("fecha", sumarDias(hoy, -DIAS_DE_HISTORIA))
    .order("fecha", { ascending: true });

  const porIndicador = new Map<string, PuntoHistoria[]>();

  for (const fila of filas(data)) {
    const id = fila.indicador as string;
    const lista = porIndicador.get(id) ?? [];
    lista.push({
      fecha: fila.fecha as string,
      valor: fila.valor === null ? null : num(fila.valor),
      estado: fila.estado as PuntoHistoria["estado"],
      confianza: num(fila.confianza),
      motivo: (fila.motivo as string | null) ?? null,
    });
    porIndicador.set(id, lista);
  }

  return porIndicador;
}

/**
 * Los mismos indicadores, con el valor que tenían hace N días.
 *
 * `null` cuando la historia no llega tan atrás: es preferible no mostrar el
 * cambio a mostrar uno contra un día que no existe.
 */
function resultadosDeHace(
  actuales: ReturnType<typeof indicadoresPersonales>,
  historia: Map<string, PuntoHistoria[]>,
  dias: number,
  hoy: string,
): ReturnType<typeof indicadoresPersonales> | null {
  const objetivo = sumarDias(hoy, -dias);
  let encontrados = 0;

  const deAntes = actuales.map((r) => {
    // El punto más cercano al día buscado que no sea posterior a él.
    const puntos = (historia.get(r.id) ?? []).filter((p) => p.fecha <= objetivo);
    const punto = puntos[puntos.length - 1];

    if (!punto) return { ...r, valor: null, estado: "sin_datos" as const };

    encontrados += 1;

    // El estado de ESE día, no el que daría recalcularlo con los umbrales de
    // hoy: si la persona cambió su porcentaje de ahorro, la mejora sería del
    // umbral y no de su plata. Sin estado guardado no se puntúa.
    return {
      ...r,
      valor: punto.valor,
      estado: punto.estado ?? "sin_datos",
      confianza: { nivel: punto.confianza, motivos: [] },
    };
  });

  return encontrados === 0 ? null : deAntes;
}

/** La mediana de gasto de los meses anteriores completos. */
function medianaDeMeses(
  movimientos: { tipo: string; monto: number; fecha: string }[],
  inicioDelMes: string,
): number | null {
  const porMes = new Map<string, number>();

  for (const m of movimientos) {
    if (m.tipo !== "gasto" || m.fecha >= inicioDelMes) continue;
    const clave = m.fecha.slice(0, 7);
    porMes.set(clave, (porMes.get(clave) ?? 0) + m.monto);
  }

  const valores = [...porMes.values()].sort((a, b) => a - b);
  if (valores.length === 0) return null;

  const medio = Math.floor(valores.length / 2);
  return valores.length % 2 === 1
    ? valores[medio]
    : redondear((valores[medio - 1] + valores[medio]) / 2);
}

function mesesHasta(desde: string, hasta: string): number {
  const [a1, m1] = desde.split("-").map(Number);
  const [a2, m2] = hasta.split("-").map(Number);
  return (a2 - a1) * 12 + (m2 - m1) + 1;
}

function filas(data: unknown): Record<string, unknown>[] {
  return (data ?? []) as Record<string, unknown>[];
}

function num(valor: unknown): number {
  const n = typeof valor === "string" ? Number(valor) : Number(valor ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function redondear(valor: number): number {
  return Number.isFinite(valor) ? Math.round(valor * 100) / 100 : 0;
}

function noStore() {
  return { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" };
}
