import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { exigirModulo } from "@/lib/modulos/acceso";

export const dynamic = "force-dynamic";

/**
 * Avisos del banco que el parser vio pero no se animó a guardar solo.
 *
 * `extraerDeCorreo` es deliberadamente conservador (ver su propio comentario):
 * por debajo de 0.8 de confianza, nada se guarda como movimiento real. Antes
 * de esto, ese descarte quedaba solo en la bitácora de auditoría — el usuario
 * nunca lo veía salvo que fuera a buscarlo. Esta pantalla es el otro lado de
 * esa decisión: perderse el movimiento es aceptable solo si el usuario puede
 * notarlo y confirmarlo con un toque.
 */
export async function GET() {
  const puerta = await exigirModulo("lectura");
  if (puerta.respuesta) return puerta.respuesta;

  const supabase = await createClient();

  const { data, error } = await supabase
    .from("eos_correos_entrantes")
    .select("email_id, remitente, tipo, monto, moneda, descripcion, confianza, recibido_en")
    .eq("estado", "descartado")
    .eq("revisado", false)
    .order("recibido_en", { ascending: false })
    .limit(20);

  if (error) {
    console.error("No se pudieron leer los avisos descartados:", error);
    return NextResponse.json({ error: "No pudimos leer tus avisos." }, { status: 500, headers: noStore() });
  }

  return NextResponse.json({ avisos: data ?? [] }, { headers: noStore() });
}

/** `{ email_id, accion: "confirmar" | "descartar" }`. */
export async function POST(request: Request) {
  const puerta = await exigirModulo("lectura");
  if (puerta.respuesta) return puerta.respuesta;

  let body: { email_id?: unknown; accion?: unknown };
  try {
    body = (await request.json()) as { email_id?: unknown; accion?: unknown };
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido." }, { status: 400, headers: noStore() });
  }

  const emailId = typeof body.email_id === "string" ? body.email_id : "";
  const accion = body.accion === "confirmar" || body.accion === "descartar" ? body.accion : null;

  if (!emailId || !accion) {
    return NextResponse.json({ error: "Faltan datos." }, { status: 400, headers: noStore() });
  }

  const supabase = await createClient();

  const { data, error } = await supabase.rpc("eos_finanzas_resolver_correo_v250", {
    p_email_id: emailId,
    p_accion: accion,
  });

  if (error) {
    console.error("No se pudo resolver el aviso descartado:", error);
    return NextResponse.json({ error: "No pudimos guardar tu respuesta." }, { status: 500, headers: noStore() });
  }

  return NextResponse.json({ ok: true, movimiento_id: data ?? null }, { headers: noStore() });
}

function noStore() {
  return { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" };
}
