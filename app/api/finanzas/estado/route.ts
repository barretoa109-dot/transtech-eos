import { createClient } from "@/lib/supabase/server";
import { conciliar, convieneConciliar } from "@/lib/finanzas/conciliacion";
import { combinarSeries, confirmadosPorLaRealidad, type Fijo } from "@/lib/finanzas/fijos";
import {
  detectarSeries,
  proximoIngreso,
  proyectar,
  sumarDias,
} from "@/lib/finanzas/recurrencia";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

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

  const [politicaRes, movimientosRes, objetivosRes, conciliacionesRes, fijosRes] = await Promise.all([
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
  const hoyISO = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Asuncion",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

  // ==========================================================
  // CONCILIACIÓN
  //
  // EOS no ve los pagos con billetera ni el efectivo. Sin esto, el disponible
  // real se muestra con total confianza estando equivocado, y el usuario
  // decide con ese número.
  //
  // Si el usuario ya le dijo alguna vez cuánto tiene de verdad, se parte de
  // ahí en vez del saldo inicial; y si lo dijo dos veces, EOS ya aprendió a
  // qué ritmo se le escapa dinero y lo descuenta sin volver a preguntar.
  // ==========================================================
  const conciliaciones = ((conciliacionesRes.data ?? []) as ConciliacionFila[]).map((c) => ({
    fecha: c.fecha,
    saldo_declarado: num(c.saldo_declarado),
  }));

  const estadoConciliacion = conciliar({
    saldoInicial: num(politica.saldo_inicial),
    saldoInicialFecha: politica.saldo_inicial_fecha,
    conciliaciones,
    movimientos,
    hoy: hoyISO,
  });

  const desdeSaldo = estadoConciliacion.desde;

  // Aplicados: lo que ocurrió desde el último punto confiable.
  const aplicados = movimientos.filter((m) => m.fecha > desdeSaldo && m.fecha <= hoyISO);
  const ingresos = sum(aplicados.filter((m) => m.tipo === "ingreso"));
  const gastos = sum(aplicados.filter((m) => m.tipo === "gasto"));

  // Compromisos futuros ya conocidos (alquiler, tarjeta, cuotas).
  const compromisosPendientes = movimientos.filter((m) => m.tipo === "compromiso" && m.fecha > hoyISO);
  const totalCompromisos = sum(compromisosPendientes);

  // ==========================================================
  // PREVISIÓN
  //
  // Hasta acá EOS solo restaba lo que alguien había cargado. Pero el alquiler
  // se paga igual aunque nadie lo anote. La doctrina pide que EOS PREVEA, no
  // que espere: si un movimiento viene repitiéndose con patrón, cuenta.
  //
  // Las proyecciones no se guardan en la base a propósito (ver
  // lib/finanzas/recurrencia.ts): son dato derivado y duplicarían el gasto
  // cuando el movimiento real aparezca.
  // ==========================================================
  const detectadas = detectarSeries(movimientos);

  // Lo que el usuario declaró como fijo se suma a lo que EOS detectó, pero la
  // realidad manda: si el correo ya trae el alquiler, la serie observada
  // reemplaza a la declarada. Sumarlas descontaría el gasto dos veces.
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

  const series = combinarSeries(detectadas, fijos, hoyISO);
  const ingresoEstimado = proximoIngreso(series, hoyISO);

  // El horizonte natural del disponible real es "hasta que vuelva a entrar
  // plata": ese es el tramo que el usuario tiene que atravesar con lo que
  // tiene hoy. Sin un ingreso detectado, 30 días es el ciclo por defecto.
  const horizonte = ingresoEstimado ? ingresoEstimado.fecha : sumarDias(hoyISO, 30);

  const previsibles = proyectar(
    series.filter((s) => s.tipo !== "ingreso"),
    {
      desde: hoyISO,
      hasta: horizonte,
      // Todo lo que ya está cargado a futuro: sin esto, un compromiso anotado
      // a mano se restaría dos veces y el disponible saldría más bajo del real.
      yaRegistrados: movimientos.filter((m) => m.fecha > hoyISO),
    },
  );
  const totalPrevisible = previsibles.reduce((total, p) => total + p.monto, 0);

  // La base sale de la conciliación: el último saldo que el usuario confirmó,
  // o el inicial si nunca confirmó ninguno. Y se descuenta lo que EOS aprendió
  // que se gasta sin verlo — billetera, efectivo — para no mostrar de más.
  const saldoEstimado =
    estadoConciliacion.base + ingresos - gastos - estadoConciliacion.gasto_invisible;

  const reserva = num(politica.reserva_minima);
  const ahorroComprometido = (ingresos * num(politica.porcentaje_ahorro)) / 100;

  // El ingreso estimado NO se suma: no se gasta plata que todavía no entró.
  // Se informa aparte, porque no es lo mismo tener el sueldo mañana que a 26 días.
  const disponibleReal =
    saldoEstimado - totalCompromisos - totalPrevisible - reserva - ahorroComprometido;

  const compromisosCubiertos = saldoEstimado - reserva >= totalCompromisos + totalPrevisible;
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
        cantidad: compromisosPendientes.length,
        cubiertos: compromisosCubiertos,
        proximo: compromisosPendientes[0]
          ? { fecha: compromisosPendientes[0].fecha, descripcion: compromisosPendientes[0].descripcion }
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
        series_detectadas: detectadas.length,
        fijos_declarados: fijos.length,
        // Declaraciones que la realidad ya confirmó por correo: la semilla
        // cumplió su función y se retiró sola.
        fijos_confirmados: confirmadosPorLaRealidad(detectadas, fijos),
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

function num(value: number | string | null | undefined) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function sum(items: { monto: number }[]) {
  return items.reduce((total, item) => total + item.monto, 0);
}

function redondear(value: number) {
  return Math.round(value * 100) / 100;
}

function noStore() {
  return { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" };
}
