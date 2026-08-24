import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Estado de la conversación fundacional.
 *
 * La hoja de ruta define el onboarding por su cierre, no por sus preguntas:
 * *"una sola conversación que termina en «ya no tenés que contarme nada más»"*.
 * Esta ruta existe para que esa promesa se pueda cumplir — EOS tiene que saber
 * qué ya preguntó, o cada sesión se sentiría como un formulario que no termina.
 *
 * Lo cualitativo (qué le preocupa, qué evita mirar) se guarda acá y no en el
 * chat a propósito: tiene que sobrevivir a que el usuario borre una
 * conversación. Es el dato que después decide de qué habla EOS primero.
 */

const PASOS = [
  "bienvenida",
  "cuentas",
  "ingresos",
  "gastos_fijos",
  "deudas",
  "preocupaciones",
  "correo",
  "cierre",
  "completado",
] as const;

const COLUMNAS = "paso,preocupacion_principal,evita_mirar,completado_en,created_at";

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
    .from("eos_onboarding")
    .select(COLUMNAS)
    .eq("usuario_id", user.id)
    .maybeSingle();

  if (error) {
    console.error("No se pudo leer el onboarding:", error);
    return NextResponse.json(
      { error: "No pudimos cargar tu configuración inicial." },
      { status: 500, headers: noStore() },
    );
  }

  // Sin fila, el usuario no arrancó: se devuelve el estado inicial en vez de
  // null para que el cliente no tenga que distinguir dos formas del mismo
  // "todavía no empezó".
  const estado = data ?? {
    paso: "bienvenida",
    preocupacion_principal: null,
    evita_mirar: null,
    completado_en: null,
  };

  return NextResponse.json(
    { onboarding: estado, pasos: PASOS, completado: Boolean(estado.completado_en) },
    { headers: noStore() },
  );
}

export async function PATCH(request: Request) {
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
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido." }, { status: 400, headers: noStore() });
  }

  const paso =
    typeof body.paso === "string" && (PASOS as readonly string[]).includes(body.paso)
      ? body.paso
      : null;

  if (!paso) {
    return NextResponse.json({ error: "Paso inválido." }, { status: 400, headers: noStore() });
  }

  const fila: Record<string, unknown> = {
    usuario_id: user.id,
    paso,
    updated_at: new Date().toISOString(),
  };

  if (typeof body.preocupacion_principal === "string") {
    fila.preocupacion_principal = body.preocupacion_principal.trim().slice(0, 500) || null;
  }

  if (typeof body.evita_mirar === "string") {
    fila.evita_mirar = body.evita_mirar.trim().slice(0, 500) || null;
  }

  // `completado_en` lo pone el servidor cuando el paso llega al final, no el
  // cliente: es la marca de que la promesa del cierre ya se hizo, y no algo
  // que una pantalla deba poder afirmar por su cuenta.
  if (paso === "completado") {
    fila.completado_en = new Date().toISOString();
  }

  const { data, error } = await supabase
    .from("eos_onboarding")
    .upsert(fila, { onConflict: "usuario_id" })
    .select(COLUMNAS)
    .single();

  if (error) {
    console.error("No se pudo guardar el onboarding:", error);
    return NextResponse.json(
      { error: "No pudimos guardar tu avance." },
      { status: 500, headers: noStore() },
    );
  }

  return NextResponse.json({ onboarding: data }, { headers: noStore() });
}

function noStore() {
  return { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" };
}
