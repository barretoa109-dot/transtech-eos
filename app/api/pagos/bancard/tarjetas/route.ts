import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { bancardUserIdDe, reconciliarTarjetas } from "@/lib/bancard-tarjetas";
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

/*
 * Las tarjetas con las que esta persona puede pagar, según BANCARD.
 *
 * Se reconcilia contra la pasarela en cada carga en vez de leer nuestra tabla y
 * confiar. Leer y confiar es lo que rompió la certificación: la tabla sólo se
 * actualizaba si el iframe de catastro alcanzaba a avisar, y cuando ese aviso
 * no llegaba la tarjeta quedaba invisible aunque Bancard la tuviera. Quien
 * probaba veía una lista incompleta y no podía continuar con la operación.
 *
 * Cuesta una llamada más en una pantalla que se abre una vez por compra, y a
 * cambio la lista que se ve es exactamente la lista que se puede cobrar: el
 * cobro resuelve el alias_token contra ese mismo `users_cards`.
 *
 * Si Bancard no contesta se devuelve lo último que sabíamos, con
 * `sincronizada: false`. Una pasarela lenta no debe dejar a nadie sin poder
 * pagar con una tarjeta que ya tenía guardada.
 */
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
    const bancardUserId = await bancardUserIdDe(admin, user.id);

    // Nunca catastró: no hay nada que reconciliar, y tampoco es un error.
    if (!bancardUserId) {
      return NextResponse.json({ ok: true, tarjetas: [], sincronizada: true });
    }

    const resultado = await reconciliarTarjetas(admin, user.id, bancardUserId);

    return NextResponse.json({
      ok: true,
      tarjetas: resultado.tarjetas,
      sincronizada: resultado.ok,
    });
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
export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Debés iniciar sesión." }, { status: 401 });
    }

    const body = (await request.json().catch(() => null)) as
      | { telefono?: string; plan?: string; periodicidad?: string }
      | null;

    const planRetorno = String(body?.plan || "")
      .trim()
      .toLowerCase()
      .slice(0, 20);

    const periodicidadRetorno =
      body?.periodicidad === "anual" ? "anual" : body?.periodicidad === "mensual" ? "mensual" : "";

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

    /*
     * Bancard exige user_cell_phone y user_mail para catastrar. El
     * WhatsApp es opcional al registrarse, así que si falta hay que
     * pedirlo acá en vez de mandar un dato inventado a la pasarela.
     */
    const telefono = String(body?.telefono || perfil.whatsapp || "")
      .replace(/[^\d+]/g, "")
      .slice(0, 255);

    const correo = String(perfil.email || user.email || "").slice(0, 255);

    if (!telefono) {
      return NextResponse.json(
        {
          error: "Necesitamos tu número de teléfono para registrar la tarjeta.",
          code: "telefono_requerido",
        },
        { status: 400 },
      );
    }

    if (!correo) {
      return NextResponse.json(
        { error: "Tu cuenta no tiene un correo asociado." },
        { status: 409 },
      );
    }

    // Se guarda para no volver a pedirlo en el próximo catastro.
    if (!perfil.whatsapp && telefono) {
      await admin.from("usuarios").update({ whatsapp: telefono }).eq("id", user.id);
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
        user_cell_phone: telefono,
        user_mail: correo,
        /*
         * Se conservan plan y periodicidad porque Bancard redirige acá
         * al terminar el catastro y, sin eso, se perdería la compra que
         * el usuario venía haciendo.
         */
        return_url: `${baseUrlApp()}/pago/tarjeta?tarjeta=${reserva.tarjeta_id}${
          planRetorno ? `&plan=${encodeURIComponent(planRetorno)}` : ""
        }${periodicidadRetorno ? `&periodicidad=${periodicidadRetorno}` : ""}`,
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
