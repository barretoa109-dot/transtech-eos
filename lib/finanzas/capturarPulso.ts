import { filaDesdeResultado, type FilaHistoria } from "../kpi/historia.ts";
import { armarPanorama, tramoHastaElProximoIngreso } from "./panorama.ts";
import { codigoMoneda } from "./monedas.ts";
import { indicadoresPersonales } from "./pulso.ts";
import { leerTarjetas } from "./leerTarjetas.ts";
import { sumarDias } from "../fecha.ts";
import type { ClienteSinTipos } from "../supabase/sin-tipos.ts";
import type { Deuda } from "./deudas.ts";
import type { Fijo } from "./fijos.ts";

/**
 * La foto diaria del pulso personal.
 *
 * ============================================================
 * POR QUÉ HACE FALTA GUARDARLA
 * ============================================================
 *
 * "¿Qué cambió?" no se puede contestar recalculando: el disponible real de
 * hace un mes no se puede reconstruir hoy, porque depende de compromisos que
 * ya vencieron y de un saldo que ya se movió. Sin una foto del día, la única
 * comparación posible es contra un cálculo inventado.
 *
 * Por eso esto guarda cada indicador con SU estado y SU confianza de ese día,
 * en la misma tabla que ya usa el negocio (`eos_kpi_historia_v105`). Los ids
 * llevan el prefijo `pers_`, así que no se pueden confundir con los del
 * catálogo del negocio ni aparecer en su tablero.
 *
 * ============================================================
 * CUELGA DEL CRON QUE YA EXISTE
 * ============================================================
 *
 * El plan de Vercel permite dos cron jobs y los dos están usados. Esto se
 * engancha al del briefing, igual que `capturarIndicadores`, `avisarRiesgos` y
 * el resto. La consecuencia es que la foto se saca a la hora del briefing; da
 * igual mientras sea siempre la misma hora.
 *
 * ============================================================
 * A QUIÉN
 * ============================================================
 *
 * A quien tenga Constitución Financiera. Sin ella no hay panel personal que
 * mirar, y sacarle una foto a alguien que todavía no configuró nada sería una
 * fila de ceros que después se lee como un mes malo.
 */

/** El techo por corrida, igual que el del briefing. */
const MAX_POR_EJECUCION = 200;

/** Meses completos que se miran para saber cuánto gasta normalmente. */
const MESES_DE_HISTORIA = 6;

/** Horizonte del panorama, el mismo que usa el panel. */
const HORIZONTE_DIAS = 90;

export type ResumenPulso = { usuarios: number; filas: number; fallidos: number };

export async function capturarPulsoPersonal(
  admin: ClienteSinTipos,
  opciones: { hoy: string },
): Promise<ResumenPulso> {
  const resumen: ResumenPulso = { usuarios: 0, filas: 0, fallidos: 0 };
  const { hoy } = opciones;

  const { data: politicas, error } = await admin
    .from("eos_finanzas_politica")
    .select("usuario_id,moneda,saldo_inicial,saldo_inicial_fecha,reserva_minima,porcentaje_ahorro");

  if (error) {
    console.error("Pulso: no se pudo listar a quién capturar:", error);
    return resumen;
  }

  const inicioDelMes = `${hoy.slice(0, 7)}-01`;
  const [anio, mes] = hoy.split("-").map(Number);
  const desdeHistoria = `${new Date(Date.UTC(anio, mes - 1 - MESES_DE_HISTORIA, 1)).toISOString().slice(0, 7)}-01`;
  const hasta = sumarDias(hoy, HORIZONTE_DIAS);

  for (const politica of ((politicas ?? []) as Record<string, unknown>[]).slice(0, MAX_POR_EJECUCION)) {
    const usuarioId = politica.usuario_id as string;

    try {
      const filasGuardar = await fotoDe(admin, usuarioId, politica, {
        hoy,
        hasta,
        inicioDelMes,
        desdeHistoria,
      });

      if (filasGuardar.length === 0) continue;

      // `upsert` y no `insert`: correr dos veces el mismo día tiene que dejar
      // el mismo resultado, y la segunda corrida CORRIGE a la primera si entre
      // medio la persona cargó lo que faltaba.
      const { error: errorGuardar } = await admin
        .from("eos_kpi_historia_v105")
        .upsert(filasGuardar, { onConflict: "usuario_id,indicador,moneda,fecha" });

      if (errorGuardar) {
        console.error(`Pulso: no se pudo guardar la foto de ${usuarioId}:`, errorGuardar);
        resumen.fallidos++;
        continue;
      }

      resumen.usuarios++;
      resumen.filas += filasGuardar.length;
    } catch (e) {
      // Un usuario que falla no frena a los demás: perder la foto de hoy de
      // una persona es un hueco en su serie; abortar el recorrido es un hueco
      // en la de todos.
      console.error(`Pulso: falló la captura de ${usuarioId}:`, e);
      resumen.fallidos++;
    }
  }

  return resumen;
}

