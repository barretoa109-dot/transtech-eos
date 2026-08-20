import {
  describirErrorBancard,
  formatearMontoBancard,
  getBancardKeys,
  llamarBancard,
  tokenCharge,
  tokenListarTarjetas,
} from "@/lib/bancard";

export type ResultadoCobro =
  | { tipo: "pagado"; solicitudId: string; plan: string; diasAcreditados: number | null; renovacion: boolean }
  | { tipo: "3ds"; processId: string; solicitudId: string; shopProcessId: number }
  | { tipo: "rechazado"; motivo: string; solicitudId?: string }
  | { tipo: "error"; motivo: string; codigo: number };

type Parametros = {
  admin: any;
  usuarioId: string;
  plan: string;
  periodicidad: "mensual" | "anual";
  tarjetaId: string;
  baseUrlApp: string;
};

function textoError(error: unknown) {
  if (!error || typeof error !== "object") return "";

  const detalle = error as Record<string, unknown>;

  return [detalle.code, detalle.message, detalle.details, detalle.hint]
    .filter((valor): valor is string => typeof valor === "string")
    .join(" ");
}

/*
 * Ejecuta un cobro con una tarjeta ya catastrada. Lo usan tanto el
 * checkout (usuario presente) como el cron de renovaciones (sin usuario),
 * porque el flujo es idéntico: alias_token fresco -> charge -> confirmar.
 */
