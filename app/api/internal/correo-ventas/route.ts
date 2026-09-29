import { claveCorreoVentas, REMITENTE_VENTAS, validarPedidoCorreoVentas } from "@/lib/email/correo-ventas";
import { autorizadoComoWorker } from "@/lib/seguridad/worker-bearer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Manda la respuesta de ventas@ que armó el flujo de correo de n8n.
 *
 * Por qué existe y qué no deja hacer: `lib/email/correo-ventas.ts`.
 */
export async function POST(request: Request) {
  const autorizacion = autorizadoComoWorker(request);
  if (autorizacion.unavailable) {
    return Response.json({ ok: false, error: "Falta EOS_WORKER_GATE_SECRET en el servidor." }, { status: 503 });
  }
  if (!autorizacion.ok) {
    return Response.json({ ok: false, error: "No autorizado." }, { status: 401 });
  }

  const cuerpo = await request.json().catch(() => null);
  const validacion = validarPedidoCorreoVentas(cuerpo);
  if (!validacion.ok) {
    return Response.json({ ok: false, error: validacion.error }, { status: 400 });
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return Response.json({ ok: false, error: "Correo no configurado." }, { status: 503 });
  }

  const { pedido } = validacion;
  const { Resend } = await import("resend");
  const { data, error } = await new Resend(apiKey).emails.send(
    {
      from: REMITENTE_VENTAS,
      to: pedido.to,
      subject: pedido.subject,
      html: pedido.html,
      replyTo: "ventas@transtech.com.py",
    },
    { idempotencyKey: claveCorreoVentas(pedido) },
  );

  if (error) {
    console.error("Correo de ventas: Resend no lo aceptó:", error.message);
    return Response.json({ ok: false, error: error.message }, { status: 502 });
  }

  return Response.json({ ok: true, id: data?.id ?? null });
}