async function fotoDe(
  admin: ClienteSinTipos,
  usuarioId: string,
  politica: Record<string, unknown>,
  fechas: { hoy: string; hasta: string; inicioDelMes: string; desdeHistoria: string },
): Promise<FilaHistoria[]> {
  const { hoy, hasta, inicioDelMes, desdeHistoria } = fechas;
  const moneda = codigoMoneda(politica.moneda as string | null, "PYG");

  const [movimientosRes, conciliacionesRes, fijosRes, deudasRes, objetivosRes, lectura] =
    await Promise.all([
      admin
        .from("eos_movimientos_financieros")
        .select("tipo,monto,fecha,descripcion")
        .eq("ambito", "personal")
        .eq("usuario_id", usuarioId)
        .gte("fecha", desdeHistoria)
        .order("fecha", { ascending: true }),
      admin
        .from("eos_finanzas_conciliaciones")
        .select("fecha,saldo_declarado")
        .eq("usuario_id", usuarioId),
      admin
        .from("eos_finanzas_fijos")
        .select("tipo,descripcion,monto,dia_del_mes")
        .eq("ambito", "personal")
        .eq("usuario_id", usuarioId)
        .eq("activo", true),
      admin
        .from("eos_finanzas_deudas")
        .select("acreedor,tipo,moneda,saldo_declarado,cuota_monto,cuota_dia,cuotas_totales,cuotas_pagadas,estado")
        .eq("ambito", "personal")
        .eq("usuario_id", usuarioId)
        .neq("estado", "saldada"),
      admin
        .from("eos_goals")
        .select("valor_actual,meses_cobertura,clase,estado,tipo_medicion")
        .eq("ambito", "personal")
        .eq("usuario_id", usuarioId)
        .eq("estado", "activo"),
      leerTarjetas(admin, usuarioId, { desde: hoy, hasta }),
    ]);

  const movimientos = filas(movimientosRes.data).map((m) => ({
    tipo: m.tipo as "ingreso" | "gasto" | "compromiso",
    monto: num(m.monto),
    fecha: m.fecha as string,
    descripcion: (m.descripcion as string | null) ?? null,
  }));

  // Sin un solo movimiento no hay pulso que fotografiar: sería una fila de
  // ceros que después se lee como un mes malo.
  if (movimientos.length === 0) return [];

  const deudas = (filas(deudasRes.data) as unknown as Deuda[]).map((d) => ({
    ...d,
    saldo_declarado: num(d.saldo_declarado),
    cuota_monto: d.cuota_monto === null ? null : num(d.cuota_monto),
  }));

  const panorama = armarPanorama({
    hoy,
    hasta,
    saldoInicial: num(politica.saldo_inicial),
    saldoInicialFecha: politica.saldo_inicial_fecha as string,
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

  // El mismo tramo que el panel y el pulso. Si la foto usara otra regla, la
  // historia contaría una mejora que fue de dónde se miró y no de la plata.
  const { total: comprometido } = tramoHastaElProximoIngreso(panorama, hoy);

  const ingresoDelMes = movimientos
    .filter((m) => m.tipo === "ingreso" && m.fecha >= inicioDelMes && m.fecha <= hoy)
    .reduce((t, m) => t + m.monto, 0);

  const gastoDelMes = movimientos
    .filter((m) => m.tipo === "gasto" && m.fecha >= inicioDelMes && m.fecha <= hoy)
    .reduce((t, m) => t + m.monto, 0);

  const porcentajeAhorro = num(politica.porcentaje_ahorro);
  const reserva = num(politica.reserva_minima);
  const disponibleReal =
    panorama.saldoActual - comprometido - reserva - (ingresoDelMes * porcentajeAhorro) / 100;

  const gastoHabitual = medianaDeMeses(movimientos, inicioDelMes);

  const objetivos = filas(objetivosRes.data);
  const fondo = objetivos.find((g) => g.clase === "fondo_emergencia");

  const mesesCubiertos =
    fondo && gastoHabitual !== null && gastoHabitual > 0
      ? Math.round((num(fondo.valor_actual) / gastoHabitual) * 100) / 100
      : null;

  const resultados = indicadoresPersonales({
    hoy,
    moneda,
    periodo: { desde: inicioDelMes, hasta: hoy },
    disponibleReal: redondear(disponibleReal),
    gastoHabitualMensual: gastoHabitual,
    gastoDelMes: redondear(gastoDelMes),
    ingresoDelMes: redondear(ingresoDelMes),
    deudaTotal: redondear(deudas.reduce((t, d) => t + d.saldo_declarado, 0)),
    cuotasMensuales: redondear(
      deudas.reduce((t, d) => t + (d.cuota_monto ?? 0), 0) +
        lectura.tarjetas.reduce((t, x) => t + (x.a_pagar ?? 0), 0),
    ),
    porcentajeAhorroDeclarado: porcentajeAhorro,
    mesesCubiertos,
    mesesElegidos: fondo?.meses_cobertura === undefined ? null : Number(fondo.meses_cobertura),
    utilizacionMaxima:
      lectura.tarjetas.length === 0
        ? null
        : Math.max(...lectura.tarjetas.map((x) => x.utilizacion ?? 0)) || null,
  });

  return resultados.map((r) => filaDesdeResultado(usuarioId, hoy, r));
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
