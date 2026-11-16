import { timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";

import { enviarCorreoSimple } from "@/lib/email/enviar-simple";
import { enviarConfirmacionPlan } from "@/lib/email/transaccionales";
import { barrerTransferencias, configDelAgente } from "@/lib/pagos/agente-transferencias";
import { adminSinTipos } from "@/lib/supabase/sin-tipos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/*
 * El reloj del agente de transferencias.
 *
 * La pantalla de espera de quien pagó ya dispara la aprobación automática cada
 * vez que consulta (`/api/pagos/consultar`). Esto cubre el otro caso: la
 * persona subió el comprobante y cerró la pestaña. Un workflow de GitHub
 * Actions (`.github/workflows/pagos-transferencia.yml`) lo llama cada diez
 * minutos con el `CRON_SECRET` de siempre.
 *
 * No es un cron de Vercel: el plan Hobby solo permite dos, y los dos están
 * usados.
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

export async function GET(request: Request) {
  const permiso = autorizado(request);
  if (permiso.sinConfigurar) return NextResponse.json({ error: "Cron no configurado." }, { status: 503 });
  if (!permiso.ok) return NextResponse.json({ error: "No autorizado." }, { status: 401 });

  const admin = adminSinTipos();
  const config = configDelAgente();
  const resumen = await barrerTransferencias(admin, {
    enviarCorreo: enviarCorreoSimple(),
    baseUrl: new URL(request.url).origin,
  });

  for (const activada of resumen.activadas) {
    if (!activada.usuarioId || !activada.planCodigo || !activada.solicitudId) continue;
    try {
      await enviarConfirmacionPlan(admin, {
        usuarioId: activada.usuarioId,
        planCodigo: activada.planCodigo,
        // El id del pedido: es lo que evita mandar dos veces la misma confirmación.
        referencia: activada.solicitudId,
        renovacion: false,
      });
    } catch (error) {
      console.error("Pagos: no se pudo confirmar por correo una activación automática:", error);
    }
  }

  // Solo contadores: ni nombres ni montos, el log de Actions es público.
  return NextResponse.json(
    { autoaprueba: config.autoaprueba, espera_min: config.esperaMin, revisadas: resumen.revisadas, activadas: resumen.activadas.length },
    { headers: { "Cache-Control": "no-store" } },
  );
}
