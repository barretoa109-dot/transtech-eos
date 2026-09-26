import { adminSinTipos } from "../supabase/sin-tipos.ts";
import { UMBRAL_COSTO_PYG, aGuaranies, formatearGs, umbralCosto } from "./umbral-costo.ts";

/**
 * Aviso interno cuando una cuenta lleva consumidos Gs. 70.000 de IA en el mes.
 *
 * Es el aviso antes de la pérdida: EOS Conversacional cuesta Gs. 80.000 por
 * mes (ver `umbral-costo.ts`). Hasta el 26/09/2026 contaba mensajes (400), pero
 * lo que da pérdida es la plata, y dos mensajes no cuestan lo mismo: uno con
 * una foto cuesta un orden de magnitud más que un "hola".
 *
 * Vale para toda cuenta real, con cualquier plan. Sale una vez por cuenta y
 * por mes: en el momento en que el mensaje la hace pasar el umbral
 * (`procesar-mensaje.ts`) y, como respaldo, en el cron diario.
 *
 * NUNCA se le muestra ni se le menciona a la persona, y no corta nada.
 */

export type CuentaUsoAlto = {
  usuario_id: string;
  email: string | null;
  plan: string;
  mensajes: number;
  costo_usd: number;
};

/**
 * Las cuentas que llegaron al umbral. Con `soloNuevas`, las que aún no se
 * avisaron este mes; con `usuarioId`, solo esa.
 */
export async function cuentasConUsoAlto(soloNuevas: boolean, usuarioId?: string): Promise<CuentaUsoAlto[]> {
  const umbral = umbralCosto();

  const { data, error } = await adminSinTipos().rpc("eos_uso_sobre_costo_v201", {
    p_umbral_usd: umbral.usd,
    p_mensajes_sin_costo: umbral.mensajesSinCosto,
    p_solo_nuevas: soloNuevas,
    p_usuario_id: usuarioId ?? null,
  });

  if (error) throw new Error(error.message);

  return Array.isArray(data) ? (data as CuentaUsoAlto[]) : [];
}

/** El texto de una línea: lo usa el chequeo de salud (informativo) y el correo. */
export function describirCuenta(c: CuentaUsoAlto): string {
  const costo =
    c.costo_usd > 0
      ? `${formatearGs(aGuaranies(c.costo_usd))} de consumo (USD ${c.costo_usd})`
      : "sin costo registrado";
  return `${c.email ?? c.usuario_id} · ${costo} · ${c.mensajes} mensajes · plan ${c.plan}`;
}

export function redactarAvisoUsoAlto(cuentas: CuentaUsoAlto[], baseUrl: string) {
  const umbral = formatearGs(UMBRAL_COSTO_PYG);
  const una = cuentas.length === 1;
  const lineas = cuentas.map((c) => `• ${describirCuenta(c)}`);
  const titulo = `${una ? "Una cuenta llegó" : `${cuentas.length} cuentas llegaron`} a ${umbral} de consumo de IA este mes`;
  const cierre =
    "Es el aviso antes de que la cuenta dé pérdida. No se le cortó nada a nadie ni se les avisó: " +
    "siguen conversando con normalidad. Esto es solo para que decidan si hay que hacer algo con esa cuenta.";

  const texto = [`${titulo}:`, "", ...lineas, "", cierre, "", baseUrl].join("\n");

  const html = `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#0f172a">
<p style="margin:0 0 14px"><strong>${titulo}:</strong></p>
<ul style="list-style:disc outside;padding-left:20px;margin:0 0 16px">
${cuentas.map((c) => `<li style="margin-bottom:6px">${describirCuenta(c).replace(/&/g, "&amp;").replace(/</g, "&lt;")}</li>`).join("")}
</ul>
<p style="margin:0;font-size:13px;color:#64748b">${cierre}</p>
</div>`;

  return {
    asunto: `EOS · ${una ? "una cuenta llegó" : `${cuentas.length} cuentas llegaron`} a ${umbral} de consumo`,
    texto,
    html,
  };
}

/**
 * Manda el aviso por correo y, solo si salió, anota que ya se avisó.
 *
 * Anotar DESPUÉS de mandar es a propósito: si el correo falla, el aviso se
 * reintenta en la próxima corrida en vez de perderse. Con `usuarioId` mira solo
 * esa cuenta: es lo que corre después de cada mensaje. Devuelve cuántas
 * cuentas se avisaron.
 */
export async function avisarUsoAlto(baseUrl: string, usuarioId?: string): Promise<number> {
  const cuentas = await cuentasConUsoAlto(true, usuarioId);
  if (cuentas.length === 0) return 0;

  const apiKey = process.env.RESEND_API_KEY;
  const destinos = (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((correo) => correo.trim())
    .filter(Boolean);

  if (!apiKey || destinos.length === 0) {
    console.error(
      "Uso alto: hay cuentas sobre el umbral pero no se puede avisar (falta RESEND_API_KEY o ADMIN_EMAILS).",
      cuentas.map(describirCuenta),
    );
    return 0;
  }

  const { Resend } = await import("resend");
  const { asunto, html, texto } = redactarAvisoUsoAlto(cuentas, baseUrl);

  const { error } = await new Resend(apiKey).emails.send({
    from: process.env.EOS_BRIEFING_FROM || "EOS <no-reply@transtech.com.py>",
    to: destinos,
    subject: asunto,
    html,
    text: texto,
  });

  if (error) throw new Error(`Resend: ${error.message}`);

  const marcadas = await adminSinTipos().rpc("eos_marcar_costo_avisado_v201", {
    p_usuarios: cuentas.map((c) => c.usuario_id),
  });

  if (marcadas.error) throw new Error(marcadas.error.message);

  return cuentas.length;
}
