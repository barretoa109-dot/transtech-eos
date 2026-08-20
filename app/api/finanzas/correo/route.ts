import { after } from "next/server";
import { Resend } from "resend";

import { createAdminClient } from "@/lib/supabase-admin";
import {
  CONFIANZA_MINIMA_CORREO,
  extraerDeCorreo,
  type MovimientoDeCorreo,
} from "@/lib/finanzas/extraerDeCorreo";

export const dynamic = "force-dynamic";

/**
 * Webhook de Resend: llegó un correo al buzón de ingesta de un usuario.
 *
 * Es la pieza que hace realidad el principio 1 de la doctrina ("cero carga
 * manual"): el usuario configura una regla de reenvío en su correo una sola
 * vez y a partir de ahí los avisos del banco entran a EOS solos.
 *
 * Dos decisiones heredadas de errores propios del proyecto:
 *
 * 1. Se responde 200 ANTES de hacer nada pesado, y el trabajo real va en
 *    `after()`. Es exactamente la lección del webhook de Bancard: llamar a la
 *    API del proveedor desde adentro del webhook que ese proveedor está
 *    esperando causó un deadlock de re-entrancia. Acá además evita que un
 *    reintento de Resend duplique trabajo.
 *
 * 2. El cuerpo del correo NO se persiste. Son avisos bancarios: traen saldos,
 *    números de cuenta y datos de terceros. Guardamos el importe extraído y
 *    metadatos mínimos; el original vive en Resend 30 días.
 */

type EmailRecibido = {
  type?: string;
  data?: {
    email_id?: string;
    from?: string;
    to?: string[];
    received_for?: string[];
    subject?: string;
    created_at?: string;
  };
};

export async function POST(request: Request) {
  const crudo = await request.text();

  const secreto = process.env.RESEND_WEBHOOK_SECRET;
  if (!secreto) {
    console.error("Correo: falta RESEND_WEBHOOK_SECRET, se rechaza el webhook.");
    return Response.json({ error: "No configurado." }, { status: 503 });
  }

  // Sin firma válida no se procesa: el buzón escribe movimientos que afectan
  // el disponible real, así que aceptar un POST sin verificar sería permitir
  // que cualquiera inyecte plata falsa en la cuenta de un usuario.
  let evento: EmailRecibido;
  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    evento = resend.webhooks.verify({
      payload: crudo,
      // El SDK pide los tres campos svix sueltos, no el objeto Headers web.
      headers: {
        id: request.headers.get("svix-id") ?? "",
        timestamp: request.headers.get("svix-timestamp") ?? "",
        signature: request.headers.get("svix-signature") ?? "",
      },
      webhookSecret: secreto,
    }) as EmailRecibido;
  } catch (error) {
    console.error("Correo: firma de webhook inválida:", error);
    return Response.json({ error: "Firma inválida." }, { status: 401 });
  }

  if (evento?.type !== "email.received" || !evento.data?.email_id) {
    // Otros eventos del mismo endpoint no son un error: se ignoran en silencio.
    return Response.json({ ok: true, ignorado: true });
  }

  const { email_id: emailId, from, subject } = evento.data;

  const token = extraerToken([...(evento.data.to ?? []), ...(evento.data.received_for ?? [])]);
  if (!token) {
    console.error("Correo: no se pudo determinar el buzón destino.");
    return Response.json({ ok: true, ignorado: true });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- los tipos generados no incluyen las tablas del buzón todavía
  const admin: any = createAdminClient();

  const { data: buzonCrudo, error: buzonError } = await admin
    .from("eos_finanzas_buzon")
    .select("usuario_id, activo")
    .eq("token", token)
    .maybeSingle();

  const buzon = buzonCrudo as { usuario_id: string; activo: boolean } | null;

  if (buzonError) {
    console.error("Correo: no se pudo resolver el buzón:", buzonError);
    return Response.json({ error: "No disponible." }, { status: 503 });
  }

  // Buzón inexistente o desactivado: 200 igual, para que Resend no reintente
  // eternamente un correo que nunca vamos a poder atribuir.
  if (!buzon || !buzon.activo) {
    return Response.json({ ok: true, ignorado: true });
  }

  // Reclamar el correo ANTES de procesarlo. El UNIQUE sobre email_id es la
  // idempotencia: si Resend reintenta, el insert falla y no se duplica nada.
  const { error: reclamoError } = await admin.from("eos_correos_entrantes").insert({
    usuario_id: buzon.usuario_id,
    email_id: emailId,
    remitente: from ?? null,
    asunto: subject ?? null,
    estado: "procesado",
  });

  if (reclamoError) {
    // 23505 = unique_violation: ya lo procesamos, todo bien.
    if ((reclamoError as { code?: string }).code === "23505") {
      return Response.json({ ok: true, idempotente: true });
    }
    console.error("Correo: no se pudo registrar el correo entrante:", reclamoError);
    return Response.json({ error: "No disponible." }, { status: 503 });
  }

  after(async () => {
    await procesar({ emailId, usuarioId: buzon.usuario_id, from: from ?? null, subject: subject ?? null });
  });

  return Response.json({ ok: true });
}

