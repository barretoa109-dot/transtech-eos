import { timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";

import { claveApns } from "@/lib/push/apns";
import { cuentaDeServicio } from "@/lib/push/fcm";
import { enviarMotivacionalesPush, FRANJAS, type Franja } from "@/lib/push/motivacionales";
import { adminSinTipos } from "@/lib/supabase/sin-tipos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/*
 * Push motivacional nativo, hasta 3 veces por día.
 *
 * NO es un cron de Vercel: el plan Hobby solo permite dos, y los dos ya están
 * usados (briefing-diario, bancard-renovaciones). Un workflow de GitHub
 * Actions (`.github/workflows/push-motivacional.yml`) llama a este endpoint
 * tres veces al día, cada vez con una franja distinta en la query
 * (`?franja=manana|mediodia|noche`), con el mismo `CRON_SECRET` que ya usan
 * los otros crons.
 */

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

function franjaValida(valor: string | null): valor is Franja {
  return valor !== null && (FRANJAS as readonly string[]).includes(valor);
}

/**
 * Qué hay configurado y cuántos teléfonos hay, sin mandar nada.
 *
 * Devuelve SOLO contadores y booleanos: nunca un token, nunca una clave. Sirve
 * para distinguir "no está configurado" de "está configurado y falla", que es
 * exactamente lo que no se podía saber el 2026-11-10 (dos cuentas con
 * dispositivo y cero envíos, sin ningún error).
 */
async function diagnostico() {
  const admin = adminSinTipos();
  const { data, error } = await admin.from("dispositivos_push").select("plataforma").limit(2000);

  const porPlataforma = { ios: 0, android: 0 };
  for (const fila of (data ?? []) as { plataforma: string }[]) {
    if (fila.plataforma === "ios") porPlataforma.ios += 1;
    if (fila.plataforma === "android") porPlataforma.android += 1;
  }

  return {
    apns_configurado: Boolean(claveApns()),
    apns_entorno: process.env.APNS_ENTORNO === "sandbox" ? "sandbox" : "produccion",
    fcm_configurado: Boolean(cuentaDeServicio()),
    dispositivos: porPlataforma,
    error_leyendo_dispositivos: error ? String((error as { message?: string }).message ?? error) : null,
  };
}

export async function GET(request: Request) {
  const permiso = autorizado(request);
  if (permiso.sinConfigurar) {
    return NextResponse.json({ error: "Cron no configurado." }, { status: 503 });
  }
  if (!permiso.ok) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }

  if (new URL(request.url).searchParams.get("diagnostico") === "1") {
    return NextResponse.json(await diagnostico(), { headers: { "Cache-Control": "no-store" } });
  }

  const franja = new URL(request.url).searchParams.get("franja");
  if (!franjaValida(franja)) {
    return NextResponse.json(
      { error: `Franja inválida. Usar una de: ${FRANJAS.join(", ")}.` },
      { status: 400 },
    );
  }

  const resumen = await enviarMotivacionalesPush(adminSinTipos(), franja);

  return NextResponse.json(resumen, { headers: { "Cache-Control": "no-store" } });
}
