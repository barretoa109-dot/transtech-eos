import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase-admin";
import {
  describirErrorBancard,
  getBancardKeys,
  llamarBancard,
  tokenEliminarTarjeta,
  tokenListarTarjetas,
} from "@/lib/bancard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* Elimina una tarjeta catastrada, primero en Bancard y luego local. */
export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Debés iniciar sesión." }, { status: 401 });
    }

    const admin: any = createAdminClient();

    const { data: tarjeta } = await admin
      .from("eos_bancard_tarjetas_v51")
      .select("id,bancard_card_id,es_principal")
      .eq("id", id)
      .eq("usuario_id", user.id)
      .eq("estado", "activa")
      .maybeSingle();

    if (!tarjeta) {
      return NextResponse.json(
        { error: "No encontramos esa tarjeta." },
        { status: 404 },
      );
    }

    const { data: mapeo } = await admin
      .from("eos_bancard_usuarios_v51")
      .select("bancard_user_id")
      .eq("usuario_id", user.id)
      .maybeSingle();

    if (!mapeo?.bancard_user_id) {
      return NextResponse.json(
        { error: "No encontramos esa tarjeta." },
        { status: 404 },
      );
    }

    const { publicKey, privateKey } = getBancardKeys();
    const bancardUserId = mapeo.bancard_user_id;

    /*
     * Bancard identifica la tarjeta a borrar por alias_token, que es
     * efímero: hay que pedir uno fresco justo antes de eliminar.
     */
    const listado = await llamarBancard(
      `/vpos/api/0.3/users/${bancardUserId}/cards`,
      {
        public_key: publicKey,
        operation: { token: tokenListarTarjetas(privateKey, bancardUserId) },
      },
    );

    const tarjetas: any[] = Array.isArray(listado.data?.cards)
      ? listado.data.cards
      : [];

    const elegida = tarjetas.find(
      (t) => Number(t?.card_id) === Number(tarjeta.bancard_card_id),
    );

    if (elegida?.alias_token) {
      const borrado = await llamarBancard(
        `/vpos/api/0.3/users/${bancardUserId}/cards`,
        {
          public_key: publicKey,
          operation: {
            token: tokenEliminarTarjeta(
              privateKey,
              bancardUserId,
              elegida.alias_token,
            ),
            alias_token: elegida.alias_token,
          },
        },
        "DELETE",
      );

      if (!borrado.ok) {
        const { key, detalle } = describirErrorBancard(borrado.data);
        console.error("Bancard: no se pudo eliminar la tarjeta:", key, detalle);

        return NextResponse.json(
          { error: "Bancard no pudo eliminar la tarjeta." },
          { status: 502 },
        );
      }
    }

    await admin
      .from("eos_bancard_tarjetas_v51")
      .update({
        estado: "eliminada",
        es_principal: false,
        updated_at: new Date().toISOString(),
      })
      .eq("id", tarjeta.id);

    // Si se eliminó la principal, otra activa toma su lugar.
    if (tarjeta.es_principal) {
      const { data: siguiente } = await admin
        .from("eos_bancard_tarjetas_v51")
        .select("id")
        .eq("usuario_id", user.id)
        .eq("estado", "activa")
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();

      if (siguiente?.id) {
        await admin
          .from("eos_bancard_tarjetas_v51")
          .update({ es_principal: true, updated_at: new Date().toISOString() })
          .eq("id", siguiente.id);
      }
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Bancard: error inesperado eliminando tarjeta:", error);

    return NextResponse.json(
      { error: "No pudimos eliminar la tarjeta." },
      { status: 500 },
    );
  }
}
