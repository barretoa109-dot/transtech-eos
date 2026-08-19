import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const MONEDAS = ["PYG", "USD"];

/** Lee la Constitución Financiera del usuario (para precargar el formulario). */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Sesión no válida." }, { status: 401, headers: noStore() });
  }

  const { data, error } = await supabase
    .from("eos_finanzas_politica")
    .select("moneda,saldo_inicial,saldo_inicial_fecha,reserva_minima,porcentaje_ahorro,umbral_autorizacion,updated_at")
    .eq("usuario_id", user.id)
    .maybeSingle();

  if (error) {
    console.error("No se pudo leer la política financiera:", error);
    return NextResponse.json({ error: "No pudimos cargar tu configuración." }, { status: 500, headers: noStore() });
  }

  return NextResponse.json({ politica: data ?? null }, { headers: noStore() });
}

/**
 * Crea o actualiza la Constitución Financiera.
 *
 * Doctrina EOS Finanzas: el usuario define esto UNA vez y EOS opera dentro
 * de esos límites sin volver a preguntar. Por eso se valida con cuidado —
 * un valor mal cargado acá contamina todo el cálculo del disponible real.
 */
export async function PUT(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Sesión no válida." }, { status: 401, headers: noStore() });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido." }, { status: 400, headers: noStore() });
  }

  const moneda = typeof body.moneda === "string" && MONEDAS.includes(body.moneda) ? body.moneda : "PYG";

  const saldoInicial = montoValido(body.saldo_inicial);
  const reservaMinima = montoValido(body.reserva_minima);
  const porcentajeAhorro = Number(body.porcentaje_ahorro);
  const umbral = body.umbral_autorizacion === null || body.umbral_autorizacion === undefined
    ? null
    : montoValido(body.umbral_autorizacion);

  if (saldoInicial === null) {
    return NextResponse.json({ error: "El saldo actual debe ser un número válido." }, { status: 400, headers: noStore() });
  }

  if (reservaMinima === null) {
    return NextResponse.json(
      { error: "La reserva mínima debe ser un número válido." },
      { status: 400, headers: noStore() },
    );
  }

  if (!Number.isFinite(porcentajeAhorro) || porcentajeAhorro < 0 || porcentajeAhorro > 100) {
    return NextResponse.json(
      { error: "El porcentaje de ahorro debe estar entre 0 y 100." },
      { status: 400, headers: noStore() },
    );
  }

  if (body.umbral_autorizacion !== null && body.umbral_autorizacion !== undefined && umbral === null) {
    return NextResponse.json(
      { error: "El umbral de autorización debe ser un número válido." },
      { status: 400, headers: noStore() },
    );
  }

  const fecha =
    typeof body.saldo_inicial_fecha === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.saldo_inicial_fecha)
      ? body.saldo_inicial_fecha
      : new Date().toISOString().slice(0, 10);

  const { error } = await supabase.from("eos_finanzas_politica").upsert(
    {
      usuario_id: user.id,
      moneda,
      saldo_inicial: saldoInicial,
      saldo_inicial_fecha: fecha,
      reserva_minima: reservaMinima,
      porcentaje_ahorro: porcentajeAhorro,
      umbral_autorizacion: umbral,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "usuario_id" },
  );

  if (error) {
    console.error("No se pudo guardar la política financiera:", error);
    return NextResponse.json({ error: "No pudimos guardar tu configuración." }, { status: 500, headers: noStore() });
  }

  return NextResponse.json({ ok: true }, { headers: noStore() });
}

function montoValido(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100) / 100;
}

function noStore() {
  return { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" };
}
