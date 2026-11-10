import { timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";

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

export async function GET(request: Request) {
  const permiso = autorizado(request);
  if (permiso.sinConfigurar) {
    return NextResponse.json({ error: "Cron no configurado." }, { status: 503 });
  }
  if (!permiso.ok) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
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
