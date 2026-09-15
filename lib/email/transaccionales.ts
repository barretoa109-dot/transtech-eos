import { Resend } from "resend";
import type { ClienteSinTipos } from "@/lib/supabase/sin-tipos";
import { envolverEmailDeMarca, primerNombre } from "@/lib/email/marca";

/**
 * Emails de bienvenida y confirmación de plan.
 *
 * Los dos comparten la misma forma: reclamar la fila en
 * `eos_emails_transaccionales_v164` ANTES de mandar (así dos llamadas al
 * mismo evento no mandan dos correos — ver esa migración) y, recién si la
 * reclama, mandar por Resend. Si Resend falla después de reclamada, se
 * pierde ese envío en vez de arriesgar un duplicado: para un correo de
 * cortesía como estos, es el lado seguro para equivocarse.
 */

const TABLA = "eos_emails_transaccionales_v164";
const REMITENTE = process.env.EOS_TRANSACCIONAL_FROM || "EOS <no-reply@transtech.com.py>";
const APP_URL = (process.env.EOS_APP_BASE_URL || "https://www.transtech.com.py").replace(/\/+$/, "");

async function reclamarEnvio(
  admin: ClienteSinTipos,
  usuarioId: string,
  tipo: "bienvenida" | "plan",
  referencia: string,
): Promise<boolean> {
  const { error } = await admin
    .from(TABLA)
    .insert({ usuario_id: usuarioId, tipo, referencia });

  if (!error) return true;

  // 23505: unique_violation — ya se mandó este email para este evento.
  if ((error as { code?: string }).code === "23505") return false;

  console.error(`No se pudo reclamar el envío de email '${tipo}':`, error);
  return false;
}

async function datosDeUsuario(admin: ClienteSinTipos, usuarioId: string) {
  const { data, error } = await admin
    .from("usuarios")
    .select("nombre, email")
    .eq("id", usuarioId)
    .maybeSingle();

  if (error || !data?.email) return null;
  return data as { nombre: string | null; email: string };
}

async function mandar(asunto: string, destinatario: string, html: string, contexto: string) {
  const clave = process.env.RESEND_API_KEY;
  if (!clave) {
    console.error(`Falta RESEND_API_KEY: no se pudo mandar el email de ${contexto}.`);
    return;
  }

  try {
    await new Resend(clave).emails.send({
      from: REMITENTE,
      to: destinatario,
      subject: asunto,
      html,
    });
  } catch (error) {
    console.error(`No se pudo mandar el email de ${contexto}:`, error);
  }
}

/**
 * Email de bienvenida. Se llama al confirmar/crear la sesión de una cuenta
 * recién nacida — ver `app/auth/callback` y `app/api/auth/bienvenida`. A lo
 * sumo uno por cuenta, para siempre (`referencia` vacía).
 */
export async function enviarBienvenida(admin: ClienteSinTipos, usuarioId: string): Promise<void> {
  const puede = await reclamarEnvio(admin, usuarioId, "bienvenida", "");
  if (!puede) return;

  const usuario = await datosDeUsuario(admin, usuarioId);
  if (!usuario) return;

  const nombre = primerNombre(usuario.nombre);
  const saludo = nombre ? `Hola ${nombre},` : "Hola,";

  const html = envolverEmailDeMarca({
    titulo: "Bienvenido a EOS",
    parrafos: [
      `${saludo} gracias por crear tu cuenta en TransTech EOS.`,
      "EOS es la IA que lleva tu negocio y tus finanzas personales: le contás lo que pasó —una venta, un gasto, un cliente nuevo— en tu idioma, y ella se encarga de clasificarlo, guardarlo y mantener tus números al día. Vos revisás y decidís; el trabajo manual lo hace EOS.",
      "Para arrancar no hace falta ningún formulario: abrí el chat y contale algo real de tu día, por ejemplo \"gasté 50 mil en el almuerzo\" o \"vendí 2 unidades a 100 mil cada una\".",
    ],
    ctaTexto: "Abrir EOS",
    ctaUrl: `${APP_URL}/eos`,
    notaFinal: "Si no creaste esta cuenta, podés ignorar este correo.",
  });

  await mandar(`Bienvenido a EOS, ${nombre || "che"}`, usuario.email, html, "bienvenida");
}

/**
 * Email de confirmación de plan. Se llama desde cada punto que activa un
 * plan pago (transferencia, Bancard, aprobación manual) — nunca desde la
 * base, porque SQL no manda correo. `referencia` es el id de la
 * `solicitudes_pago` que lo activó: una renovación con solicitud nueva
 * manda su propio correo; un reintento del mismo evento no manda otro.
 */
export async function enviarConfirmacionPlan(
  admin: ClienteSinTipos,
  parametros: {
    usuarioId: string;
    planCodigo: string;
    referencia: string;
    renovacion?: boolean;
  },
): Promise<void> {
  const { usuarioId, planCodigo, referencia, renovacion = false } = parametros;

  const puede = await reclamarEnvio(admin, usuarioId, "plan", referencia);
  if (!puede) return;

  const usuario = await datosDeUsuario(admin, usuarioId);
  if (!usuario) return;

  const { data: plan } = await admin
    .from("planes")
    .select("nombre")
    .eq("codigo", planCodigo)
    .maybeSingle();

  const nombrePlan = (plan?.nombre as string | undefined) || planCodigo;
  const nombre = primerNombre(usuario.nombre);
  const saludo = nombre ? `Hola ${nombre},` : "Hola,";

  const html = envolverEmailDeMarca({
    titulo: renovacion ? `Renovamos tu plan ${nombrePlan}` : `Tu plan ${nombrePlan} ya está activo`,
    parrafos: [
      renovacion
        ? `${saludo} confirmamos el cobro y tu plan <strong>${nombrePlan}</strong> se renovó sin que tengas que hacer nada.`
        : `${saludo} gracias por confiar en EOS. Confirmamos tu pago y tu plan <strong>${nombrePlan}</strong> ya está funcionando en tu cuenta.`,
      "Podés ver el detalle de lo que incluye, y cambiarlo cuando quieras, desde tu perfil.",
    ],
    ctaTexto: "Ir a EOS",
    ctaUrl: `${APP_URL}/eos`,
  });

  await mandar(
    renovacion ? `Renovamos tu plan ${nombrePlan}` : `Tu plan ${nombrePlan} está activo`,
    usuario.email,
    html,
    "confirmación de plan",
  );
}
