import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase-admin";
import {
  describirErrorBancard,
  formatearMontoBancard,
  getBancardBaseUrl,
  getBancardKeys,
  llamarBancard,
  tokenCharge,
  tokenListarTarjetas,
} from "@/lib/bancard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CobrarBody = {
  plan?: string;
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

function textoErrorRpc(error: unknown) {
  if (!error || typeof error !== "object") return "";

  const detalle = error as Record<string, unknown>;

  return [detalle.code, detalle.message, detalle.details, detalle.hint]
    .filter((valor): valor is string => typeof valor === "string")
    .join(" ");
}

function respuestaErrorRpc(error: unknown) {
  const texto = textoErrorRpc(error);

  const mapa: Array<[string, string, number]> = [
    ["EOS_BANCARD_PLAN_INVALID", "El plan seleccionado no es válido.", 400],
    ["EOS_BANCARD_PERIOD_INVALID", "La periodicidad seleccionada no es válida.", 400],
    ["EOS_BANCARD_PLAN_PRICE_INVALID", "El plan no tiene un precio válido.", 400],
    ["EOS_BANCARD_CARD_NOT_FOUND", "No encontramos esa tarjeta guardada.", 404],
    ["EOS_BANCARD_USER_NOT_FOUND", "No encontramos tu cuenta de TransTech EOS.", 409],
  ];

  for (const [codigo, mensaje, status] of mapa) {
    if (texto.includes(codigo)) {
      return NextResponse.json({ error: mensaje }, { status });
    }
  }

  console.error("Bancard: error creando el cobro:", error);

  return NextResponse.json(
    { error: "No pudimos iniciar el cobro." },
    { status: 500 },
  );
}

