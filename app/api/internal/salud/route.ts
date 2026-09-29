import { timingSafeEqual } from "crypto";

import { after } from "next/server";

import { correrChequeos, enviarAlerta } from "@/lib/monitoreo/salud";
import { procesarMensajeEOS } from "@/lib/eos/procesar-mensaje";
import { reintentarEnEspera } from "@/lib/eos/en-espera";
import { entregaEnEspera } from "@/lib/eos/en-espera-entrega";
import { idDeterministico } from "@/lib/whatsapp/id-determinista";
import { adminSinTipos } from "@/lib/supabase/sin-tipos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// 300 y no 60: en `after()` corren los reintentos de los mensajes en espera,
// que llaman al modelo uno por uno (lib/eos/en-espera.ts).
export const maxDuration = 300;

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

  /*
   * Los mensajes que quedaron en espera porque la IA no respondía
   * (lib/eos/en-espera.ts). Van colgados de este chequeo porque n8n ya lo
   * llama cada 5 minutos con el secreto, y el plan Hobby de Vercel no da
   * crons más seguidos que uno por día. Solo con el secreto: un monitor
   * externo sin él no dispara nada. En `after()`, así no demora el chequeo.
   */
  if (conDetalle) {
    after(async () => {
      try {
        const admin = adminSinTipos();
        const resumen = await reintentarEnEspera(admin, {
          procesar: (usuarioId, entrada) =>
            procesarMensajeEOS(usuarioId, {
              ...entrada,
              archivos: [],
              nuevoChat: false,
              cita: null,
              requestOrigin: baseUrl,
            }),
          entregar: entregaEnEspera(admin),
          idDelIntento: idDeterministico,
        });
        if (resumen.procesados + resumen.siguen + resumen.vencidos > 0) {
          console.log("En espera: reintentos", resumen);
        }
      } catch (error) {
        console.error("En espera: falló la tanda de reintentos:", error);
      }
    });
  }

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
