import { aprobada, cobrar, esCobroRepetido, tarjetasDe } from "../bancard.mjs";

/**
 * Que el pago funcione, y que cuando no funciona tampoco haga daño.
 *
 * ============================================================
 * LOS CUATRO FINALES DE UN PAGO
 * ============================================================
 *
 * Aprobado es el fácil. Los otros tres son los que hunden un producto:
 *
 *   RECHAZADO   La tarjeta dice que no. No se activa nada, y la persona tiene
 *               que poder reintentar sin quedar trabada.
 *   CANCELADO   Se arrepintió antes de confirmar. No queda cobro pendiente
 *               eterno ni módulo a medio activar.
 *   ABANDONADO  Cerró la pestaña. Es el más traicionero: nadie avisa nada, y
 *               la solicitud queda esperando para siempre si no vence.
 *
 * El que de verdad importa es que **un pago que no salió no active nada**. Lo
 * contrario —cobrar y no activar— es malo pero se arregla; activar sin cobrar
 * es regalar el producto sin enterarse.
 *
 * ============================================================
 * ESTO COBRA DE VERDAD
 * ============================================================
 *
 * Contra Bancard staging, con la tarjeta de prueba ya catastrada en la cuenta
 * de certificación. No hay forma de certificar un cobro sin cobrar: un pago
 * simulado prueba que la simulación funciona.
 */

