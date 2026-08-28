import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { correrChequeos } from "@/lib/monitoreo/salud";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * El mismo reporte de salud, para la pantalla de administración.
 *
 * ============================================================
 * POR QUÉ NO ALCANZA CON EL ENDPOINT QUE YA HABÍA
 * ============================================================
 *
 * `/api/internal/salud` existe para un monitor externo: contesta 200 o 503 y,
 * con el secreto del cron, el detalle. Sirve para que algo automático avise.
 *
 * Pero el secreto del cron no se le da a una persona para que mire cómo viene
 * el sistema: se pega en un servicio y se olvida. Repartirlo entre quienes
 * quieran ver el panel es convertir una clave de servicio en una contraseña
 * compartida, que es exactamente como se filtran.
 *
 * Así que la pantalla entra por sesión y por la lista de administradores, igual
 * que el panel de pagos. Mismo reporte, distinta puerta.
 */

function correosAdministradores() {
  return (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

function baseUrlApp() {
  const base =
    process.env.EOS_APP_BASE_URL ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    "https://www.transtech.com.py";

  return base.replace(/\/$/, "");
}

export async function GET() {
  const supabase = await createClient();

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  const email = user?.email?.toLowerCase() || "";

  if (error || !user || !email || !correosAdministradores().includes(email)) {
    /*
     * 404 y no 403.
     *
     * Un 403 confirma que la pantalla existe, y eso es información que sólo le
     * sirve a quien está probando puertas. Para quien no es administrador, esta
     * dirección simplemente no existe.
     */
    return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  }

  const reporte = await correrChequeos(baseUrlApp());

  return NextResponse.json(reporte, {
    headers: { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" },
  });
}
