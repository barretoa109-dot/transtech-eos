import type { ClienteSinTipos } from "../supabase/sin-tipos.ts";

/**
 * El correo a quien pagó, cuando su comprobante no se pudo verificar.
 *
 * Sale en dos momentos:
 *
 *   · "en_revision": el agente leyó el comprobante y algo no coincide. Todavía
 *     no es un rechazo —lo va a mirar una persona—, pero quien pagó merece
 *     saberlo ya, y saber qué, en vez de quedarse mirando "en verificación".
 *   · "rechazado": el dueño lo rechazó desde el panel (el comprobante no sirve,
 *     o la transferencia no se acreditó en la cuenta).
 *
 * Dice QUÉ se encontró, con las mismas frases que ve el dueño. No acusa: una
 * captura cortada y una captura trucha se ven igual desde acá, y a la primera
 * persona no se la puede tratar como a la segunda.
 */

export type EnviarCorreo = (args: { para: string; asunto: string; texto: string }) => Promise<void>;

export type MomentoDelAviso = "en_revision" | "rechazado";

export const MOTIVO_NO_ACREDITADA = "No vimos acreditada la transferencia en nuestra cuenta bancaria.";

/** El texto del correo. Pura. */
export function redactarCorreoNoVerificado(args: {
  nombre: string | null;
  referencia: string;
  motivos: string[];
  momento: MomentoDelAviso;
}): { asunto: string; texto: string } {
  const saludo = args.nombre?.trim() ? `Hola, ${args.nombre.trim().split(/\s+/)[0]}:` : "Hola:";
  const motivos = args.motivos.length > 0 ? args.motivos : ["No pudimos confirmar los datos del comprobante."];

  const apertura =
    args.momento === "rechazado"
      ? `Revisamos el comprobante que subiste para el pedido ${args.referencia} y no pudimos aprobar el pago. Tu plan no fue activado.`
      : `Recibimos el comprobante que subiste para el pedido ${args.referencia}, pero al revisarlo encontramos algo que no coincide. Una persona de nuestro equipo lo va a mirar también; mientras tanto, tu plan todavía no está activo.`;

  return {
    asunto:
      args.momento === "rechazado" ? "No pudimos aprobar tu pago de EOS" : "Tu comprobante de EOS necesita una revisión",
    texto: [
      saludo,
      "",
      apertura,
      "",
      "Esto es lo que encontramos:",
      ...motivos.map((m) => `  · ${m}`),
      "",
      "Qué podés hacer:",
      "  · Si subiste un comprobante equivocado o incompleto, generá un pedido nuevo desde la página de planes y subí el correcto. Tiene que verse la cuenta de destino, el titular, el monto exacto y la fecha.",
      "  · Si hiciste la transferencia y creés que es un error, respondé a soporte@transtech.com.py con el comprobante original y lo revisamos.",
      "",
      "Si la transferencia llegó a nuestra cuenta y no activamos el plan que pediste, te devolvemos la totalidad del monto en un plazo máximo de 24 horas.",
      "",
      "— El equipo de TransTech EOS",
    ].join("\n"),
  };
}

/** Manda el correo a quien hizo el pedido. Nunca lanza; devuelve si salió. */
export async function avisarComprobanteNoVerificado(
  admin: ClienteSinTipos,
  args: { usuarioId: string; referencia: string; motivos: string[]; momento: MomentoDelAviso },
  enviarCorreo: EnviarCorreo | undefined,
): Promise<boolean> {
  if (!enviarCorreo) return false;

  try {
    const { data } = await admin.from("usuarios").select("nombre,email").eq("id", args.usuarioId).maybeSingle();
    const perfil = data as { nombre?: string | null; email?: string | null } | null;
    const email = (perfil?.email ?? "").trim();
    if (!email) return false;

    const correo = redactarCorreoNoVerificado({
      nombre: perfil?.nombre ?? null,
      referencia: args.referencia,
      motivos: args.motivos,
      momento: args.momento,
    });
    await enviarCorreo({ para: email, asunto: correo.asunto, texto: correo.texto });
    return true;
  } catch (error) {
    console.error("Pagos: no se pudo avisar a la persona que su comprobante no se verificó:", error);
    return false;
  }
}
