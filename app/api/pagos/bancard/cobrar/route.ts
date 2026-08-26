import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { getBancardBaseUrl } from "@/lib/bancard";
import { ejecutarCobroBancard } from "@/lib/bancard-cobro";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CobrarBody = {
  plan?: string;
  /** Un EOS armado a medida (v66). Cuando viene, manda sobre `plan`. */
  armado_id?: string;
  periodicidad?: "mensual" | "anual";
  tarjeta_id?: string;
};

function baseUrlApp() {
  const base =
    process.env.EOS_APP_BASE_URL ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    "https://www.transtech.com.py";

  return base.replace(/\/$/, "");
}

/* Cobra un plan con una tarjeta ya catastrada del usuario autenticado. */
export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Debés iniciar sesión." }, { status: 401 });
    }

    const body = (await request.json().catch(() => null)) as CobrarBody | null;
    const plan = String(body?.plan || "").trim().toLowerCase();
    const periodicidad = body?.periodicidad === "anual" ? "anual" : "mensual";
    const tarjetaId = String(body?.tarjeta_id || "").trim();
    // Cuando el usuario armó su EOS, el monto sale del armado y no del plan.
    const armadoId = String(body?.armado_id || "").trim();

    if (!tarjetaId) {
      return NextResponse.json(
        { error: "Elegí una tarjeta para pagar." },
        { status: 400 },
      );
    }

    const resultado = await ejecutarCobroBancard({
      admin: createAdminClient(),
      usuarioId: user.id,
      plan,
      armadoId: armadoId || null,
      periodicidad,
      tarjetaId,
      baseUrlApp: baseUrlApp(),
    });

    if (resultado.tipo === "error") {
      return NextResponse.json(
        { error: resultado.motivo },
        { status: resultado.codigo },
      );
    }

    if (resultado.tipo === "3ds") {
      return NextResponse.json({
        ok: true,
        requiere_3ds: true,
        process_id: resultado.processId,
        iframe_base_url: getBancardBaseUrl(),
        solicitud_id: resultado.solicitudId,
        shop_process_id: resultado.shopProcessId,
      });
    }

    if (resultado.tipo === "rechazado") {
      /*
       * El detalle del emisor sí se muestra porque es accionable
       * ("fondos insuficientes", "tarjeta vencida"). Los códigos
       * técnicos no, según las restricciones del comercio de Bancard.
       */
      return NextResponse.json(
        { ok: false, error: resultado.motivo },
        { status: 402 },
      );
    }

    return NextResponse.json({
      ok: true,
      estado: "pagado",
      solicitud_id: resultado.solicitudId,
      plan: resultado.plan,
      dias_acreditados: resultado.diasAcreditados,
      renovacion: resultado.renovacion,
    });
  } catch (error) {
    console.error("Bancard: error inesperado cobrando:", error);

    return NextResponse.json(
      { error: "No pudimos procesar el pago." },
      { status: 500 },
    );
  }
}
