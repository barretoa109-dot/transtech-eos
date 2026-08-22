import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * El usuario le dice a EOS cuánto tiene de verdad.
 *
 * Es la única carga manual que EOS pide, y está diseñada para pedirse dos
 * veces y después nunca más: con dos puntos ya puede calcular a qué ritmo se
 * le escapa dinero y descontarlo solo.
 *
 * Se guarda una foto por día. Si el usuario corrige el mismo día, se
 * reemplaza — dos valores distintos para la misma fecha romperían el cálculo
 * del ritmo.
 */

/** Un saldo por encima de esto es casi seguro un error de tipeo. */
const MAXIMO_RAZONABLE = 999_999_999_999;

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Sesión no válida." }, { status: 401, headers: noStore() });
  }

  let body: { saldo?: unknown; saldo_calculado?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido." }, { status: 400, headers: noStore() });
  }

  const saldo = Number(body.saldo);

  // Un saldo negativo es posible (una cuenta en descubierto), así que no se
  // rechaza. Lo que sí se rechaza es lo que no es un número o es absurdo:
  // este valor pasa a ser la base de todos los cálculos siguientes.
  if (!Number.isFinite(saldo) || Math.abs(saldo) > MAXIMO_RAZONABLE) {
    return NextResponse.json(
      { error: "Ese monto no parece válido." },
      { status: 400, headers: noStore() },
    );
  }

  const calculado = Number(body.saldo_calculado);

  const { error } = await supabase.from("eos_finanzas_conciliaciones").upsert(
    {
      usuario_id: user.id,
      fecha: hoyEnParaguay(),
      saldo_declarado: Math.round(saldo * 100) / 100,
      saldo_calculado: Number.isFinite(calculado) ? Math.round(calculado * 100) / 100 : null,
      origen: "usuario",
    },
    { onConflict: "usuario_id,fecha" },
  );

  if (error) {
    console.error("No se pudo guardar la conciliación:", error);
    return NextResponse.json(
      { error: "No pudimos guardar tu saldo." },
      { status: 500, headers: noStore() },
    );
  }

  return NextResponse.json({ ok: true }, { headers: noStore() });
}

/**
 * Hoy en Paraguay, no en el servidor.
 *
 * La fecha de la conciliación es el ancla de todo el cálculo del ritmo. Un
 * día de corrimiento a las once de la noche desplazaría la serie entera.
 */
function hoyEnParaguay() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Asuncion",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function noStore() {
  return { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" };
}