/**
 * Descarga el correo, extrae los movimientos y los guarda.
 *
 * Corre después de responderle a Resend, así que ningún error de acá puede
 * provocar un reintento: se registra el estado en la fila del correo y listo.
 */
async function procesar(args: {
  emailId: string;
  usuarioId: string;
  from: string | null;
  subject: string | null;
}) {
  const { emailId, usuarioId } = args;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- los tipos generados no incluyen las tablas del buzón todavía
  const admin: any = createAdminClient();

  try {
    const respuesta = await fetch(`https://api.resend.com/emails/receiving/${emailId}`, {
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
      cache: "no-store",
    });

    if (!respuesta.ok) {
      throw new Error(`Resend devolvió ${respuesta.status} al leer el correo.`);
    }

    const correo = (await respuesta.json()) as {
      subject?: string | null;
      text?: string | null;
      html?: string | null;
      from?: string | null;
      created_at?: string | null;
    };

    const movimientos = extraerDeCorreo({
      asunto: correo.subject ?? args.subject,
      texto: correo.text ?? null,
      html: correo.html ?? null,
      remitente: correo.from ?? args.from,
      recibidoEn: correo.created_at ?? new Date().toISOString(),
    });

    // Solo entra lo que EOS leyó con confianza. Perderse un movimiento es un
    // problema que el usuario nota; un importe mal leído, no — y decide con él.
    const confiables = movimientos.filter((m) => m.confianza >= CONFIANZA_MINIMA_CORREO);

    if (confiables.length > 0) {
      const { error: insertError } = await admin
        .from("eos_movimientos_financieros")
        .insert(confiables.map((m) => aFila(m, usuarioId, emailId)));

      if (insertError) throw insertError;
    }

    await admin
      .from("eos_correos_entrantes")
      .update({
        movimientos_detectados: confiables.length,
        estado: confiables.length > 0 ? "procesado" : "sin_movimientos",
      })
      .eq("email_id", emailId);

    await admin.rpc("eos_finanzas_registrar_correo_v53", { p_usuario_id: usuarioId }).then(
      () => undefined,
      // El contador del buzón es cosmético: que falle no invalida la ingesta.
      (error: unknown) => console.error("Correo: no se pudo actualizar el contador:", error),
    );
  } catch (error) {
    console.error("Correo: fallo procesando el correo entrante:", error);
    await admin
      .from("eos_correos_entrantes")
      .update({ estado: "error" })
      .eq("email_id", emailId);
  }
}

function aFila(movimiento: MovimientoDeCorreo, usuarioId: string, emailId: string) {
  return {
    usuario_id: usuarioId,
    tipo: movimiento.tipo,
    monto: movimiento.monto,
    moneda: movimiento.moneda,
    descripcion: movimiento.descripcion,
    fecha: movimiento.fecha,
    origen: "correo",
    metadata: {
      email_id: emailId,
      confianza: movimiento.confianza,
      evidencia: movimiento.evidencia,
    },
  };
}

/**
 * Saca el token del destinatario.
 *
 * Las direcciones son `eos-<token>@<dominio de ingesta>`. Se contempla el
 * sufijo con `+` porque algunos clientes de correo lo agregan al reenviar.
 */
function extraerToken(destinatarios: string[]): string | null {
  for (const crudo of destinatarios) {
    const direccion = crudo.includes("<") ? (crudo.match(/<([^>]+)>/)?.[1] ?? crudo) : crudo;
    const local = direccion.split("@")[0]?.trim().toLowerCase();
    if (!local) continue;

    const sinSufijo = local.split("+")[0];
    if (!sinSufijo.startsWith("eos-")) continue;

    const token = sinSufijo.slice(4);
    if (/^[a-f0-9]{16,64}$/.test(token)) return token;
  }

  return null;
}
