import { NextResponse } from "next/server";
import { Resend } from "resend";
import { adminSinTipos } from "@/lib/supabase/sin-tipos";
import { consumirCupo, respuestaSinCupo, secretoDelEntorno } from "@/lib/seguridad/limite";

export const runtime = "nodejs";

type ContactoVentasPayload = {
  nombre?: unknown;
  email?: unknown;
  empresa?: unknown;
  telefono?: unknown;
  mensaje?: unknown;
  plan?: unknown;
  origen?: unknown;
  website?: unknown;
};

const EMAIL_DESTINO = "ventas@transtech.com.py";
const EMAIL_REMITENTE =
  process.env.VENTAS_FROM_EMAIL ||
  "TransTech EOS <ventas@transtech.com.py>";

export async function POST(request: Request) {
  try {
    if (!process.env.RESEND_API_KEY) {
      console.error("Falta RESEND_API_KEY en el servidor.");
      return NextResponse.json(
        { error: "El servicio de correo todavía no está configurado." },
        { status: 503 },
      );
    }

    const body = (await request.json()) as ContactoVentasPayload;

    // Campo invisible para bloquear bots simples.
    if (texto(body.website)) {
      return NextResponse.json({ ok: true });
    }

    const nombre = texto(body.nombre, 120);
    const email = texto(body.email, 180).toLowerCase();
    const empresa = texto(body.empresa, 160);
    const telefono = texto(body.telefono, 50);
    const mensaje = texto(body.mensaje, 2000);
    const plan = texto(body.plan, 50) || "enterprise";
    const origen = texto(body.origen, 80) || "pagina_planes";

    if (!nombre || !email) {
      return NextResponse.json(
        { error: "Nombre y correo electrónico son obligatorios." },
        { status: 400 },
      );
    }

    if (!esEmailValido(email)) {
      return NextResponse.json(
        { error: "Ingresá un correo electrónico válido." },
        { status: 400 },
      );
    }

    /*
     * El techo va acá, después de validar y ANTES de mandar el correo.
     *
     * Después de validar, para que un pedido malformado no consuma cupo y un
     * atacante no pueda gastarle el cupo a nadie con basura. Antes del correo,
     * porque el correo es lo que cuesta: cada llamada quema cuota de Resend, y
     * con ella los correos que sí importan — el briefing diario y los avisos
     * de riesgo salen por la misma cuenta.
     *
     * Cinco cada quince minutos. Nadie manda seis consultas de ventas en un
     * cuarto de hora; un bucle manda seis en un segundo.
     */
    const cupo = await consumirCupo(adminSinTipos(), {
      ruta: "/api/ventas/contacto",
      cabeceras: request.headers,
      ventanaSegundos: 900,
      maximo: 5,
      secreto: secretoDelEntorno(),
    });

    if (!cupo.permitido) {
      return respuestaSinCupo(
        cupo,
        "Recibimos varias consultas tuyas hace un momento. Esperá unos minutos y volvé a intentar.",
      );
    }

    const resend = new Resend(process.env.RESEND_API_KEY);

    const asunto = empresa
      ? `Nueva consulta EOS Enterprise — ${empresa}`
      : `Nueva consulta EOS Enterprise — ${nombre}`;

    const { data, error } = await resend.emails.send({
      from: EMAIL_REMITENTE,
      to: [EMAIL_DESTINO],
      replyTo: email,
      subject: asunto,
      text: crearTexto({
        nombre,
        email,
        empresa,
        telefono,
        mensaje,
        plan,
        origen,
      }),
      html: crearHtml({
        nombre,
        email,
        empresa,
        telefono,
        mensaje,
        plan,
        origen,
      }),
    });

    if (error) {
      console.error("Resend no pudo enviar el correo:", error);
      return NextResponse.json(
        { error: "No se pudo entregar la solicitud a ventas." },
        { status: 502 },
      );
    }

    return NextResponse.json({
      ok: true,
      emailId: data?.id || null,
    });
  } catch (error) {
    console.error("Error inesperado en contacto de ventas:", error);

    return NextResponse.json(
      { error: "No se pudo procesar la solicitud." },
      { status: 500 },
    );
  }
}

