/**
 * Los tres finales que faltaban: duplicado, demorado y reversado.
 *
 * ============================================================
 * POR QUÉ ESTOS TRES Y NO OTROS
 * ============================================================
 *
 * El caso 03 cubre aprobado, rechazado y abandonado. Quedaban tres, y no son
 * casos de borde: son los que le cuestan plata a alguien.
 *
 *   DUPLICADO   La misma confirmación llega dos veces —Bancard reintenta el
 *               webhook, alguien recarga la página, el worker se ejecuta de
 *               nuevo. Si se procesa dos veces, el usuario recibe sesenta días
 *               por treinta que pagó. Pierde TransTech.
 *
 *   DEMORADO    El webhook llega tarde, cuando el usuario ya cerró todo. La
 *               solicitud tiene que seguir siendo confirmable y acreditar lo
 *               mismo, ni más ni menos. Si no, pierde el usuario: pagó y no
 *               recibió.
 *
 *   REVERSADO   Bancard devuelve la plata —rollback, contracargo, reclamo. Si
 *               EOS no deshace nada, el usuario conserva un producto que ya no
 *               pagó y nadie se entera hasta que alguien compare a mano el
 *               panel de Bancard con la base. Pierde TransTech, y de a poco.
 *
 * ============================================================
 * ESTE CASO NO LLAMA A BANCARD
 * ============================================================
 *
 * A diferencia del 03, acá no hace falta cobrar: los tres finales son sobre lo
 * que hace NUESTRA base cuando le avisan algo, no sobre lo que decide el
 * emisor. Provocar una reversión real en staging exigiría un rollback contra
 * un cobro real, y eso ya lo cubre el 03 desde el otro lado.
 *
 * Lo que se certifica acá es la parte que nos toca: que la misma noticia
 * repetida no duplique el efecto, que la tardía siga funcionando, y que la
 * mala deshaga exactamente lo que la buena hizo.
 */

