import { timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";

import { correoDeEscalamientos, avisoPush, type Escalamiento } from "@/lib/agentes/escalamientos";
import { avisarNativo } from "@/lib/push/nativo";
import { adminSinTipos } from "@/lib/supabase/sin-tipos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/*
 * El aviso al dueño de lo que escalan los agentes.
 *
 *   ?urgentes=1  → lo llama la base al momento en que un agente escala algo
 *                  urgente (trigger de la v267). Push al iPhone + correo.
 *   (sin nada)   → el resumen diario de las 18:00 de Asunción (pg_cron, v267).
 *                  Un correo con los normales que no se avisaron todavía.
 *
 * Esto NO es un agente: no le escribe a ningún usuario, solo al dueño, y usa
 * la service role como el resto de lo de /admin. Los agentes no pueden
 * llamarlo: no tienen el CRON_SECRET ni permiso sobre estas funciones.
 *
 * Un caso se marca avisado solo si salió por al menos un canal. Si no salió
 * por ninguno (falta Resend y no hay iPhone), queda para la próxima vuelta.
 */

function autorizado(request: Request) {
  const esperado = process.env.CRON_SECRET;
  if (!esperado) return false;
  const header = request.headers.get("authorization") || "";
  const recibido = header.startsWith("Bearer ") ? header.slice(7) : "";
  const a = Buffer.from(recibido);
  const b = Buffer.from(esperado);
  return a.length === b.length && timingSafeEqual(a, b);
}

function baseUrlApp() {
  return (process.env.EOS_APP_BASE_URL || process.env.NEXT_PUBLIC_SITE_URL || "https://www.transtech.com.py").replace(
    /\/$/,
    "",
  );
}

function administradores() {
  return (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((c) => c.trim().toLowerCase())
    .filter(Boolean);
}

export async function GET(request: Request) {
  if (!autorizado(request)) return NextResponse.json({ ok: false }, { status: 401 });

  const urgentes = new URL(request.url).searchParams.get("urgentes") === "1";
  const admin = adminSinTipos();

  const { data, error } = await admin.rpc("eos_agentes_por_avisar_v267", { p_urgentes: urgentes });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  const casos = (Array.isArray(data) ? data : []) as Escalamiento[];
  if (casos.length === 0) return NextResponse.json({ ok: true, urgentes, avisados: 0 });

  const destinos = administradores();
  let salioPorAlgo = false;
  const canales: Record<string, string> = {};

  const clave = process.env.RESEND_API_KEY;
  if (clave && destinos.length > 0) {
    const { Resend } = await import("resend");
    const correo = correoDeEscalamientos(casos, { urgentes, baseUrl: baseUrlApp() });
    const { error: errorCorreo } = await new Resend(clave).emails.send({
      from: process.env.EOS_BRIEFING_FROM || "EOS <no-reply@transtech.com.py>",
      to: destinos,
      subject: correo.asunto,
      text: correo.texto,
      html: correo.html,
    });
    canales.correo = errorCorreo ? `falló: ${errorCorreo.message}` : "ok";
    salioPorAlgo ||= !errorCorreo;
  } else {
    canales.correo = "sin RESEND_API_KEY o ADMIN_EMAILS";
  }

  if (urgentes && destinos.length > 0) {
    // Los iPhone del dueño: la cuenta de EOS de cada correo administrador.
    // Es el único `.from` de esta ruta y lee una sola columna de las cuentas
    // del propio dueño.
    const { data: cuentas } = await admin.from("usuarios").select("id").in("email", destinos);
    let entregados = 0;
    for (const cuenta of (cuentas ?? []) as { id: string }[]) {
      const r = await avisarNativo(admin, cuenta.id, avisoPush(casos));
      entregados += r.enviados ?? 0;
    }
    canales.push = entregados > 0 ? `ok (${entregados})` : "sin entregas";
    salioPorAlgo ||= entregados > 0;
  }

  if (!salioPorAlgo) {
    console.error("Agentes: hay escalamientos y no salieron por ningún canal.", canales);
    return NextResponse.json({ ok: false, urgentes, pendientes: casos.length, canales }, { status: 503 });
  }

  const { data: marcados, error: errorMarca } = await admin.rpc("eos_agentes_avisados_v267", {
    p_ids: casos.map((c) => c.id),
    p_urgentes: urgentes,
  });
  if (errorMarca) return NextResponse.json({ ok: false, error: errorMarca.message }, { status: 500 });

  return NextResponse.json({ ok: true, urgentes, avisados: marcados, canales });
}
