import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase-admin";
import {
  describirErrorBancard,
  getBancardKeys,
  llamarBancard,
  tokenListarTarjetas,
} from "@/lib/bancard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type TarjetaBancard = {
  alias_token?: string;
  card_masked_number?: string;
  expiration_date?: string;
  card_brand?: string;
  card_id?: number | string;
  card_type?: string;
  bancard_proccessed?: boolean | string;
};

/*
 * Se invoca después de que el iframe de catastro reporta éxito.
 * El iframe sólo informa "add_new_card_success": los datos reales de la
 * tarjeta hay que pedirlos a Bancard con users_cards.
 *
 * El alias_token que devuelve Bancard vive minutos y sirve para una sola
 * operación, así que NO se persiste: se vuelve a pedir en cada cobro.
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

    const { data: mapeo, error: mapeoError } = await admin
      .from("eos_bancard_usuarios_v51")
      .select("bancard_user_id")
      .eq("usuario_id", user.id)
      .maybeSingle();

    if (mapeoError || !mapeo?.bancard_user_id) {
      return NextResponse.json(
        { error: "Todavía no iniciaste el registro de una tarjeta." },
        { status: 409 },
      );
    }

    const { publicKey, privateKey } = getBancardKeys();
    const bancardUserId = mapeo.bancard_user_id;

    const respuesta = await llamarBancard(
      `/vpos/api/0.3/users/${bancardUserId}/cards`,
      {
        public_key: publicKey,
        operation: {
          token: tokenListarTarjetas(privateKey, bancardUserId),
          extra_response_attributes: ["cards.bancard_proccesed"],
        },
      },
    );

    if (!respuesta.ok) {
      const { key, detalle } = describirErrorBancard(respuesta.data);

      console.error("Bancard: users_cards rechazado:", key, detalle);

      return NextResponse.json(
        { error: "No pudimos confirmar la tarjeta con Bancard." },
        { status: 502 },
      );
    }

    const tarjetasBancard: TarjetaBancard[] = Array.isArray(respuesta.data?.cards)
      ? respuesta.data.cards
      : [];

    const ahora = new Date().toISOString();
    const idsVigentes: number[] = [];

    for (const tarjeta of tarjetasBancard) {
      const cardId = Number(tarjeta.card_id);

      if (!Number.isFinite(cardId)) continue;

      idsVigentes.push(cardId);

      await admin
        .from("eos_bancard_tarjetas_v51")
        .update({
          card_masked_number: tarjeta.card_masked_number ?? null,
          card_brand: tarjeta.card_brand ?? null,
          card_type: tarjeta.card_type ?? null,
          expiration_date: tarjeta.expiration_date ?? null,
          bancard_processed:
            typeof tarjeta.bancard_proccessed === "string"
              ? tarjeta.bancard_proccessed === "true"
              : Boolean(tarjeta.bancard_proccessed),
          estado: "activa",
          updated_at: ahora,
        })
        .eq("usuario_id", user.id)
        .eq("bancard_card_id", cardId);
    }

    // Lo que ya no existe en Bancard no debe seguir figurando como activo.
    if (idsVigentes.length > 0) {
      await admin
        .from("eos_bancard_tarjetas_v51")
        .update({ estado: "eliminada", es_principal: false, updated_at: ahora })
        .eq("usuario_id", user.id)
        .eq("estado", "activa")
        .not("bancard_card_id", "in", `(${idsVigentes.join(",")})`);
    }

    const { data: activas } = await admin
      .from("eos_bancard_tarjetas_v51")
      .select(
        "id,card_masked_number,card_brand,card_type,expiration_date,es_principal,created_at",
      )
      .eq("usuario_id", user.id)
      .eq("estado", "activa")
      .order("created_at", { ascending: true });

    const tarjetas = activas || [];

    // Si no hay principal definida, la primera activa pasa a serlo.
    if (tarjetas.length > 0 && !tarjetas.some((t: any) => t.es_principal)) {
      await admin
        .from("eos_bancard_tarjetas_v51")
        .update({ es_principal: true, updated_at: ahora })
        .eq("id", tarjetas[0].id);

      tarjetas[0].es_principal = true;
    }

    return NextResponse.json({ ok: true, tarjetas });
  } catch (error) {
    console.error("Bancard: error inesperado sincronizando tarjetas:", error);

    return NextResponse.json(
      { error: "No pudimos confirmar la tarjeta con Bancard." },
      { status: 500 },
    );
  }
}
