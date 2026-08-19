import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase-admin";
import {
  describirErrorBancard,
  getBancardBaseUrl,
  getBancardKeys,
  llamarBancard,
  tokenCatastro,
} from "@/lib/bancard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

/* Devuelve las tarjetas catastradas del usuario (sin datos sensibles). */
export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Debés iniciar sesión." }, { status: 401 });
    }

    const admin: any = createAdminClient();

    const { data, error } = await admin
      .from("eos_bancard_tarjetas_v51")
      .select(
        "id,card_masked_number,card_brand,card_type,expiration_date,estado,es_principal,created_at",
      )
      .eq("usuario_id", user.id)
      .eq("estado", "activa")
      .order("created_at", { ascending: true });

    if (error) {
      console.error("Bancard: error listando tarjetas:", error);

      return NextResponse.json(
        { error: "No pudimos obtener tus tarjetas." },
        { status: 500 },
      );
    }

    return NextResponse.json({ ok: true, tarjetas: data || [] });
  } catch (error) {
    console.error("Bancard: error inesperado listando tarjetas:", error);

    return NextResponse.json(
      { error: "No pudimos obtener tus tarjetas." },
      { status: 500 },
    );
  }
}

/*
 * Inicia el catastro de una tarjeta. Devuelve el process_id con el que
 * el front levanta el iframe de Bancard (Bancard.Cards.createForm).
 * El número de tarjeta nunca pasa por nuestro servidor.
 */
export async function POST() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Debés iniciar sesión." }, { status: 401 });
    }

    const admin: any = createAdminClient();

    const { data: perfil, error: perfilError } = await admin
      .from("usuarios")
      .select("email,whatsapp")
      .eq("id", user.id)
      .maybeSingle();

    if (perfilError || !perfil) {
      return NextResponse.json(
        { error: "No encontramos tu cuenta de TransTech EOS." },
        { status: 409 },
      );
    }

    const { data: preparado, error: prepararError } = await admin.rpc(
      "eos_bancard_preparar_catastro_v51",
      { p_usuario_id: user.id },
    );

    if (prepararError) {
      const texto = textoErrorRpc(prepararError);

      if (texto.includes("EOS_BANCARD_CARD_LIMIT")) {
        return NextResponse.json(
          {
            error:
              "Llegaste al máximo de 5 tarjetas guardadas. Eliminá una antes de agregar otra.",
          },
          { status: 409 },
        );
      }

      console.error("Bancard: no se pudo preparar el catastro:", prepararError);

      return NextResponse.json(
        { error: "No pudimos iniciar el registro de la tarjeta." },
        { status: 500 },
      );
    }

    const reserva = (preparado || {}) as {
      tarjeta_id?: string;
      bancard_user_id?: number;
      bancard_card_id?: number;
    };

    if (!reserva.tarjeta_id || !reserva.bancard_user_id || !reserva.bancard_card_id) {
      return NextResponse.json(
        { error: "No pudimos iniciar el registro de la tarjeta." },
        { status: 500 },
      );
    }

    const { publicKey, privateKey } = getBancardKeys();

    const respuesta = await llamarBancard("/vpos/api/0.3/cards/new", {
      public_key: publicKey,
      operation: {
        token: tokenCatastro(
          privateKey,
          reserva.bancard_card_id,
          reserva.bancard_user_id,
        ),
        card_id: reserva.bancard_card_id,
        user_id: reserva.bancard_user_id,
        user_cell_phone: String(perfil.whatsapp || "").slice(0, 255),
        user_mail: String(perfil.email || user.email || "").slice(0, 255),
        return_url: `${baseUrlApp()}/pago/tarjeta?tarjeta=${reserva.tarjeta_id}`,
      },
    });

    if (!respuesta.ok || !respuesta.data?.process_id) {
      const { key, detalle } = describirErrorBancard(respuesta.data);

      console.error("Bancard: catastro rechazado:", key, detalle);

      await admin
        .from("eos_bancard_tarjetas_v51")
        .update({ estado: "fallida", updated_at: new Date().toISOString() })
        .eq("id", reserva.tarjeta_id);

      return NextResponse.json(
        { error: "Bancard no pudo iniciar el registro de la tarjeta." },
        { status: 502 },
      );
    }

    await admin
      .from("eos_bancard_tarjetas_v51")
      .update({
        catastro_process_id: respuesta.data.process_id,
        updated_at: new Date().toISOString(),
      })
      .eq("id", reserva.tarjeta_id);

    return NextResponse.json({
      ok: true,
      tarjeta_id: reserva.tarjeta_id,
      process_id: respuesta.data.process_id,
      iframe_base_url: getBancardBaseUrl(),
    });
  } catch (error) {
    console.error("Bancard: error inesperado iniciando catastro:", error);

    return NextResponse.json(
      { error: "No pudimos iniciar el registro de la tarjeta." },
      { status: 500 },
    );
  }
}
