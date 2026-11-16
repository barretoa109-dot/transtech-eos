import { NextResponse, after } from "next/server";

import { enviarCorreoSimple } from "@/lib/email/enviar-simple";
import { avisarComprobanteNoVerificado } from "@/lib/pagos/correo-comprobante";
import { createClient } from "@/lib/supabase/server";
import { adminSinTipos } from "@/lib/supabase/sin-tipos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Anular un pago por transferencia que ya se había aprobado.
 *
 * Para dos casos: el agente activó un plan con un comprobante que resultó no
 * ser cierto, o el dueño aprobó la fila equivocada. Deshace todo lo que hizo
 * la aprobación (plan, módulos, historial) con `eos_anular_transferencia_v261`
 * y le avisa a la persona por correo, con el motivo.
 *
 * No devuelve plata: si la persona sí transfirió, la devolución la hace el
 * dueño desde su banco.
 */

function correosAdministradores() {
  return (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

async function administrador(): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  const email = user?.email?.trim().toLowerCase() || "";
  if (error || !user || !email || !correosAdministradores().includes(email)) return null;
  return email;
}

const ERRORES: Record<string, { mensaje: string; status: number }> = {
  EOS_PAYMENT_REQUEST_NOT_FOUND: { mensaje: "No encontramos la solicitud indicada.", status: 404 },
  EOS_PAYMENT_PROVIDER_INVALID: { mensaje: "Solo se pueden anular pagos por transferencia.", status: 409 },
  EOS_PAYMENT_NO_ESTABA_PAGADO: { mensaje: "Ese pago no está aprobado, así que no hay nada que anular.", status: 409 },
  EOS_REVERSION_MOTIVO_REQUERIDO: { mensaje: "Escribí el motivo de la anulación.", status: 400 },
};

export async function POST(request: Request) {
  try {
    const adminEmail = await administrador();
    if (!adminEmail) {
      return NextResponse.json({ error: "No tenés permiso para realizar esta acción." }, { status: 403 });
    }

    const body = (await request.json().catch(() => null)) as { solicitud_id?: unknown; motivo?: unknown } | null;
    const solicitudId = typeof body?.solicitud_id === "string" ? body.solicitud_id.trim() : "";
    const motivo = typeof body?.motivo === "string" ? body.motivo.trim().slice(0, 500) : "";

    if (!/^[0-9a-f-]{36}$/i.test(solicitudId)) {
      return NextResponse.json({ error: "La solicitud no es válida." }, { status: 400 });
    }
    if (motivo.length < 5) {
      return NextResponse.json({ error: "Escribí el motivo de la anulación." }, { status: 400 });
    }

    const admin = adminSinTipos();
    const { data, error } = await admin.rpc("eos_anular_transferencia_v261", {
      p_solicitud_id: solicitudId,
      p_motivo: motivo,
      p_admin_email: adminEmail,
    });

    if (error) {
      const texto = [error.code, error.message, error.details, error.hint].filter((v) => typeof v === "string").join(" ");
      const conocido = Object.keys(ERRORES).find((clave) => texto.includes(clave));
      if (conocido) return NextResponse.json({ error: ERRORES[conocido].mensaje }, { status: ERRORES[conocido].status });

      console.error("Pagos: no se pudo anular el pago:", error);
      return NextResponse.json({ error: "No se pudo anular el pago." }, { status: 500 });
    }

    const resultado = (data ?? {}) as {
      ok?: boolean;
      ya_estaba?: boolean;
      usuario_id?: string;
      plan_restaurado?: string | null;
      dias_quitados?: number;
    };

    if (resultado.ok !== true) {
      console.error("Pagos: la anulación devolvió un resultado inesperado:", data);
      return NextResponse.json({ error: "No se pudo confirmar la anulación." }, { status: 500 });
    }

    // Recién anulado por esta llamada (no un segundo clic): la persona recibe
    // un correo con el motivo, tal cual lo escribió quien anuló.
    if (resultado.ya_estaba !== true && resultado.usuario_id) {
      const usuarioId = resultado.usuario_id;
      after(async () => {
        const { data: fila } = await admin
          .from("solicitudes_pago")
          .select("referencia_interna")
          .eq("id", solicitudId)
          .eq("usuario_id", usuarioId)
          .maybeSingle();

        await avisarComprobanteNoVerificado(
          admin,
          {
            usuarioId,
            referencia: (fila as { referencia_interna?: string | null } | null)?.referencia_interna ?? solicitudId,
            motivos: [motivo],
            momento: "anulado",
          },
          enviarCorreoSimple(),
        );
      });
    }

    return NextResponse.json({
      ok: true,
      estado: "reversado",
      ya_estaba: resultado.ya_estaba === true,
      plan_restaurado: resultado.plan_restaurado ?? null,
      dias_quitados: resultado.dias_quitados ?? null,
    });
  } catch (error) {
    console.error("Error anulando pago:", error);
    return NextResponse.json({ error: "No se pudo anular el pago." }, { status: 500 });
  }
}
