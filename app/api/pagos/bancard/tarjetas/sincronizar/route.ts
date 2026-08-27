import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { bancardUserIdDe, reconciliarTarjetas } from "@/lib/bancard-tarjetas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
 * Se invoca después de que el iframe de catastro reporta éxito.
 *
 * El iframe sólo informa "add_new_card_success": los datos reales de la tarjeta
 * hay que pedirlos a Bancard. El alias_token que devuelve vive minutos y sirve
 * para una sola operación, así que no se persiste: se vuelve a pedir en cada
 * cobro.
 *
 * Acá el usuario ACABA de registrar algo y está esperando verlo, así que si
 * Bancard no contesta corresponde decirlo. En el listado del checkout la
 * decisión es la contraria — ver `GET /api/pagos/bancard/tarjetas`.
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
    const bancardUserId = await bancardUserIdDe(admin, user.id);

    if (!bancardUserId) {
      return NextResponse.json(
        { error: "Todavía no iniciaste el registro de una tarjeta." },
        { status: 409 },
      );
    }

    const resultado = await reconciliarTarjetas(admin, user.id, bancardUserId);

    if (!resultado.ok) {
      return NextResponse.json(
        { error: "No pudimos confirmar la tarjeta con Bancard." },
        { status: 502 },
      );
    }

    return NextResponse.json({ ok: true, tarjetas: resultado.tarjetas });
  } catch (error) {
    console.error("Bancard: error inesperado sincronizando tarjetas:", error);

    return NextResponse.json(
      { error: "No pudimos confirmar la tarjeta con Bancard." },
      { status: 500 },
    );
  }
}