export async function ejecutarCobroBancard({
  admin,
  usuarioId,
  plan,
  periodicidad,
  tarjetaId,
  baseUrlApp,
}: Parametros): Promise<ResultadoCobro> {
  const { data: mapeo } = await admin
    .from("eos_bancard_usuarios_v51")
    .select("bancard_user_id")
    .eq("usuario_id", usuarioId)
    .maybeSingle();

  if (!mapeo?.bancard_user_id) {
    return { tipo: "error", motivo: "Todavía no tenés una tarjeta registrada.", codigo: 409 };
  }

  const { data: creado, error: crearError } = await admin.rpc(
    "eos_bancard_crear_cobro_v51",
    {
      p_usuario_id: usuarioId,
      p_plan_codigo: plan,
      p_periodicidad: periodicidad,
      p_tarjeta_id: tarjetaId,
    },
  );

  if (crearError) {
    const texto = textoError(crearError);

    const mapa: Array<[string, string, number]> = [
      ["EOS_BANCARD_PLAN_INVALID", "El plan seleccionado no es válido.", 400],
      ["EOS_BANCARD_PERIOD_INVALID", "La periodicidad seleccionada no es válida.", 400],
      ["EOS_BANCARD_PLAN_PRICE_INVALID", "El plan no tiene un precio válido.", 400],
      ["EOS_BANCARD_CARD_NOT_FOUND", "No encontramos esa tarjeta guardada.", 404],
      ["EOS_BANCARD_USER_NOT_FOUND", "No encontramos la cuenta.", 409],
    ];

    for (const [codigo, mensaje, status] of mapa) {
      if (texto.includes(codigo)) {
        return { tipo: "error", motivo: mensaje, codigo: status };
      }
    }

    console.error("Bancard: error creando el cobro:", crearError);

    return { tipo: "error", motivo: "No pudimos iniciar el cobro.", codigo: 500 };
  }

  const cobro = (creado || {}) as {
    solicitud_id?: string;
    shop_process_id?: number;
    monto?: number;
  };

  if (!cobro.shop_process_id || !cobro.monto || !cobro.solicitud_id) {
    return { tipo: "error", motivo: "No pudimos iniciar el cobro.", codigo: 500 };
  }

  const { publicKey, privateKey } = getBancardKeys();
  const bancardUserId = mapeo.bancard_user_id;

  // alias_token fresco: vive minutos y sirve una sola vez.
  const listado = await llamarBancard(`/vpos/api/0.3/users/${bancardUserId}/cards`, {
    public_key: publicKey,
    operation: { token: tokenListarTarjetas(privateKey, bancardUserId) },
  });

  if (!listado.ok) {
    const { key } = describirErrorBancard(listado.data);

    await admin.rpc("eos_bancard_confirmar_cobro_v51", {
      p_shop_process_id: String(cobro.shop_process_id),
      p_aprobado: false,
      p_detalle: { motivo: "users_cards_error", key },
    });

    return {
      tipo: "error",
      motivo: "No pudimos usar la tarjeta en este momento.",
      codigo: 502,
    };
  }

  const { data: tarjetaLocal } = await admin
    .from("eos_bancard_tarjetas_v51")
    .select("bancard_card_id")
    .eq("id", tarjetaId)
    .eq("usuario_id", usuarioId)
    .maybeSingle();

  const tarjetas: any[] = Array.isArray(listado.data?.cards) ? listado.data.cards : [];

  const elegida = tarjetas.find(
    (t) => Number(t?.card_id) === Number(tarjetaLocal?.bancard_card_id),
  );

  if (!elegida?.alias_token) {
    await admin.rpc("eos_bancard_confirmar_cobro_v51", {
      p_shop_process_id: String(cobro.shop_process_id),
      p_aprobado: false,
      p_detalle: { motivo: "alias_token_no_disponible" },
    });

    return {
      tipo: "error",
      motivo: "Esa tarjeta ya no está disponible. Registrala de nuevo.",
      codigo: 409,
    };
  }

  const monto = formatearMontoBancard(cobro.monto);

  const charge = await llamarBancard("/vpos/api/0.3/charge", {
    public_key: publicKey,
    operation: {
      token: tokenCharge(privateKey, cobro.shop_process_id, monto, elegida.alias_token),
      shop_process_id: cobro.shop_process_id,
      amount: monto,
      currency: "PYG",
      number_of_payments: 1,
      // El staging lo rechaza si falta, aunque la spec lo dé por opcional.
      additional_data: "",
      description: `EOS ${plan}`.slice(0, 20),
      alias_token: elegida.alias_token,
      return_url: `${baseUrlApp}/pago/resultado?ref=${cobro.shop_process_id}`,
      extra_response_attributes: ["confirmation.process_id"],
    },
  });

  /*
   * charge responde bajo "confirmation", no bajo "operation" como
   * sugiere el ejemplo de la spec. Se contemplan ambas formas para no
   * depender de ese detalle.
   */
  const operacion = charge.data?.confirmation || charge.data?.operation || {};

  // Rechazo a nivel API (JSON inválido, parámetro faltante, etc.).
  if (!charge.ok && !operacion.response) {
    const { key, detalle } = describirErrorBancard(charge.data);

    console.error("Bancard: charge rechazado por la API:", key, detalle);

    await admin.rpc("eos_bancard_confirmar_cobro_v51", {
      p_shop_process_id: String(cobro.shop_process_id),
      p_aprobado: false,
      p_detalle: { motivo: "charge_api_error", key, detalle },
    });

    return {
      tipo: "error",
      motivo: "No pudimos procesar el pago en este momento.",
      codigo: 502,
    };
  }

  if (operacion.process_id) {
    return {
      tipo: "3ds",
      processId: operacion.process_id,
      solicitudId: cobro.solicitud_id,
      shopProcessId: cobro.shop_process_id,
    };
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

    return {
      tipo: "error",
      motivo:
        "Procesamos el pago pero no pudimos confirmarlo. Escribinos antes de reintentar.",
      codigo: 500,
    };
  }

  if (!aprobado) {
    return {
      tipo: "rechazado",
      solicitudId: cobro.solicitud_id,
      motivo:
        typeof operacion.response_description === "string" &&
        operacion.response_description.trim()
          ? operacion.response_description
          : "La tarjeta rechazó el pago.",
    };
  }

  return {
    tipo: "pagado",
    solicitudId: cobro.solicitud_id,
    plan: (confirmado as any)?.plan_codigo ?? plan,
    diasAcreditados: (confirmado as any)?.credited_days ?? null,
    renovacion: Boolean((confirmado as any)?.same_plan_renewal),
  };
}
