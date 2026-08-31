import { NextResponse } from "next/server";
import { Resend } from "resend";

import { createClient } from "@/lib/supabase/server";
import { adminSinTipos } from "@/lib/supabase/sin-tipos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Pedir ayuda desde adentro de EOS.
 *
 * ============================================================
 * POR QUÉ NO ALCANZABA CON PONER EL CORREO
 * ============================================================
 *
 * `soporte@transtech.com.py` ya estaba en la página de precios, en el checkout
 * y en la de privacidad. O sea: en todos los lugares por donde alguien pasa
 * ANTES de pagar, y en ninguno por donde pasa después.
 *
 * Quien ya pagó y tiene un problema usando EOS tenía que salir del producto,
 * acordarse de una dirección que vio una vez, y escribir un correo explicando
 * quién es. La mayoría no hace eso: se queda con el problema y se va callado,
 * que es la peor forma de perder a alguien porque ni siquiera te enterás.
 *
 * ============================================================
 * EL CONTEXTO VIAJA SOLO
 * ============================================================
 *
 * El correo llega con quién es, qué plan tiene, qué módulos contratados y desde
 * qué pantalla escribió. No es comodidad: es la diferencia entre responder en
 * cinco minutos y perder dos correos preguntando datos que ya teníamos.
 *
 * El usuario no escribe nada de eso. Sólo cuenta qué le pasa.
 */

const DESTINO = "soporte@transtech.com.py";

const REMITENTE =
  process.env.SOPORTE_FROM_EMAIL || "TransTech EOS <no-reply@transtech.com.py>";

function texto(valor: unknown, largo: number) {
  return String(valor ?? "").trim().slice(0, largo);
}

function escapar(valor: string) {
  return valor
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Debés iniciar sesión." }, { status: 401 });
    }

    const cuerpo = (await request.json().catch(() => null)) as Record<string, unknown> | null;

    const mensaje = texto(cuerpo?.mensaje, 4000);
    const pantalla = texto(cuerpo?.pantalla, 60);

    if (mensaje.length < 10) {
      return NextResponse.json(
        { error: "Contanos un poco más de lo que pasa, así te podemos ayudar." },
        { status: 400 },
      );
    }

    if (!process.env.RESEND_API_KEY) {
      /*
       * Sin correo configurado no se traga el pedido en silencio.
       *
       * Que alguien escriba pidiendo ayuda, vea "listo, te respondemos" y nadie
       * lea nunca ese mensaje es peor que no tener el formulario. Se le devuelve
       * la dirección para que escriba directo.
       */
      console.error("Soporte: falta RESEND_API_KEY, no se pudo enviar:", user.id);

      return NextResponse.json(
        {
          error: `No pudimos enviar tu mensaje. Escribinos a ${DESTINO} y te respondemos igual.`,
        },
        { status: 503 },
      );
    }

    const admin = adminSinTipos();

    const [{ data: perfil }, { data: modulos }] = await Promise.all([
      admin.from("usuarios").select("nombre,email,plan,whatsapp").eq("id", user.id).maybeSingle(),
      admin
        .from("eos_usuario_modulos")
        .select("modulo_codigo")
        .eq("usuario_id", user.id)
        .eq("estado", "activo"),
    ]);

    const contratados = (modulos ?? [])
      .map((m: { modulo_codigo: string }) => m.modulo_codigo)
      .join(", ");

    const nombre = perfil?.nombre || user.email || "Usuario";
    const correo = perfil?.email || user.email || "";

    const filas = [
      ["Quién", nombre],
      ["Correo", correo],
      ["WhatsApp", perfil?.whatsapp || "—"],
      ["Plan", perfil?.plan || "free"],
      ["Módulos", contratados || "ninguno"],
      ["Pantalla", pantalla || "—"],
      ["Usuario", user.id],
    ];

    const html = `
      <div style="font-family:system-ui,sans-serif;max-width:620px">
        <h2 style="margin:0 0 4px">Pedido de ayuda desde EOS</h2>
        <p style="margin:0 0 18px;color:#6b7280">${escapar(nombre)} escribió desde adentro de la app.</p>

        <div style="white-space:pre-wrap;padding:16px;border-radius:12px;background:#f6f8fc;border:1px solid #e5e9f0;font-size:15px;line-height:1.6">${escapar(
          mensaje,
        )}</div>

        <table style="margin-top:20px;width:100%;border-collapse:collapse;font-size:13px">
          ${filas
            .map(
              ([k, v]) =>
                `<tr><td style="padding:6px 10px 6px 0;color:#6b7280;white-space:nowrap">${k}</td>` +
                `<td style="padding:6px 0">${escapar(String(v))}</td></tr>`,
            )
            .join("")}
        </table>

        <p style="margin-top:22px">
          <a href="mailto:${escapar(correo)}?subject=${encodeURIComponent("Re: tu consulta en EOS")}"
             style="color:#1656bd;font-weight:600">Responderle a ${escapar(nombre)}</a>
        </p>
      </div>
    `;

    const { error } = await new Resend(process.env.RESEND_API_KEY).emails.send({
      from: REMITENTE,
      to: [DESTINO],
      // Que la respuesta vaya al usuario sin tener que copiar la dirección.
      replyTo: correo || undefined,
      subject: `Ayuda en EOS — ${nombre}`,
      html,
      text: `${mensaje}\n\n---\n${filas.map(([k, v]) => `${k}: ${v}`).join("\n")}`,
    });

    if (error) {
      console.error("Soporte: Resend no pudo enviar:", error);

      return NextResponse.json(
        { error: `No pudimos enviar tu mensaje. Escribinos a ${DESTINO}.` },
        { status: 502 },
      );
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Soporte: error inesperado:", error);

    return NextResponse.json(
      { error: `No pudimos enviar tu mensaje. Escribinos a ${DESTINO}.` },
      { status: 500 },
    );
  }
}