export const caso = {
  numero: 11,
  nombre: "Pago duplicado, demorado y reversado",
  critico: true,

  async correr({ admin, usuario, comprobar, sinProbar, alTerminar }) {
    const cliente = admin();

    /* Una solicitud de pago descartable, sin pasar por Bancard. */
    const crearSolicitud = async (referencia) => {
      const { data, error } = await cliente
        .from("solicitudes_pago")
        .insert({
          usuario_id: usuario.id,
          proveedor: "bancard",
          referencia_externa: referencia,
          referencia_interna: `cert-${referencia}`,
          plan_codigo: "personal",
          periodicidad: "mensual",
          monto: 45000,
          moneda: "PYG",
          estado: "pendiente",
        })
        .select("id")
        .single();

      if (error) throw new Error("no se pudo crear la solicitud: " + error.message);

      alTerminar(async () => {
        await cliente.from("historial_pagos").delete().eq("solicitud_pago_id", data.id);
        await cliente.from("solicitudes_pago").delete().eq("id", data.id);
      });

      return data.id;
    };

    const planDe = async () =>
      (
        await cliente
          .from("usuarios")
          .select("plan,plan_vencimiento")
          .eq("id", usuario.id)
          .maybeSingle()
      ).data;

    const estadoDe = async (referencia) =>
      (
        await cliente
          .from("solicitudes_pago")
          .select("estado")
          .eq("referencia_externa", referencia)
          .maybeSingle()
      ).data?.estado;

    /* El plan de la cuenta se toca acá: se guarda y se repone al terminar. */
    const planOriginal = await planDe();
    alTerminar(async () => {
      await cliente
        .from("usuarios")
        .update({
          plan: planOriginal?.plan ?? "free",
          plan_vencimiento: planOriginal?.plan_vencimiento ?? null,
        })
        .eq("id", usuario.id);
    });

    // =====================================================
    // 1. DUPLICADO
    // =====================================================
    const refDuplicado = `cert-dup-${Date.now()}`;
    await crearSolicitud(refDuplicado);

    const primera = await cliente.rpc("eos_bancard_confirmar_cobro_v51", {
      p_shop_process_id: refDuplicado,
      p_aprobado: true,
      p_detalle: { origen: "certificacion", caso: "duplicado" },
    });

    comprobar(
      "la primera confirmación acredita el pago",
      primera.data?.status === "pagado" && primera.data?.idempotent === false,
      primera.error?.message ?? `${primera.data?.credited_days ?? "?"} días`,
    );

    const trasPrimera = await planDe();

    const segunda = await cliente.rpc("eos_bancard_confirmar_cobro_v51", {
      p_shop_process_id: refDuplicado,
      p_aprobado: true,
      p_detalle: { origen: "certificacion", caso: "duplicado-repetido" },
    });

    comprobar(
      "la segunda se reconoce como repetida y no vuelve a procesar",
      segunda.data?.idempotent === true,
      segunda.error?.message ?? segunda.data?.status ?? "",
    );

    const trasSegunda = await planDe();

    comprobar(
      "y NO le acredita los días dos veces",
      trasPrimera?.plan_vencimiento === trasSegunda?.plan_vencimiento,
      `${trasPrimera?.plan_vencimiento} → ${trasSegunda?.plan_vencimiento}`,
    );

    const { count: filasHistorial } = await cliente
      .from("historial_pagos")
      .select("id", { count: "exact", head: true })
      .eq("referencia_externa", `bancard-${refDuplicado}`);

    comprobar(
      "el historial guarda una sola fila, no dos",
      filasHistorial === 1,
      `${filasHistorial} fila(s)`,
    );

    // =====================================================
    // 2. DEMORADO
    // =====================================================
    //
    // Se simula moviendo la solicitud al pasado: es exactamente lo que ve la
    // base cuando el webhook llega horas después.
    const refDemorado = `cert-tarde-${Date.now()}`;
    const idDemorado = await crearSolicitud(refDemorado);

    const hace3Dias = new Date(Date.now() - 3 * 86_400_000).toISOString();
    await cliente
      .from("solicitudes_pago")
      .update({ created_at: hace3Dias, updated_at: hace3Dias })
      .eq("id", idDemorado);

    const tardia = await cliente.rpc("eos_bancard_confirmar_cobro_v51", {
      p_shop_process_id: refDemorado,
      p_aprobado: true,
      p_detalle: { origen: "certificacion", caso: "demorado" },
    });

    comprobar(
      "una confirmación que llega tres días tarde igual acredita",
      tardia.data?.status === "pagado",
      tardia.error?.message ?? "",
    );

    comprobar(
      "y acredita los mismos días que si hubiera llegado a tiempo",
      tardia.data?.credited_days === 30,
      `${tardia.data?.credited_days ?? "?"} días`,
    );

    // =====================================================
    // 3. REVERSADO
    // =====================================================
    const refReversado = `cert-rev-${Date.now()}`;
    await crearSolicitud(refReversado);

    const antesDelCobro = await planDe();

    const cobrado = await cliente.rpc("eos_bancard_confirmar_cobro_v51", {
      p_shop_process_id: refReversado,
      p_aprobado: true,
      p_detalle: { origen: "certificacion", caso: "reversado" },
    });

    if (cobrado.error) {
      comprobar("el cobro a revertir se acredita primero", false, cobrado.error.message);
      return;
    }

    const conPlan = await planDe();

    comprobar(
      "el cobro extiende el plan antes de revertirlo",
      conPlan?.plan_vencimiento !== antesDelCobro?.plan_vencimiento,
      `${antesDelCobro?.plan_vencimiento} → ${conPlan?.plan_vencimiento}`,
    );

    const revertido = await cliente.rpc("eos_bancard_revertir_cobro_v95", {
      p_shop_process_id: refReversado,
      p_motivo: "Certificación: reversión simulada",
      p_detalle: { origen: "certificacion" },
    });

    if (revertido.error?.message?.includes("Could not find the function")) {
      sinProbar(
        "una reversión deshace el cobro",
        "falta aplicar la migración v95 — va después del deploy, ver el archivo",
      );
      return;
    }

    comprobar(
      "una reversión deja la solicitud en reversado",
      (await estadoDe(refReversado)) === "reversado",
      revertido.error?.message ?? "",
    );

    const trasRevertir = await planDe();

    comprobar(
      "y le devuelve al plan el vencimiento que tenía antes",
      trasRevertir?.plan_vencimiento === antesDelCobro?.plan_vencimiento,
      `esperado ${antesDelCobro?.plan_vencimiento}, quedó ${trasRevertir?.plan_vencimiento}`,
    );

    const { data: histRevertido } = await cliente
      .from("historial_pagos")
      .select("estado,metadata")
      .eq("referencia_externa", `bancard-${refReversado}`)
      .maybeSingle();

    comprobar(
      "el historial queda como reversado, no borrado",
      histRevertido?.estado === "reversado",
      histRevertido?.estado ?? "sin fila",
    );

    comprobar(
      "y guarda el motivo, para poder explicárselo al cliente",
      Boolean(histRevertido?.metadata?.reversion_motivo),
      histRevertido?.metadata?.reversion_motivo ?? "sin motivo",
    );

    // La misma noticia dos veces: Bancard reintenta.
    const repetida = await cliente.rpc("eos_bancard_revertir_cobro_v95", {
      p_shop_process_id: refReversado,
      p_motivo: "Certificación: la misma reversión otra vez",
      p_detalle: { origen: "certificacion" },
    });

    comprobar(
      "repetir la reversión no descuenta los días dos veces",
      repetida.data?.ya_estaba === true,
      repetida.error?.message ?? "",
    );

    const trasRepetir = await planDe();

    comprobar(
      "el vencimiento queda donde estaba tras la primera reversión",
      trasRepetir?.plan_vencimiento === trasRevertir?.plan_vencimiento,
      `${trasRevertir?.plan_vencimiento} → ${trasRepetir?.plan_vencimiento}`,
    );

    // Y no se puede volver a cobrar por el mismo camino.
    const reconfirmar = await cliente.rpc("eos_bancard_confirmar_cobro_v51", {
      p_shop_process_id: refReversado,
      p_aprobado: true,
      p_detalle: { origen: "certificacion", caso: "reconfirmar-reversado" },
    });

    comprobar(
      "un cobro revertido no se puede reconfirmar como si nada",
      reconfirmar.data?.status === "reversado" && reconfirmar.data?.idempotent === true,
      reconfirmar.error?.message ?? reconfirmar.data?.status ?? "",
    );
  },
};
