import {
  describirErrorBancard,
  getBancardKeys,
  llamarBancard,
  tokenListarTarjetas,
} from "@/lib/bancard";

/*
 * ============================================================
 * QUIÉN DECIDE QUÉ TARJETAS TIENE UNA PERSONA
 * ============================================================
 *
 * Bancard. No nosotros.
 *
 * Antes la pantalla de pago listaba lo que decía NUESTRA tabla, y la tabla
 * sólo se actualizaba si el iframe de catastro alcanzaba a avisar. Cuando ese
 * aviso no llegaba —el usuario cerró la pestaña, Bancard redirigió en vez de
 * mandar el postMessage, o registró una tarjeta que Bancard ya tenía y por lo
 * tanto no duplicó— la fila quedaba en 'pendiente' para siempre y la tarjeta
 * era invisible aunque Bancard la tuviera perfectamente catastrada.
 *
 * Así lo reportó la certificación de Bancard el 27/8/2026: catastraron una
 * tarjeta, al ir a pagar no aparecía. En la base había dos filas 'pendiente'
 * del día anterior y `users_cards` devolvía una sola tarjeta.
 *
 * Por eso esta función NO confía en lo que ya teníamos: pregunta a Bancard y
 * deja la tabla igual a la respuesta. Lo que Bancard tiene, existe; lo que no,
 * no. Es la única forma de que la lista que se ve sea la lista que se puede
 * cobrar, porque el cobro también resuelve el alias_token contra `users_cards`.
 */

/*
 * El cliente de servicio no está tipado contra el esquema: las tablas de
 * Bancard se agregaron por migración y no hay tipos generados. Se nombra el
 * hueco una sola vez acá en vez de repartir `any` por todo el archivo.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ClienteAdmin = any;

/* Un catastro que no se completó en media hora es un catastro abandonado. */
const MINUTOS_PARA_CADUCAR = 30;

export type TarjetaBancard = {
  alias_token?: string;
  card_masked_number?: string;
  expiration_date?: string;
  card_brand?: string;
  card_id?: number | string;
  card_type?: string;
  /*
   * Bancard escribe "proccesed", con una sola ese.
   *
   * Estaba escrito "proccessed" y por eso el campo se guardaba siempre en
   * false: leíamos una clave que la pasarela nunca manda. Nadie lo usa todavía,
   * pero un dato guardado mal es un dato que alguien va a creer más adelante.
   */
  bancard_proccesed?: boolean | string;
};

export type TarjetaLocal = {
  id: string;
  card_masked_number: string | null;
  card_brand: string | null;
  card_type: string | null;
  expiration_date: string | null;
  es_principal: boolean;
  created_at: string;
};

function comoBooleano(valor: boolean | string | undefined) {
  if (typeof valor === "string") return valor.trim().toLowerCase() === "true";

  return Boolean(valor);
}

/*
 * Deja la tabla local igual a lo que Bancard dice tener.
 *
 * Devuelve `{ ok: false }` si Bancard no contesta, para que quien llame decida:
 * el catastro querrá avisar del problema, pero el checkout prefiere mostrar lo
 * último que sabíamos antes que una pantalla vacía.
 */
