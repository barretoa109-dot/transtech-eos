import { createClient } from "@/lib/supabase/server";
import { convieneConciliar } from "@/lib/finanzas/conciliacion";
import { confirmadosPorLaRealidad, type Fijo } from "@/lib/finanzas/fijos";
import { hoyEnParaguay, sumarDias } from "@/lib/fecha";
import { armarPanorama, type EgresoPanorama } from "@/lib/finanzas/panorama";
import type { Deuda } from "@/lib/finanzas/deudas";
import type { MovimientoProyectado } from "@/lib/finanzas/recurrencia";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Hasta dónde se arma la línea de tiempo antes de recortarla.
 *
 * El panel solo mira hasta el próximo ingreso, pero cuál es ese ingreso recién
 * se sabe DESPUÉS de proyectar. Así que se proyecta largo una vez y se corta
 * después, en vez de adivinar el horizonte y tener que volver a empezar.
 */
const HORIZONTE_ARMADO_DIAS = 90;

/** Sin un ingreso detectado, el ciclo por defecto de un mes. */
const CICLO_POR_DEFECTO_DIAS = 30;

type Movimiento = {
  tipo: "ingreso" | "gasto" | "compromiso";
  monto: number | string | null;
  fecha: string;
  descripcion: string | null;
};

type ConciliacionFila = {
  fecha: string;
  saldo_declarado: number | string | null;
};

type Politica = {
  moneda: string;
  saldo_inicial: number | string | null;
  saldo_inicial_fecha: string;
  reserva_minima: number | string | null;
  porcentaje_ahorro: number | string | null;
  umbral_autorizacion: number | string | null;
};

