import { Resend } from "resend";

export type EnviarCorreoSimple = (args: { para: string; asunto: string; texto: string }) => Promise<void>;

/**
 * Un correo de texto por Resend, o `undefined` si no hay clave.
 *
 * Es lo mismo que el cron diario arma a mano en cada aviso; acá tiene nombre
 * para los avisos que salen fuera del cron (el del comprobante de pago).
 */
export function enviarCorreoSimple(env: Record<string, string | undefined> = process.env): EnviarCorreoSimple | undefined {
  const clave = (env.RESEND_API_KEY ?? "").trim();
  if (!clave) return undefined;

  return async ({ para, asunto, texto }) => {
    await new Resend(clave).emails.send({
      from: env.EOS_BRIEFING_FROM || "EOS <no-reply@transtech.com.py>",
      to: para,
      subject: asunto,
      text: texto,
    });
  };
}
