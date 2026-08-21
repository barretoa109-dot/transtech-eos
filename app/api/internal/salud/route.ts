import { timingSafeEqual } from "crypto";

import { correrChequeos, enviarAlerta } from "@/lib/monitoreo/salud";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Chequeo de salud de EOS.
 *
 * Dos formas de usarlo:
 *
 *  - `GET /api/internal/salud` sin nada: devuelve 200 si todo está sano y 503
 *    si algo falla. Pensado para un monitor externo gratuito (UptimeRobot y
 *    similares) que lo consulte cada pocos minutos. Esa es la única manera de
 *    enterarse en minutos y no en un día.
 *  - `GET` con `Authorization: Bearer <CRON_SECRET>` y `?avisar=1`: además
 *    manda un correo si hay algo roto. Lo usa el cron diario.
 *
 * El detalle de los chequeos solo se muestra con el secreto. Sin él, la
 * respuesta es únicamente sano/no sano: la lista de qué está roto le sirve
 * más a un atacante que a un monitor.
 */

function autorizado(request: Request) {
  const esperado = process.env.CRON_SECRET;
  if (!esperado) return false;

  const header = request.headers.get("authorization") || "";
  const recibido = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!recibido) return false;

  const a = Buffer.from(recibido);
  const b = Buffer.from(esperado);
  if (a.length !== b.length) return false;

  return timingSafeEqual(a, b);
}

function baseUrlApp() {
  const base =
    process.env.EOS_APP_BASE_URL ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    "https://www.transtech.com.py";
  return base.replace(/\/$/, "");
}

export async function GET(request: Request) {
  const baseUrl = baseUrlApp();
  const conDetalle = autorizado(request);
  const avisar = new URL(request.url).searchParams.get("avisar") === "1";

  const reporte = await correrChequeos(baseUrl);

  // El correo solo sale con secreto y cuando hay algo roto. Silencio = sano:
  // una alerta que casi siempre dice "todo bien" se ignora a las dos semanas.
  if (conDetalle && avisar && !reporte.sano) {
    await enviarAlerta(reporte, baseUrl);
  }

  const cuerpo = conDetalle
    ? reporte
    : { sano: reporte.sano, verificado_en: reporte.verificado_en };

  // 503 cuando algo está roto: es lo que un monitor externo entiende sin
  // tener que leer el JSON.
  return Response.json(cuerpo, {
    status: reporte.sano ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
