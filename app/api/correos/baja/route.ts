import { NextResponse } from "next/server";

import { tokenDeBajaValido } from "@/lib/email/baja";
import { escaparHtml } from "@/lib/email/marca";
import { MOTIVO_BAJA } from "@/lib/email/motivacionales";
import { adminSinTipos } from "@/lib/supabase/sin-tipos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
 * Baja de los correos motivacionales, desde el enlace del propio correo.
 *
 * No pide sesión: quien hace clic puede estar en otro dispositivo o no
 * recordar con qué cuenta se registró. La puerta es el token firmado (ver
 * `lib/email/baja`), no una cookie.
 *
 * GET NO DA DE BAJA. Muestra una confirmación con un botón que hace POST. Los
 * antivirus y los clientes de correo abren los enlaces para inspeccionarlos, y
 * una baja por GET le apagaría el correo a gente que nunca hizo clic.
 * El POST también atiende la baja de un clic de los clientes de correo
 * (cabecera `List-Unsubscribe-Post`, RFC 8058), que llaman a esta misma URL.
 */

function pagina(titulo: string, mensaje: string, formulario = "", estado = 200) {
  const html = `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>${escaparHtml(titulo)} · EOS</title></head>
<body style="margin:0;padding:32px 16px;background:#eef5ff;font-family:Arial,Helvetica,sans-serif;color:#071226;">
  <div style="max-width:480px;margin:40px auto;border:1px solid #dbeafe;border-radius:24px;background:#fff;overflow:hidden;">
    <div style="padding:24px 28px;background:#071226;color:#fff;">
      <div style="font-size:11px;font-weight:800;letter-spacing:2px;color:#93c5fd;">TRANSTECH EOS</div>
      <h1 style="margin:8px 0 0;font-size:22px;">${escaparHtml(titulo)}</h1>
    </div>
    <div style="padding:26px 28px;">
      <p style="margin:0 0 18px;color:#334155;line-height:1.7;font-size:15px;">${escaparHtml(mensaje)}</p>
      ${formulario}
    </div>
  </div>
</body></html>`;

  return new NextResponse(html, {
    status: estado,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function leerEnlace(request: Request) {
  const url = new URL(request.url);
  const usuarioId = url.searchParams.get("u") || "";
  const token = url.searchParams.get("t") || "";
  const secreto = process.env.CRON_SECRET || "";

  return { usuarioId, token, secreto, valido: tokenDeBajaValido(usuarioId, MOTIVO_BAJA, token, secreto) };
}

export async function GET(request: Request) {
  const { secreto, valido } = leerEnlace(request);

  if (!secreto) return pagina("No disponible", "Probá de nuevo en unos minutos.", "", 503);
  if (!valido) {
    return pagina("Enlace no válido", "Este enlace de baja no es válido o está incompleto.", "", 400);
  }

  const formulario = `<form method="post" action="${escaparHtml(new URL(request.url).pathname + new URL(request.url).search)}">
    <button type="submit" style="padding:13px 24px;border:0;border-radius:999px;background:#2563eb;color:#fff;font-size:14px;font-weight:800;cursor:pointer;">Darme de baja</button>
  </form>`;

  return pagina(
    "¿Dejar de recibir estos correos?",
    "Dejarás de recibir los correos motivacionales de EOS. Los avisos de tu cuenta, como pagos o vencimientos, no cambian.",
    formulario,
  );
}

export async function POST(request: Request) {
  const { usuarioId, secreto, valido } = leerEnlace(request);

  if (!secreto) return pagina("No disponible", "Probá de nuevo en unos minutos.", "", 503);
  if (!valido) {
    return pagina("Enlace no válido", "Este enlace de baja no es válido o está incompleto.", "", 400);
  }

  const { error } = await adminSinTipos()
    .from("eos_followup_preferences")
    .upsert(
      { usuario_id: usuarioId, correos_motivacionales: false, updated_at: new Date().toISOString() },
      { onConflict: "usuario_id" },
    );

  // 23503: la cuenta ya no existe, así que no queda nada a lo que darle de baja.
  if (error && (error as { code?: string }).code !== "23503") {
    console.error("No se pudo registrar la baja de motivacionales:", error);
    return pagina("No pudimos darte de baja", "Probá de nuevo en unos minutos.", "", 500);
  }

  return pagina(
    "Listo, quedaste de baja",
    "No vas a recibir más correos motivacionales de EOS. Si cambiás de idea, podés volver a activarlos desde la pestaña Briefing de EOS.",
  );
}
