import { adminSinTipos } from "../supabase/sin-tipos.ts";

/**
 * Aviso interno de uso alto para las cuentas sin tope de mensajes.
 *
 * "EOS Conversacional" se vende sin tope y quien lo contrata nunca se queda sin
 * conversar. Pero un mensaje cuesta plata: a Gs. 60.000 al mes, unos 150 mensajes
 * cubren el costo de IA. El uso real hoy es de 27 a 68 por cuenta. Este aviso es
 * la red de seguridad: cuando una cuenta llega a `UMBRAL_USO_ALTO` mensajes en
 * el mes, le llega un correo a quien administra EOS para decidir qué hacer.
 *
 * NUNCA se le muestra ni se le menciona a la persona, y no corta nada.
 */
export const UMBRAL_USO_ALTO = 400;

export type CuentaUsoAlto = {
  usuario_id: string;
  email: string | null;
  plan: string;
  mensajes: number;
  costo_usd: number;
};

/** Lee las cuentas que llegaron al umbral. Con `soloNuevas`, las que aún no se avisaron. */
export async function cuentasConUsoAlto(soloNuevas: boolean): Promise<CuentaUsoAlto[]> {
  const { data, error } = await adminSinTipos().rpc("eos_uso_sobre_umbral_v184", {
    p_umbral: UMBRAL_USO_ALTO,
    p_solo_nuevas: soloNuevas,
  });

  if (error) throw new Error(error.message);

  return Array.isArray(data) ? (data as CuentaUsoAlto[]) : [];
}

/** El texto de una línea: lo usa el chequeo de salud (informativo) y el correo. */
export function describirCuenta(c: CuentaUsoAlto): string {
  const costo = c.costo_usd > 0 ? ` · USD ${c.costo_usd}` : "";
  return `${c.email ?? c.usuario_id} · ${c.mensajes} mensajes · plan ${c.plan}${costo}`;
}

export function redactarAvisoUsoAlto(cuentas: CuentaUsoAlto[], baseUrl: string) {
  const lineas = cuentas.map((c) => `• ${describirCuenta(c)}`);

  const texto = [
    `${cuentas.length === 1 ? "Una cuenta" : `${cuentas.length} cuentas`} sin tope de mensajes ` +
      `${cuentas.length === 1 ? "llegó" : "llegaron"} a ${UMBRAL_USO_ALTO} este mes:`,
    "",
    ...lineas,
    "",
    "No se le cortó nada a nadie ni se les avisó: siguen conversando con normalidad.",
    "Esto es solo para que decidan si hay que hacer algo con esa cuenta.",
    "",
    baseUrl,
  ].join("\n");

  const html = `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#0f172a">
<p style="margin:0 0 14px"><strong>${cuentas.length === 1 ? "Una cuenta sin tope llegó" : `${cuentas.length} cuentas sin tope llegaron`} a ${UMBRAL_USO_ALTO} mensajes este mes:</strong></p>
<ul style="list-style:disc outside;padding-left:20px;margin:0 0 16px">
${cuentas.map((c) => `<li style="margin-bottom:6px">${describirCuenta(c).replace(/&/g, "&amp;").replace(/</g, "&lt;")}</li>`).join("")}
</ul>
<p style="margin:0;font-size:13px;color:#64748b">No se le cortó nada a nadie ni se les avisó: siguen conversando con normalidad. Esto es solo para que decidan si hay que hacer algo con esa cuenta.</p>
</div>`;

  return {
    asunto: `EOS · ${cuentas.length === 1 ? "una cuenta llegó" : `${cuentas.length} cuentas llegaron`} a ${UMBRAL_USO_ALTO} mensajes`,
    texto,
    html,
  };
}

/**
 * Manda el aviso por correo y, solo si salió, anota que ya se avisó.
 *
 * Anotar DESPUÉS de mandar es a propósito: si el correo falla, el aviso se
 * reintenta en la próxima corrida en vez de perderse. Devuelve cuántas cuentas
 * se avisaron.
 */
export async function avisarUsoAlto(baseUrl: string): Promise<number> {
  const cuentas = await cuentasConUsoAlto(true);
  if (cuentas.length === 0) return 0;

  const apiKey = process.env.RESEND_API_KEY;
  const destino = process.env.ADMIN_EMAILS?.split(",")[0]?.trim();

  if (!apiKey || !destino) {
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
    to: destino,
    subject: asunto,
    html,
    text: texto,
  });

  if (error) throw new Error(`Resend: ${error.message}`);

  const marcadas = await adminSinTipos().rpc("eos_marcar_uso_avisado_v184", {
    p_usuarios: cuentas.map((c) => c.usuario_id),
    p_umbral: UMBRAL_USO_ALTO,
  });

  if (marcadas.error) throw new Error(marcadas.error.message);

  return cuentas.length;
}