export async function reconciliarTarjetas(
  admin: ClienteAdmin,
  usuarioId: string,
  bancardUserId: number | string,
): Promise<{ ok: boolean; tarjetas: TarjetaLocal[]; motivo?: string }> {
  const ahora = new Date().toISOString();

  const { publicKey, privateKey } = getBancardKeys();

  const respuesta = await llamarBancard(`/vpos/api/0.3/users/${bancardUserId}/cards`, {
    public_key: publicKey,
    operation: {
      token: tokenListarTarjetas(privateKey, bancardUserId),
      extra_response_attributes: ["cards.bancard_proccesed"],
    },
  });

  if (!respuesta.ok) {
    const { key, detalle } = describirErrorBancard(respuesta.data);

    console.error("Bancard: users_cards rechazado:", key, detalle);

    return { ok: false, tarjetas: await soloLeerActivas(admin, usuarioId), motivo: key };
  }

  const deBancard: TarjetaBancard[] = Array.isArray(respuesta.data?.cards)
    ? respuesta.data.cards
    : [];

  const idsVigentes: number[] = [];

  for (const tarjeta of deBancard) {
    const cardId = Number(tarjeta.card_id);

    if (!Number.isFinite(cardId)) continue;

    idsVigentes.push(cardId);

    /*
     * upsert y no update.
     *
     * Un update sólo servía si ya existía una fila reservada con ESE número, y
     * nuestro número es una cuenta propia: se pide 1, 2, 3... y se asume que
     * Bancard va a devolver lo mismo. Cuando no coincide —y el reporte de
     * certificación demuestra que puede no coincidir— el update no tocaba nada
     * y la tarjeta no aparecía nunca.
     *
     * Insertando lo que Bancard reporta, cualquier tarjeta que la pasarela
     * tenga se vuelve visible y cobrable, venga de donde venga.
     */
    await admin.from("eos_bancard_tarjetas_v51").upsert(
      {
        usuario_id: usuarioId,
        bancard_card_id: cardId,
        card_masked_number: tarjeta.card_masked_number ?? null,
        card_brand: tarjeta.card_brand ?? null,
        card_type: tarjeta.card_type ?? null,
        expiration_date: tarjeta.expiration_date ?? null,
        bancard_processed: comoBooleano(tarjeta.bancard_proccesed),
        estado: "activa",
        updated_at: ahora,
      },
      { onConflict: "usuario_id,bancard_card_id" },
    );
  }

  // Lo que Bancard ya no tiene no puede seguir figurando como cobrable.
  if (idsVigentes.length > 0) {
    await admin
      .from("eos_bancard_tarjetas_v51")
      .update({ estado: "eliminada", es_principal: false, updated_at: ahora })
      .eq("usuario_id", usuarioId)
      .eq("estado", "activa")
      .not("bancard_card_id", "in", `(${idsVigentes.join(",")})`);
  } else {
    await admin
      .from("eos_bancard_tarjetas_v51")
      .update({ estado: "eliminada", es_principal: false, updated_at: ahora })
      .eq("usuario_id", usuarioId)
      .eq("estado", "activa");
  }

  /*
   * Los catastros abandonados dejan de ocupar lugar.
   *
   * Bancard permite cinco tarjetas por usuario y nosotros contábamos las
   * 'pendiente' dentro de ese cupo. Cada intento que no se completaba quemaba
   * un lugar para siempre: a la quinta vez, alguien con UNA tarjeta real recibe
   * "llegaste al máximo de 5 tarjetas guardadas". El usuario de la
   * certificación ya tenía dos lugares quemados así.
   */
  const limite = new Date(Date.now() - MINUTOS_PARA_CADUCAR * 60_000).toISOString();

  await admin
    .from("eos_bancard_tarjetas_v51")
    .update({ estado: "caducada", updated_at: ahora })
    .eq("usuario_id", usuarioId)
    .eq("estado", "pendiente")
    .lt("created_at", limite);

  const tarjetas = await soloLeerActivas(admin, usuarioId);

  // Si no hay principal definida, la primera activa pasa a serlo.
  if (tarjetas.length > 0 && !tarjetas.some((t) => t.es_principal)) {
    await admin
      .from("eos_bancard_tarjetas_v51")
      .update({ es_principal: true, updated_at: ahora })
      .eq("id", tarjetas[0].id);

    tarjetas[0].es_principal = true;
  }

  return { ok: true, tarjetas };
}

async function soloLeerActivas(admin: ClienteAdmin, usuarioId: string): Promise<TarjetaLocal[]> {
  const { data } = await admin
    .from("eos_bancard_tarjetas_v51")
    .select("id,card_masked_number,card_brand,card_type,expiration_date,es_principal,created_at")
    .eq("usuario_id", usuarioId)
    .eq("estado", "activa")
    .order("created_at", { ascending: true });

  return (data || []) as TarjetaLocal[];
}

/* El id de Bancard del usuario, o null si todavía no catastró nunca. */
export async function bancardUserIdDe(admin: ClienteAdmin, usuarioId: string) {
  const { data } = await admin
    .from("eos_bancard_usuarios_v51")
    .select("bancard_user_id")
    .eq("usuario_id", usuarioId)
    .maybeSingle();

  return (data?.bancard_user_id as number | undefined) ?? null;
}