function texto(value: unknown, maxLength = 500) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLength);
}

function esEmailValido(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function escaparHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function crearTexto(datos: {
  nombre: string;
  email: string;
  empresa: string;
  telefono: string;
  mensaje: string;
  plan: string;
  origen: string;
}) {
  return [
    "Nueva solicitud comercial de TransTech EOS",
    "",
    `Nombre: ${datos.nombre}`,
    `Correo: ${datos.email}`,
    `Empresa: ${datos.empresa || "No informada"}`,
    `Teléfono: ${datos.telefono || "No informado"}`,
    `Plan: ${datos.plan}`,
    `Origen: ${datos.origen}`,
    "",
    "Necesidad de la organización:",
    datos.mensaje || "No se agregó un mensaje.",
  ].join("\n");
}

function crearHtml(datos: {
  nombre: string;
  email: string;
  empresa: string;
  telefono: string;
  mensaje: string;
  plan: string;
  origen: string;
}) {
  const nombre = escaparHtml(datos.nombre);
  const email = escaparHtml(datos.email);
  const empresa = escaparHtml(datos.empresa || "No informada");
  const telefono = escaparHtml(datos.telefono || "No informado");
  const mensaje = escaparHtml(
    datos.mensaje || "No se agregó un mensaje.",
  ).replaceAll("\n", "<br />");
  const plan = escaparHtml(datos.plan);
  const origen = escaparHtml(datos.origen);

  return `
    <div style="margin:0;padding:32px;background:#eef5ff;font-family:Arial,Helvetica,sans-serif;color:#071226;">
      <div style="max-width:680px;margin:0 auto;overflow:hidden;border:1px solid #dbeafe;border-radius:24px;background:#ffffff;">
        <div style="padding:28px 32px;background:#071226;color:#ffffff;">
          <div style="font-size:11px;font-weight:800;letter-spacing:2px;color:#93c5fd;">TRANSTECH EOS</div>
          <h1 style="margin:10px 0 0;font-size:27px;line-height:1.2;">Nueva consulta Enterprise</h1>
        </div>

        <div style="padding:30px 32px;">
          <p style="margin:0 0 22px;color:#64748b;line-height:1.65;">
            Una persona completó el formulario comercial desde la página de planes.
          </p>

          <table role="presentation" style="width:100%;border-collapse:collapse;font-size:14px;">
            ${fila("Nombre", nombre)}
            ${fila("Correo", `<a href="mailto:${email}" style="color:#2563eb;">${email}</a>`)}
            ${fila("Empresa", empresa)}
            ${fila("Teléfono", telefono)}
            ${fila("Plan", plan)}
            ${fila("Origen", origen)}
          </table>

          <div style="margin-top:24px;padding:20px;border:1px solid #dbeafe;border-radius:16px;background:#f8fbff;">
            <div style="margin-bottom:9px;font-size:11px;font-weight:800;letter-spacing:1px;color:#2563eb;">NECESIDAD DE LA ORGANIZACIÓN</div>
            <div style="font-size:14px;line-height:1.7;color:#334155;">${mensaje}</div>
          </div>

          <a
            href="mailto:${email}?subject=${encodeURIComponent("Re: Consulta EOS Enterprise")}"
            style="display:inline-block;margin-top:24px;padding:13px 20px;border-radius:999px;background:#2563eb;color:#ffffff;font-size:13px;font-weight:800;text-decoration:none;"
          >
            Responder al interesado
          </a>
        </div>
      </div>
    </div>
  `;
}

function fila(label: string, value: string) {
  return `
    <tr>
      <td style="width:135px;padding:11px 0;border-bottom:1px solid #e2e8f0;color:#64748b;font-weight:700;">${label}</td>
      <td style="padding:11px 0;border-bottom:1px solid #e2e8f0;color:#071226;font-weight:700;">${value}</td>
    </tr>
  `;
}