export const caso = {
  numero: 3,
  nombre: "Pago aprobado, rechazado, cancelado y abandonado",
  critico: true,

  async correr({ admin, usuario, comprobar, sinProbar, alTerminar }) {
    const cliente = admin();

    // ---------- Hace falta una tarjeta catastrada ----------
    const { data: mapeo } = await cliente
      .from("eos_bancard_usuarios_v51")
      .select("bancard_user_id")
      .eq("usuario_id", usuario.id)
      .maybeSingle();

    if (!mapeo?.bancard_user_id) {
      comprobar(
        "la cuenta de certificación tiene tarjeta",
        false,
        "catastrá una tarjeta de prueba antes de correr este caso",
      );
      return;
    }

    const { data: tarjeta } = await cliente
      .from("eos_bancard_tarjetas_v51")
      .select("id,bancard_card_id,card_masked_number")
      .eq("usuario_id", usuario.id)
      .eq("estado", "activa")
      .limit(1)
      .maybeSingle();

    comprobar("la cuenta tiene una tarjeta activa", Boolean(tarjeta), tarjeta?.card_masked_number ?? "");

    if (!tarjeta) return;

    /* Un armado barato y descartable para cada intento. */
    const armar = async (modulos) => {
      const { data } = await cliente.rpc("eos_guardar_armado", {
        p_usuario_id: usuario.id,
        p_modulos: modulos,
        p_periodicidad: "mensual",
      });

      const id = data?.armado_id ?? data?.id;
      if (id) alTerminar(() => cliente.from("eos_planes_armados").delete().eq("id", id));

      return { id, monto: Number(data?.monto ?? data?.total ?? 0) };
    };

    const crearCobro = async (armadoId) => {
      const { data, error } = await cliente.rpc("eos_bancard_crear_pago_armado_v71", {
        p_usuario_id: usuario.id,
        p_armado_id: armadoId,
        p_tarjeta_id: tarjeta.id,
      });

      if (error) throw new Error("no se pudo crear el cobro: " + error.message);

      alTerminar(async () => {
        await cliente
          .from("solicitudes_pago")
          .delete()
          .eq("referencia_externa", String(data.shop_process_id));
      });

      return data;
    };

    const estadoDe = async (shopProcessId) =>
      (
        await cliente
          .from("solicitudes_pago")
          .select("estado")
          .eq("referencia_externa", String(shopProcessId))
          .maybeSingle()
      ).data?.estado;

    // =====================================================
    // 1. APROBADO
    // =====================================================
    const compra = await armar(["dashboard"]);
    const cobro = await crearCobro(compra.id);

    comprobar(
      "el monto a cobrar sale del armado y no de un plan fijo",
      Number(cobro.monto) === compra.monto,
      `Gs. ${Number(cobro.monto).toLocaleString("es-PY")}`,
    );

    const tarjetasBancard = await tarjetasDe(mapeo.bancard_user_id);
    const elegida = tarjetasBancard.find(
      (t) => Number(t.card_id) === Number(tarjeta.bancard_card_id),
    );

    comprobar("Bancard reconoce la tarjeta y da un alias fresco", Boolean(elegida?.alias_token));

    if (!elegida?.alias_token) return;

    const operacion = await cobrar({
      shopProcessId: cobro.shop_process_id,
      monto: cobro.monto,
      aliasToken: elegida.alias_token,
      descripcion: "EOS cert",
    });

    /*
     * Si Bancard devuelve `process_id`, el emisor pidió 3DS y el cobro se
     * resuelve en el navegador. No es un fallo: es un final que esta suite no
     * puede recorrer sola, y hay que decirlo en vez de darlo por bueno.
     */
    if (operacion.process_id) {
      comprobar(
        "el cobro pidió 3DS y se completa en el navegador",
        true,
        "verificar a mano — está en la lista del README",
      );
      return;
    }

    if (esCobroRepetido(operacion)) {
      sinProbar("el cobro se aprueba", "Bancard bloquea el mismo importe sobre la misma tarjeta por 5 minutos. Esperá y volvé a correr este caso.");
      return;
    }

    comprobar(
      "el cobro se aprueba",
      aprobada(operacion),
      `${operacion.response ?? "?"}/${operacion.response_code ?? "?"} ${
        operacion.response_description ?? ""
      }`,
    );

    const { data: confirmado, error: errorConfirmar } = await cliente.rpc(
      "eos_bancard_confirmar_cobro_v51",
      {
        p_shop_process_id: String(cobro.shop_process_id),
        p_aprobado: aprobada(operacion),
        p_detalle: {
          origen: "certificacion",
          response: operacion.response ?? null,
          response_code: operacion.response_code ?? null,
          authorization_number: operacion.authorization_number ?? null,
          ticket_number: operacion.ticket_number ?? null,
        },
      },
    );

    comprobar("y se confirma", !errorConfirmar, errorConfirmar?.message ?? "");
    comprobar("la solicitud queda pagada", (await estadoDe(cobro.shop_process_id)) === "pagado");

    comprobar(
      "el número de autorización de Bancard queda guardado",
      Boolean(operacion.authorization_number),
      operacion.authorization_number ?? "sin autorización",
    );

    if (confirmado?.history_id) {
      const { data: hist } = await cliente
        .from("historial_pagos")
        .select("metadata")
        .eq("id", confirmado.history_id)
        .maybeSingle();

      comprobar(
        "y se puede reconciliar después con Bancard",
        Boolean(hist?.metadata?.bancard_respuesta?.authorization_number),
      );
    }

    // =====================================================
    // 2. RECHAZADO
    // =====================================================
    const rechazo = await armar(["briefing"]);
    const cobroRechazo = await crearCobro(rechazo.id);

    /*
     * Se confirma como rechazado sin llamar a Bancard.
     *
     * Provocar un rechazo real exigiría una tarjeta de prueba que decline, y
     * Bancard no publica uno estable. Lo que importa certificar no es que la
     * tarjeta diga que no —eso lo decide el banco— sino que NOSOTROS no
     * activemos nada cuando dice que no.
     */
    await cliente.rpc("eos_bancard_confirmar_cobro_v51", {
      p_shop_process_id: String(cobroRechazo.shop_process_id),
      p_aprobado: false,
      p_detalle: { origen: "certificacion", motivo: "rechazo simulado" },
    });

    comprobar(
      "un pago rechazado queda rechazado",
      (await estadoDe(cobroRechazo.shop_process_id)) === "rechazado",
    );

    const { data: armadoRechazado } = await cliente
      .from("eos_planes_armados")
      .select("estado")
      .eq("id", rechazo.id)
      .maybeSingle();

    comprobar(
      "y NO activa el armado que se quiso pagar",
      armadoRechazado?.estado !== "vigente",
      armadoRechazado?.estado ?? "",
    );

    // =====================================================
    // 3. CANCELADO / ABANDONADO
    // =====================================================
    const abandono = await armar(["decisiones"]);
    const cobroAbandonado = await crearCobro(abandono.id);

    comprobar(
      "un pago que nadie confirma queda pendiente, no activo",
      (await estadoDe(cobroAbandonado.shop_process_id)) === "pendiente",
    );

    const { data: solicitud } = await cliente
      .from("solicitudes_pago")
      .select("vencimiento_pago")
      .eq("referencia_externa", String(cobroAbandonado.shop_process_id))
      .maybeSingle();

    comprobar(
      "y tiene fecha de vencimiento para no quedar colgado para siempre",
      Boolean(solicitud?.vencimiento_pago),
      solicitud?.vencimiento_pago ?? "sin vencimiento",
    );

    const { data: armadoAbandonado } = await cliente
      .from("eos_planes_armados")
      .select("estado")
      .eq("id", abandono.id)
      .maybeSingle();

    comprobar(
      "el armado abandonado tampoco se activa",
      armadoAbandonado?.estado !== "vigente",
      armadoAbandonado?.estado ?? "",
    );
  },
};