/*
 * Cobra un plan con una tarjeta ya catastrada.
 *
 * El alias_token vive minutos y sirve una sola vez, así que se pide
 * fresco a Bancard (users_cards) justo antes de cobrar. Ese es el patrón
 * que permite renovar sin que el usuario tenga que hacer nada.
 */
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

    if (!tarjetaId) {
      return NextResponse.json(
        { error: "Elegí una tarjeta para pagar." },
        { status: 400 },
      );
    }

    const admin: any = createAdminClient();

    const { data: mapeo } = await admin
      .from("eos_bancard_usuarios_v51")
      .select("bancard_user_id")
      .eq("usuario_id", user.id)
      .maybeSingle();

    if (!mapeo?.bancard_user_id) {
      return NextResponse.json(
        { error: "Todavía no tenés una tarjeta registrada." },
        { status: 409 },
      );
    }

    const { data: creado, error: crearError } = await admin.rpc(
      "eos_bancard_crear_cobro_v51",
      {
        p_usuario_id: user.id,
        p_plan_codigo: plan,
        p_periodicidad: periodicidad,
        p_tarjeta_id: tarjetaId,
      },
    );

    if (crearError) {
      return respuestaErrorRpc(crearError);
    }

    const cobro = (creado || {}) as {
      solicitud_id?: string;
      shop_process_id?: number;
      monto?: number;
    };

    if (!cobro.shop_process_id || !cobro.monto) {
      return NextResponse.json(
        { error: "No pudimos iniciar el cobro." },
        { status: 500 },
      );
    }

    const { publicKey, privateKey } = getBancardKeys();
    const bancardUserId = mapeo.bancard_user_id;

    // 1. alias_token fresco (vive minutos, un solo uso).
    const listado = await llamarBancard(
      `/vpos/api/0.3/users/${bancardUserId}/cards`,
      {
        public_key: publicKey,
        operation: { token: tokenListarTarjetas(privateKey, bancardUserId) },
      },
    );

    if (!listado.ok) {
      const { key, detalle } = describirErrorBancard(listado.data);
      console.error("Bancard: no se pudo listar tarjetas para cobrar:", key, detalle);

      await admin.rpc("eos_bancard_confirmar_cobro_v51", {
        p_shop_process_id: String(cobro.shop_process_id),
        p_aprobado: false,
        p_detalle: { motivo: "users_cards_error", key },
      });

      return NextResponse.json(
        { error: "No pudimos usar tu tarjeta en este momento." },
        { status: 502 },
      );
    }

    const { data: tarjetaLocal } = await admin
      .from("eos_bancard_tarjetas_v51")
      .select("bancard_card_id")
      .eq("id", tarjetaId)
      .eq("usuario_id", user.id)
      .maybeSingle();

    const tarjetas: any[] = Array.isArray(listado.data?.cards)
      ? listado.data.cards
      : [];

    const elegida = tarjetas.find(
      (t) => Number(t?.card_id) === Number(tarjetaLocal?.bancard_card_id),
    );

    if (!elegida?.alias_token) {
      await admin.rpc("eos_bancard_confirmar_cobro_v51", {
        p_shop_process_id: String(cobro.shop_process_id),
        p_aprobado: false,
        p_detalle: { motivo: "alias_token_no_disponible" },
      });

      return NextResponse.json(
        { error: "Esa tarjeta ya no está disponible. Registrala de nuevo." },
        { status: 409 },
      );
    }

    // 2. Cobro.
    const monto = formatearMontoBancard(cobro.monto);

    const charge = await llamarBancard("/vpos/api/0.3/charge", {
      public_key: publicKey,
      operation: {
        token: tokenCharge(
          privateKey,
          cobro.shop_process_id,
          monto,
          elegida.alias_token,
        ),
        shop_process_id: cobro.shop_process_id,
        amount: monto,
        currency: "PYG",
        number_of_payments: 1,
        description: `EOS ${plan} ${periodicidad}`.slice(0, 20),
        alias_token: elegida.alias_token,
        return_url: `${baseUrlApp()}/pago/resultado?ref=${cobro.shop_process_id}`,
        extra_response_attributes: ["confirmation.process_id"],
      },
    });

    const operacion = charge.data?.operation || {};

    // Flujo 3D Secure: Bancard pide verificación adicional al usuario.
    if (operacion.process_id) {
      return NextResponse.json({
        ok: true,
        requiere_3ds: true,
        process_id: operacion.process_id,
        iframe_base_url: getBancardBaseUrl(),
        solicitud_id: cobro.solicitud_id,
        shop_process_id: cobro.shop_process_id,
      });
    }

    const aprobado =
      operacion.response === "S" && String(operacion.response_code) === "00";

    const { data: confirmado, error: confirmarError } = await admin.rpc(
      "eos_bancard_confirmar_cobro_v51",
      {
        p_shop_process_id: String(cobro.shop_process_id),
        p_aprobado: aprobado,
        p_detalle: {
          response: operacion.response ?? null,
          response_code: operacion.response_code ?? null,
          response_description: operacion.response_description ?? null,
          authorization_number: operacion.authorization_number ?? null,
          ticket_number: operacion.ticket_number ?? null,
        },
      },
    );

    if (confirmarError) {
      console.error("Bancard: cobro hecho pero no confirmado:", confirmarError);

      return NextResponse.json(
        {
          error:
            "Procesamos el pago pero no pudimos confirmarlo. Escribinos antes de reintentar.",
        },
        { status: 500 },
      );
    }

    if (!aprobado) {
      /*
       * response_description trae detalle del emisor; se expone porque es
       * accionable para el usuario ("fondos insuficientes", "tarjeta
       * vencida"). El resto de campos técnicos no se muestran, según las
       * restricciones del comercio en la spec de Bancard.
       */
      return NextResponse.json(
        {
          ok: false,
          error:
            typeof operacion.response_description === "string" &&
            operacion.response_description.trim()
              ? operacion.response_description
              : "La tarjeta rechazó el pago.",
        },
        { status: 402 },
      );
    }

    return NextResponse.json({
      ok: true,
      estado: "pagado",
      solicitud_id: cobro.solicitud_id,
      plan: (confirmado as any)?.plan_codigo ?? plan,
      dias_acreditados: (confirmado as any)?.credited_days ?? null,
      renovacion: (confirmado as any)?.same_plan_renewal ?? false,
    });
  } catch (error) {
    console.error("Bancard: error inesperado cobrando:", error);

    return NextResponse.json(
      { error: "No pudimos procesar el pago." },
      { status: 500 },
    );
  }
}
