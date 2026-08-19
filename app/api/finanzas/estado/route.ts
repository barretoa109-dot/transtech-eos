import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type Movimiento = {
  tipo: "ingreso" | "gasto" | "compromiso";
  monto: number | string | null;
  fecha: string;
  descripcion: string | null;
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

  const [politicaRes, movimientosRes, objetivosRes] = await Promise.all([
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

  const hoy = new Date();
  const hoyISO = hoy.toISOString().slice(0, 10);
  const desdeSaldo = politica.saldo_inicial_fecha;

  // Aplicados: lo que ya ocurrió desde que se declaró el saldo inicial.
  const aplicados = movimientos.filter((m) => m.fecha >= desdeSaldo && m.fecha <= hoyISO);
  const ingresos = sum(aplicados.filter((m) => m.tipo === "ingreso"));
  const gastos = sum(aplicados.filter((m) => m.tipo === "gasto"));

  // Compromisos futuros ya conocidos (alquiler, tarjeta, cuotas).
  const compromisosPendientes = movimientos.filter((m) => m.tipo === "compromiso" && m.fecha > hoyISO);
  const totalCompromisos = sum(compromisosPendientes);

  const saldoEstimado = num(politica.saldo_inicial) + ingresos - gastos;
  const reserva = num(politica.reserva_minima);
  const ahorroComprometido = (ingresos * num(politica.porcentaje_ahorro)) / 100;

  const disponibleReal = saldoEstimado - totalCompromisos - reserva - ahorroComprometido;

  const compromisosCubiertos = saldoEstimado - reserva >= totalCompromisos;
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
