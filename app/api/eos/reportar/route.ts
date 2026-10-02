import { after } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { adminSinTipos } from "@/lib/supabase/sin-tipos";
import { correoDeReporte, validarReporte } from "@/lib/eos/reporte-respuesta";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
 * Reportar una respuesta de EOS (política de IA de Google Play, 01/10/2026).
 * Con sesión. El extracto sale del mensaje guardado de ESA persona cuando hay
 * id; si no, del texto enviado (recortado). Hasta 20 reportes por día por
 * persona. Le llega un correo al dueño (ADMIN_EMAILS) después de responder.
 */
const POR_DIA = 20;

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "sesion" }, { status: 401 });

  const validado = validarReporte(await req.json().catch(() => null));
  if (!validado.ok) return Response.json({ error: validado.motivo }, { status: 400 });
  const { reporte } = validado;

  const admin = adminSinTipos();

  const { count } = await admin
    .from("eos_reportes_respuesta_v230")
    .select("id", { count: "exact", head: true })
    .eq("usuario_id", user.id)
    .gte("creado_en", new Date(Date.now() - 24 * 3600_000).toISOString());
  if ((count ?? 0) >= POR_DIA) return Response.json({ error: "limite" }, { status: 429 });

  let extracto = reporte.extractoDelCliente;
  if (reporte.mensajeId) {
    const { data: mensaje } = await admin
      .from("mensajes")
      .select("texto, conversacion_id")
      .eq("id", reporte.mensajeId)
      .eq("usuario_id", user.id)
      .eq("rol", "eos")
      .maybeSingle();
    if (mensaje?.texto) {
      extracto = String(mensaje.texto).slice(0, 2000);
      reporte.conversacionId = (mensaje.conversacion_id as string | null) ?? reporte.conversacionId;
    }
  }
  if (!extracto) return Response.json({ error: "sin_respuesta" }, { status: 400 });

  const { data: fila, error } = await admin
    .from("eos_reportes_respuesta_v230")
    .insert({
      usuario_id: user.id,
      mensaje_id: reporte.mensajeId,
      conversacion_id: reporte.conversacionId,
      motivo: reporte.motivo,
      comentario: reporte.comentario,
      extracto,
      canal: reporte.canal,
    })
    .select("id")
    .single();

  if (error) {
    console.error("Reporte de respuesta: no se pudo guardar:", error.message);
    return Response.json({ error: "guardar" }, { status: 500 });
  }

  after(async () => {
    const apiKey = process.env.RESEND_API_KEY;
    const destinos = (process.env.ADMIN_EMAILS ?? "").split(",").map((c) => c.trim()).filter(Boolean);
    if (!apiKey || destinos.length === 0) {
      console.error("Reporte de respuesta guardado, pero no se puede avisar (falta RESEND_API_KEY o ADMIN_EMAILS).");
      return;
    }
    const { asunto, html, texto } = correoDeReporte({ reporte, extracto, correoUsuario: user.email ?? null, id: fila?.id ?? null });
    const { Resend } = await import("resend");
    const { error: errorCorreo } = await new Resend(apiKey).emails.send({
      from: process.env.EOS_BRIEFING_FROM || "EOS <no-reply@transtech.com.py>",
      to: destinos,
      subject: asunto,
      html,
      text: texto,
    });
    if (errorCorreo) console.error("Reporte de respuesta: el correo falló:", errorCorreo.message);
  });

  return Response.json({ ok: true });
}