/**
 * Estado financiero para el panel "¿Estoy bien?".
 *
 * Sigue la doctrina EOS Finanzas del usuario: la métrica central NO es el
 * saldo sino el DISPONIBLE REAL, es decir lo que queda después de honrar
 * compromisos futuros, la reserva mínima y el ahorro comprometido.
 *
 * El armado de la línea de tiempo vive en `lib/finanzas/panorama.ts` y es el
 * MISMO que usa la alerta de riesgo. Antes cada uno sumaba lo suyo y el panel
 * no contaba las cuotas de las deudas: el usuario veía "estás bien" en una
 * pantalla y "el 28 no te alcanza" en la otra, sobre la misma plata.
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

  const [politicaRes, movimientosRes, objetivosRes, conciliacionesRes, fijosRes, deudasRes] =
    await Promise.all([
      supabase
        .from("eos_finanzas_politica")
        .select("moneda,saldo_inicial,saldo_inicial_fecha,reserva_minima,porcentaje_ahorro,umbral_autorizacion")
        .eq("usuario_id", user.id)
        .maybeSingle(),
      supabase
        .from("eos_movimientos_financieros")
        .select("tipo,monto,fecha,descripcion")
        .eq("usuario_id", user.id)
        .order("fecha", { ascending: true }),
      supabase.from("eos_goals").select("estado,progreso").eq("usuario_id", user.id),
      supabase
        .from("eos_finanzas_conciliaciones")
        .select("fecha,saldo_declarado")
        .eq("usuario_id", user.id)
        .order("fecha", { ascending: true }),
      supabase
        .from("eos_finanzas_fijos")
        .select("tipo,descripcion,monto,dia_del_mes")
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

  if (politicaRes.error && politicaRes.error.code !== "PGRST116") {
    console.error("No se pudo leer la política financiera:", politicaRes.error);
  }

  const politica = (politicaRes.data ?? null) as Politica | null;

  // Sin Constitución Financiera todavía no hay nada que calcular: EOS no
  // inventa un estado, informa que falta configurarse.
  if (!politica) {
    return NextResponse.json({ configurado: false }, { headers: noStore() });
  }

  const movimientos = ((movimientosRes.data ?? []) as Movimiento[]).map((m) => ({
    ...m,
    monto: num(m.monto),
  }));

  // El día del usuario, no el del servidor. `toISOString()` es UTC: a las
  // 23:00 de Paraguay ya sería mañana, y un compromiso que vence mañana
  // dejaría de contarse como futuro.
  const hoyISO = hoyEnParaguay();

  const fijos = (
    (fijosRes.data ?? []) as {
      tipo: string;
      descripcion: string;
      monto: number | string;
      dia_del_mes: number;
    }[]
  ).map<Fijo>((f) => ({
    tipo: f.tipo === "ingreso" ? "ingreso" : "gasto",
    descripcion: f.descripcion,
    monto: num(f.monto),
    dia_del_mes: f.dia_del_mes,
  }));

  const deudas = ((deudasRes.data ?? []) as unknown as Deuda[]).map((d) => ({
    ...d,
    saldo_declarado: num(d.saldo_declarado),
    cuota_monto: d.cuota_monto === null ? null : num(d.cuota_monto),
  }));

  // ==========================================================
  // LA LÍNEA DE TIEMPO
  //
  // Reúne las cuatro fuentes —compromisos anotados, series detectadas, fijos
  // declarados y cuotas de deudas— con la conciliación ya aplicada. EOS no ve
  // los pagos con billetera ni el efectivo; sin esa corrección el disponible
  // real se muestra con total confianza estando equivocado.
  // ==========================================================
  const panorama = armarPanorama({
    hoy: hoyISO,
    hasta: sumarDias(hoyISO, HORIZONTE_ARMADO_DIAS),
    saldoInicial: num(politica.saldo_inicial),
    saldoInicialFecha: politica.saldo_inicial_fecha,
    reservaMinima: num(politica.reserva_minima),
    movimientos,
    conciliaciones: ((conciliacionesRes.data ?? []) as ConciliacionFila[]).map((c) => ({
      fecha: c.fecha,
      saldo_declarado: num(c.saldo_declarado),
    })),
    fijos,
    deudas,
  });

  const ingresos = panorama.aplicado.ingresos;
  const gastos = panorama.aplicado.gastos;
  const estadoConciliacion = panorama.conciliacion;

  // El próximo ingreso es el más cercano de los dos mundos: el que ya está
  // cargado a futuro y el que EOS proyecta. Mirar solo las proyecciones diría
  // "cobrás el 25 de septiembre" a alguien que tiene el sueldo de septiembre
  // ya anotado — y un ingreso que EOS no ve es plata que el usuario cree que
  // EOS está contando.
  const ingresoAnotado = movimientos
    .filter((m) => m.tipo === "ingreso" && m.fecha > hoyISO)
    .map<MovimientoProyectado>((m) => ({
      tipo: "ingreso",
      descripcion: m.descripcion ?? "Ingreso",
      monto: m.monto,
      fecha: m.fecha,
      periodicidad: "mensual",
      confianza: 1,
    }))[0];

  const ingresoProyectado = panorama.ingresos[0];
  const ingresoEstimado = primeroPorFecha(ingresoAnotado, ingresoProyectado);

  // El horizonte natural del disponible real es "hasta que vuelva a entrar
  // plata": ese es el tramo que el usuario tiene que atravesar con lo que
  // tiene hoy. Sin un ingreso detectado, 30 días es el ciclo por defecto.
  const horizonte = ingresoEstimado
    ? ingresoEstimado.fecha
    : sumarDias(hoyISO, CICLO_POR_DEFECTO_DIAS);

  const egresos = panorama.egresos.filter((e) => e.fecha <= horizonte);

  const porFuente = (fuente: EgresoPanorama["fuente"]) => egresos.filter((e) => e.fuente === fuente);

  const anotados = porFuente("anotado");
  const previsibles = porFuente("previsible");
  const cuotas = porFuente("cuota");

  const totalCompromisos = sumar(anotados);
  const totalPrevisible = sumar(previsibles);
  const totalCuotas = sumar(cuotas);

  const saldoEstimado = panorama.saldoActual;
  const reserva = panorama.reservaMinima;
  const ahorroComprometido = (ingresos * num(politica.porcentaje_ahorro)) / 100;

  // Todo lo que ya tiene dueño antes de que el usuario decida nada.
  const comprometido = totalCompromisos + totalPrevisible + totalCuotas;

  // El ingreso estimado NO se suma: no se gasta plata que todavía no entró.
  // Se informa aparte, porque no es lo mismo tener el sueldo mañana que a 26 días.
  const disponibleReal = saldoEstimado - comprometido - reserva - ahorroComprometido;

  const compromisosCubiertos = saldoEstimado - reserva >= comprometido;
  const reservaProtegida = saldoEstimado >= reserva;

  const objetivos = (objetivosRes.data ?? []) as { estado: string | null; progreso: number | null }[];
  const objetivosActivos = objetivos.filter((o) => o.estado === "activo");
  const objetivosEnRitmo = objetivosActivos.length === 0 || objetivosActivos.every((o) => (o.progreso ?? 0) > 0);

  // Estado global: la única pregunta que el panel responde primero.
  let estado: "seguro" | "atencion" | "accion" = "seguro";
  if (!reservaProtegida || disponibleReal < 0) {
    estado = "accion";
  } else if (!compromisosCubiertos || !objetivosEnRitmo) {
    estado = "atencion";
  }

  const sinDatos = movimientos.length === 0;

  return NextResponse.json(
    {
      configurado: true,
      sin_datos: sinDatos,
      moneda: politica.moneda,
      estado,
      disponible_real: redondear(disponibleReal),
      saldo_estimado: redondear(saldoEstimado),
      ingresos: redondear(ingresos),
      gastos: redondear(gastos),
      reserva_minima: redondear(reserva),
      ahorro_comprometido: redondear(ahorroComprometido),
      compromisos: {
        total: redondear(totalCompromisos),
        cantidad: anotados.length,
        cubiertos: compromisosCubiertos,
        proximo: anotados[0]
          ? { fecha: anotados[0].fecha, descripcion: anotados[0].descripcion }
          : null,
      },
      reserva_protegida: reservaProtegida,
      objetivos_en_ritmo: objetivosEnRitmo,
      objetivos_activos: objetivosActivos.length,
      movimientos_registrados: movimientos.length,
      prevision: {
        // La línea que la doctrina pone al lado del disponible real, porque es
        // la que convierte un número en una respuesta.
        proximo_ingreso: ingresoEstimado
          ? {
              fecha: ingresoEstimado.fecha,
              monto: redondear(ingresoEstimado.monto),
              descripcion: ingresoEstimado.descripcion,
              confianza: ingresoEstimado.confianza,
            }
          : null,
        gastos_previsibles: {
          total: redondear(totalPrevisible),
          cantidad: previsibles.length,
          hasta: horizonte,
          detalle: previsibles.slice(0, 6).map((p) => ({
            fecha: p.fecha,
            descripcion: p.descripcion,
            monto: redondear(p.monto),
            periodicidad: p.periodicidad,
          })),
        },
        // Las cuotas van en su propia línea y no mezcladas con los gastos
        // previsibles: una cuota no es una deducción de EOS, es un compromiso
        // que el usuario ya firmó con un tercero y tiene fecha cierta.
        cuotas: {
          total: redondear(totalCuotas),
          cantidad: cuotas.length,
          detalle: cuotas.slice(0, 6).map((c) => ({
            fecha: c.fecha,
            descripcion: c.descripcion,
            monto: redondear(c.monto),
          })),
        },
        series_detectadas: panorama.detectadas.length,
        fijos_declarados: fijos.length,
        // Declaraciones que la realidad ya confirmó por correo: la semilla
        // cumplió su función y se retiró sola.
        fijos_confirmados: confirmadosPorLaRealidad(panorama.detectadas, fijos),
      },
      conciliacion: {
        confianza: estadoConciliacion.confianza,
        veces: estadoConciliacion.conciliaciones,
        dias_desde_ultima: estadoConciliacion.dias_desde_ultima,
        gasto_invisible: redondear(estadoConciliacion.gasto_invisible),
        // Ya aprendió el ritmo: puede descontar solo y no molestar más.
        aprendido: estadoConciliacion.ritmo_diario !== null,
        conviene_preguntar: convieneConciliar(estadoConciliacion),
      },
    },
    { headers: noStore() },
  );
}

/** El que ocurre antes. Cualquiera de los dos puede faltar. */
function primeroPorFecha(
  a: MovimientoProyectado | undefined,
  b: MovimientoProyectado | undefined,
): MovimientoProyectado | null {
  if (!a) return b ?? null;
  if (!b) return a;
  return a.fecha <= b.fecha ? a : b;
}

function num(value: number | string | null | undefined) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function sumar(items: { monto: number }[]) {
  return items.reduce((total, item) => total + item.monto, 0);
}

function redondear(value: number) {
  return Math.round(value * 100) / 100;
}

function noStore() {
  return { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" };
}
