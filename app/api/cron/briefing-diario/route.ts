import { timingSafeEqual } from "crypto";
import { after } from "next/server";
import { NextResponse } from "next/server";
import { Resend } from "resend";

import { createAdminClient } from "@/lib/supabase-admin";
import { renderBriefing, type BriefingFila } from "@/lib/briefing/email";
import { correrChequeos, enviarAlerta } from "@/lib/monitoreo/salud";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/*
 * Envío del briefing diario por correo.
 *
 * El motor de briefing ya generaba contenido todos los días; lo que faltaba
 * era que saliera de la app. Un producto que solo existe cuando lo abrís no
 * genera el hábito que lo vuelve indispensable.
 *
 * Reglas que definen el comportamiento, todas deliberadas:
 *
 *  - ES OPT-IN. Solo se envía a quien tenga `canal_email = true` en
 *    `eos_followup_preferences`, cuyo default es `false`. Nadie recibe un
 *    correo que no pidió: mandarlo sin permiso quema el canal para siempre.
 *  - UNA VEZ POR DÍA. El UNIQUE de `eos_briefing_envios` es la garantía;
 *    recibir el mismo briefing dos veces destruye la confianza en el canal.
 *  - SOLO BRIEFINGS DE HOY. Si el motor no generó el de hoy, no se manda el
 *    de ayer disfrazado de actual.
 *  - UN FALLO NO FRENA AL RESTO. Cada usuario se procesa aislado y su error
 *    queda registrado en la fila, no solo en los logs.
 *
 * Limitación conocida: el plan Hobby de Vercel permite una sola ejecución
 * diaria, así que `hora_local` de las preferencias todavía no se respeta —
 * todos reciben a la hora del cron. Cuando haya plan con cron por hora, este
 * mismo endpoint puede filtrar por `hora_local` sin más cambios.
 */

const MAX_POR_EJECUCION = 200;

function baseUrlApp() {
  const base =
    process.env.EOS_APP_BASE_URL ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    "https://www.transtech.com.py";

  return base.replace(/\/$/, "");
}

function autorizado(request: Request) {
  const esperado = process.env.CRON_SECRET;
  if (!esperado) return { ok: false, sinConfigurar: true };

  const header = request.headers.get("authorization") || "";
  const recibido = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!recibido) return { ok: false, sinConfigurar: false };

  const a = Buffer.from(recibido);
  const b = Buffer.from(esperado);
  if (a.length !== b.length) return { ok: false, sinConfigurar: false };

  return { ok: timingSafeEqual(a, b), sinConfigurar: false };
}

/** Hoy en Paraguay. El día del briefing es el del usuario, no el del servidor. */
function hoyEnParaguay() {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Asuncion",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

  return partes; // en-CA ya devuelve YYYY-MM-DD
}

