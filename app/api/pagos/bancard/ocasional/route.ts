import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase-admin";
import {
  describirErrorBancard,
  formatearMontoBancard,
  getBancardBaseUrl,
  getBancardKeys,
  llamarBancard,
  tokenSingleBuy,
} from "@/lib/bancard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  plan?: string;
  /** Un EOS armado a medida (v66). Cuando viene, manda sobre `plan`. */
  armado_id?: string;
  periodicidad?: "mensual" | "anual";
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

/*
 * Pago ocasional: el usuario carga la tarjeta en el iframe de Bancard y
 * no queda nada guardado. Devuelve el process_id para montar el
 * formulario. El resultado del pago lo confirma el webhook.
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

    const body = (await request.json().catch(() => null)) as Body | null;
    const plan = String(body?.plan || "").trim().toLowerCase();
    const periodicidad = body?.periodicidad === "anual" ? "anual" : "mensual";

    /*
     * Dos formas de llegar al mismo checkout de Bancard.
     *
     * La de siempre cobra el precio de un plan. La nueva cobra el EOS que el
     * usuario armó función por función, y el monto sale de ahí. Sin esta rama,
     * quien armaba un EOS de Gs. 340.000 y pagaba con tarjeta era cobrado por
     * el tramo de conversaciones nomás — y recibía igual todos los módulos,
     * porque el trigger de la v66 los activa mirando el metadata.
     */
    const armadoId = String(body?.armado_id || "").trim();

    const admin: any = createAdminClient();

    const { data: creado, error: crearError } = armadoId
      ? await admin.rpc("eos_bancard_crear_pago_armado_v71", {
          p_usuario_id: user.id,
          p_armado_id: armadoId,
          p_tarjeta_id: null,
        })
      : await admin.rpc("eos_bancard_crear_pago_ocasional_v52", {
          p_usuario_id: user.id,
          p_plan_codigo: plan,
          p_periodicidad: periodicidad,
        });

    if (crearError) {
      const texto = textoErrorRpc(crearError);

      const mapa: Array<[string, string, number]> = [
        ["EOS_BANCARD_PLAN_INVALID", "El plan seleccionado no es válido.", 400],
        ["EOS_BANCARD_PERIOD_INVALID", "La periodicidad no es válida.", 400],
        ["EOS_BANCARD_PLAN_PRICE_INVALID", "El plan no tiene un precio válido.", 400],
        ["EOS_BANCARD_USER_NOT_FOUND", "No encontramos tu cuenta.", 409],
        ["EOS_ARMADO_NO_EXISTE", "No encontramos el EOS que armaste. Volvé a elegir tus funciones.", 404],
        ["EOS_ARMADO_MONTO_INVALIDO", "Ese armado no tiene un precio válido.", 400],
      ];

      for (const [codigo, mensaje, status] of mapa) {
        if (texto.includes(codigo)) {
          return NextResponse.json({ error: mensaje }, { status });
        }
      }

      console.error("Bancard: no se pudo crear el pago ocasional:", crearError);

      return NextResponse.json(
        { error: "No pudimos iniciar el pago." },
        { status: 500 },
      );
    }

    const pago = (creado || {}) as {
      solicitud_id?: string;
      shop_process_id?: number;
      monto?: number;
    };

    if (!pago.shop_process_id || !pago.monto) {
      return NextResponse.json(
        { error: "No pudimos iniciar el pago." },
        { status: 500 },
      );
    }

    const { publicKey, privateKey } = getBancardKeys();
    const monto = formatearMontoBancard(pago.monto);
    const retorno = armadoId
      ? `${baseUrlApp()}/pago/tarjeta?ref=${pago.shop_process_id}&armado=${encodeURIComponent(armadoId)}`
      : `${baseUrlApp()}/pago/tarjeta?ref=${pago.shop_process_id}&plan=${encodeURIComponent(plan)}&periodicidad=${periodicidad}`;

    const respuesta = await llamarBancard("/vpos/api/0.3/single_buy", {
      public_key: publicKey,
      operation: {
        token: tokenSingleBuy(privateKey, pago.shop_process_id, monto),
        shop_process_id: pago.shop_process_id,
        amount: monto,
        currency: "PYG",
        // El staging los rechaza si faltan, pese a figurar como opcionales.
        additional_data: "",
        // Bancard corta en 20 caracteres, así que no entra el detalle.
        description: (armadoId ? "EOS a medida" : `EOS ${plan}`).slice(0, 20),
        return_url: retorno,
        cancel_url: `${retorno}&cancelado=1`,
      },
    });

    if (!respuesta.ok || !respuesta.data?.process_id) {
      const { key, detalle } = describirErrorBancard(respuesta.data);

      console.error("Bancard: single_buy rechazado:", key, detalle);

      await admin
        .from("solicitudes_pago")
        .update({ estado: "rechazado", updated_at: new Date().toISOString() })
        .eq("id", pago.solicitud_id);

      return NextResponse.json(
        { error: "Bancard no pudo iniciar el pago." },
        { status: 502 },
      );
    }

    return NextResponse.json({
      ok: true,
      solicitud_id: pago.solicitud_id,
      shop_process_id: pago.shop_process_id,
      process_id: respuesta.data.process_id,
      iframe_base_url: getBancardBaseUrl(),
    });
  } catch (error) {
    console.error("Bancard: error inesperado en pago ocasional:", error);

    return NextResponse.json(
      { error: "No pudimos iniciar el pago." },
      { status: 500 },
    );
  }
}
