import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { registrarAuditoria } from "@/lib/auditoria/registrar";
import { hoyEnParaguay, sumarDias } from "@/lib/fecha";
import { armarPanorama } from "@/lib/finanzas/panorama";
import { cuotasPendientes, type Deuda } from "@/lib/finanzas/deudas";
import { armarPlan } from "@/lib/finanzas/planPago";
import { ADVERTENCIA, redactarNegociacion } from "@/lib/finanzas/negociacion";
import type { Fijo } from "@/lib/finanzas/fijos";

export const dynamic = "force-dynamic";

/** Un mes por delante: el plan se rearma cada mes, no se firma a un año. */
const VENTANA_DIAS = 30;

/**
 * El plan de pago y, si hace falta, los borradores para negociar.
 *
 * Fase 4 de la hoja de ruta: "EOS prepara la solución completa; el usuario solo
 * aprueba". Acá está el preparar.
 *
 * Lo que EOS NO hace, y conviene tenerlo escrito: no paga. En Paraguay no hay
 * riel para que una aplicación abone la cuota de un préstamo ajeno, y aunque lo
 * hubiera, mover plata sin un tap explícito está prohibido por la regla que no
 * se negocia. El plan es una propuesta; los mensajes son borradores.
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
  const hasta = sumarDias(hoy, VENTANA_DIAS);

  const [politicaRes, movimientosRes, conciliacionesRes, fijosRes, deudasRes, perfilRes] =
    await Promise.all([
      supabase
        .from("eos_finanzas_politica")
        .select("moneda,saldo_inicial,saldo_inicial_fecha,reserva_minima")
        .eq("usuario_id", user.id)
        .maybeSingle(),
      supabase
        .from("eos_movimientos_financieros")
        .select("tipo,monto,fecha,descripcion")
        .eq("usuario_id", user.id)
        .order("fecha", { ascending: true }),
      supabase
        .from("eos_finanzas_conciliaciones")
        .select("fecha,saldo_declarado")
        .eq("usuario_id", user.id),
      supabase
        .from("eos_finanzas_fijos")
        .select("tipo,descripcion,monto,dia_del_mes")
        .eq("usuario_id", user.id)
        .eq("activo", true),
      supabase
        .from("eos_finanzas_deudas")
        .select(
          "acreedor,tipo,moneda,saldo_declarado,saldo_declarado_el,cuota_monto,cuota_dia,cuotas_totales,cuotas_pagadas,tasa_anual,vence_el,estado,preocupa",
        )
        .eq("usuario_id", user.id)
        .neq("estado", "saldada"),
      supabase.from("usuarios").select("nombre").eq("id", user.id).maybeSingle(),
    ]);

  const politica = politicaRes.data as {
    moneda: string | null;
    saldo_inicial: number | string;
    saldo_inicial_fecha: string;
    reserva_minima: number | string;
  } | null;

  if (!politica) {
    return NextResponse.json({ configurado: false }, { headers: noStore() });
  }

  const deudas = ((deudasRes.data ?? []) as unknown as Deuda[]).map((d) => ({
    ...d,
    saldo_declarado: num(d.saldo_declarado),
    cuota_monto: d.cuota_monto === null ? null : num(d.cuota_monto),
  }));

  if (deudas.length === 0) {
    return NextResponse.json(
      { configurado: true, sin_deudas: true, plan: null, negociaciones: [] },
      { headers: noStore() },
    );
  }

  const comunes = {
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
  };

  // Se arma el panorama SIN las deudas para poder separar lo que se va en
  // vivir de lo que se va en cuotas. Con todo mezclado, la capacidad de pago
  // saldría descontando las mismas cuotas que el plan tiene que repartir.
  const panorama = armarPanorama({ ...comunes, deudas: [] });

  const entra = panorama.ingresos.reduce((t, i) => t + i.monto, 0);
  const sale = panorama.egresos.reduce((t, e) => t + e.monto, 0);

  // La reserva mínima NO se resta acá: es un colchón sobre el saldo, no un
  // gasto del mes. Restarla todos los meses subestimaría la capacidad siempre.
  const capacidadMensual = Math.max(0, entra - sale);
  const disponible = Math.max(0, panorama.saldoActual - num(politica.reserva_minima));

  const proximas = cuotasPendientes(deudas, { desde: hoy, hasta });
  const fechas: Record<string, string> = {};
  for (const deuda of deudas) {
    const suya = proximas.find((c) => c.descripcion.includes(deuda.acreedor));
    if (suya) fechas[deuda.acreedor] = suya.fecha;
  }

  const plan = armarPlan({ deudas, capacidadMensual, fechas });

  const primerIngreso = panorama.ingresos[0] ?? null;
  const proximoIngreso = primerIngreso
    ? { fecha: primerIngreso.fecha, dias: diasEntre(hoy, primerIngreso.fecha) }
    : null;

  const nombre = (perfilRes.data?.nombre as string | null) ?? null;

  // Solo se redacta para lo que no entra. Ofrecer borradores de negociación
  // para deudas que el usuario SÍ puede pagar sería empujarlo a pedir algo que
  // no necesita y a gastar crédito con su acreedor.
  const negociaciones = plan.a_negociar
    .map((acreedor) => deudas.find((d) => d.acreedor === acreedor))
    .filter((d): d is Deuda => Boolean(d))
    .map((deuda) =>
      redactarNegociacion({ deuda, disponible, capacidadMensual, proximoIngreso, nombreUsuario: nombre }),
    );

  return NextResponse.json(
    {
      configurado: true,
      sin_deudas: false,
      plan,
      negociaciones,
      advertencia: ADVERTENCIA,
      // Que EOS no pueda pagar no es un detalle de implementación: es lo que el
      // usuario tiene que saber para no quedarse esperando.
      eos_no_paga: true,
    },
    { headers: noStore() },
  );
}

/**
 * El usuario adopta el plan.
 *
 * No ejecuta nada —EOS no puede—, pero es una decisión suya sobre su plata y
 * queda asentada en la bitácora inmutable. Es el "registro auditable de cada
 * autorización" que pide la fase 4, aplicado a lo único que acá se autoriza:
 * el compromiso con un curso de acción.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Sesión no válida." }, { status: 401, headers: noStore() });
  }

  let body: { acreedores?: unknown; total?: unknown };
  try {
    body = (await request.json()) as { acreedores?: unknown; total?: unknown };
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido." }, { status: 400, headers: noStore() });
  }

  const acreedores = Array.isArray(body.acreedores)
    ? body.acreedores.filter((a): a is string => typeof a === "string").slice(0, 60)
    : [];

  if (acreedores.length === 0) {
    return NextResponse.json(
      { error: "El plan no tiene ningún pago que adoptar." },
      { status: 400, headers: noStore() },
    );
  }

  const registrado = await registrarAuditoria(createAdminClient() as never, {
    usuarioId: user.id,
    evento: "accion_autorizada",
    origen: "panel",
    resumen: `Adoptaste el plan de pago de este mes: ${acreedores.length} pago(s) a ${acreedores
      .slice(0, 3)
      .join(", ")}${acreedores.length > 3 ? " y otros" : ""}.`,
    detalle: { pagos: acreedores.length, total: Number(body.total) || 0 },
  });

  return NextResponse.json({ ok: true, registrado }, { headers: noStore() });
}

function diasEntre(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

function num(valor: unknown): number {
  const n = typeof valor === "string" ? Number(valor) : Number(valor ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function noStore() {
  return { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" };
}