export async function GET(request: Request) {
  const permiso = autorizado(request);
  if (permiso.sinConfigurar) {
    return NextResponse.json({ error: "Cron no configurado." }, { status: 503 });
  }
  if (!permiso.ok) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }

  // El chequeo de salud viaja pegado a este cron porque el plan Hobby de
  // Vercel solo permite dos crons y los dos ya están usados.
  //
  // Se agenda ACÁ, apenas pasa la autorización y antes de cualquier `return`
  // temprano: si nadie tiene el briefing activado, la función corta antes de
  // llegar al final y el chequeo nunca se ejecutaría — justo el escenario en
  // el que más falta hace, porque nadie estaría mirando.
  //
  // Va en `after()` para no demorar la respuesta, y solo avisa si algo falla.
  after(async () => {
    try {
      const base = baseUrlApp();
      const reporte = await correrChequeos(base);
      if (!reporte.sano) await enviarAlerta(reporte, base);
    } catch (error) {
      console.error("Briefing: falló el chequeo de salud posterior:", error);
    }
  });

  const apiKey = process.env.RESEND_API_KEY;
  const remitente = process.env.EOS_BRIEFING_FROM || "EOS <no-reply@transtech.com.py>";

  // Validado antes de construir el cliente: `new Resend(undefined)` lanza, y
  // un throw acá se leería como otra cosa. Misma lección que el webhook.
  if (!apiKey) {
    console.error("Briefing: falta RESEND_API_KEY.");
    return NextResponse.json({ error: "Correo no configurado." }, { status: 503 });
  }

  const resend = new Resend(apiKey);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- los tipos generados no incluyen estas tablas
  const admin: any = createAdminClient();
  const hoy = hoyEnParaguay();

  const { data: preferencias, error: prefError } = await admin
    .from("eos_followup_preferences")
    .select("usuario_id")
    .eq("canal_email", true)
    .eq("habilitado", true)
    .limit(MAX_POR_EJECUCION);

  if (prefError) {
    console.error("Briefing: no se pudieron leer las preferencias:", prefError);
    return NextResponse.json({ error: "No disponible." }, { status: 503 });
  }

  const destinatarios = (preferencias ?? []) as { usuario_id: string }[];
  if (destinatarios.length === 0) {
    return NextResponse.json({ ok: true, fecha: hoy, suscriptos: 0, enviados: 0 });
  }

  const ids = destinatarios.map((p) => p.usuario_id);

  const [{ data: briefings }, { data: perfiles }, { data: yaEnviados }] = await Promise.all([
    admin
      .from("eos_daily_briefings")
      .select(
        "usuario_id,briefing_date,saludo,titulo_dia,resumen,enfoque_dia,prioridad_1,prioridad_2,prioridad_3,recomendacion_principal,proximos_pasos,riesgos,score",
      )
      .in("usuario_id", ids)
      .eq("briefing_date", hoy)
      .eq("estado", "listo"),
    admin.from("usuarios").select("id,nombre,email").in("id", ids),
    admin
      .from("eos_briefing_envios")
      .select("usuario_id")
      .eq("briefing_date", hoy)
      .eq("canal", "email")
      .in("usuario_id", ids),
  ]);

  const porUsuario = new Map<string, BriefingFila>();
  for (const b of (briefings ?? []) as (BriefingFila & { usuario_id: string })[]) {
    porUsuario.set(b.usuario_id, b);
  }

  const perfilDe = new Map<string, { nombre: string | null; email: string | null }>();
  for (const p of (perfiles ?? []) as { id: string; nombre: string | null; email: string | null }[]) {
    perfilDe.set(p.id, { nombre: p.nombre, email: p.email });
  }

  const enviadosPrevios = new Set(
    ((yaEnviados ?? []) as { usuario_id: string }[]).map((e) => e.usuario_id),
  );

  const urlApp = `${baseUrlApp()}/eos/chat`;
  let enviados = 0;
  let omitidos = 0;
  let fallidos = 0;

  for (const usuarioId of ids) {
    if (enviadosPrevios.has(usuarioId)) {
      omitidos += 1;
      continue;
    }

    const briefing = porUsuario.get(usuarioId);
    const perfil = perfilDe.get(usuarioId);

    // Sin briefing de hoy no se manda nada: preferimos el silencio a mandar
    // el de ayer como si fuera el de hoy.
    if (!briefing || !perfil?.email) {
      omitidos += 1;
      continue;
    }

    try {
      const { asunto, html, texto } = renderBriefing(briefing, {
        nombre: perfil.nombre,
        urlApp,
      });

      const { error: envioError } = await resend.emails.send({
        from: remitente,
        to: perfil.email,
        subject: asunto,
        html,
        text: texto,
      });

      if (envioError) throw new Error(envioError.message ?? "Resend rechazó el envío.");

      // Se registra DESPUÉS de enviar: si el insert falla, el peor caso es un
      // duplicado mañana, no un usuario que nunca recibe nada.
      await admin.from("eos_briefing_envios").insert({
        usuario_id: usuarioId,
        briefing_date: hoy,
        canal: "email",
        estado: "enviado",
      });

      enviados += 1;
    } catch (error) {
      fallidos += 1;
      const detalle = error instanceof Error ? error.message : "Error desconocido";
      console.error(`Briefing: fallo enviando a ${usuarioId}:`, detalle);

      await admin
        .from("eos_briefing_envios")
        .insert({
          usuario_id: usuarioId,
          briefing_date: hoy,
          canal: "email",
          estado: "error",
          detalle: detalle.slice(0, 500),
        })
        .then(
          () => undefined,
          () => undefined,
        );
    }
  }

  return NextResponse.json({
    ok: true,
    fecha: hoy,
    suscriptos: ids.length,
    enviados,
    omitidos,
    fallidos,
  });
}
