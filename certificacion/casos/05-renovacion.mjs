/**
 * Que a quien se le vence el mes se le cobre, y una sola vez.
 *
 * ============================================================
 * ESTA PRUEBA NO CORRE EL CRON, Y ES A PROPÓSITO
 * ============================================================
 *
 * El cron de renovaciones cobra las tarjetas de TODOS los que vencen en la
 * ventana. Dispararlo desde una suite que corre contra la base real le cobraría
 * a usuarios de verdad, en el momento que a alguien se le ocurra certificar. No
 * hay ningún resultado que valga ese riesgo.
 *
 * Lo que sí se puede certificar sin cobrarle a nadie es **a quién elegiría**,
 * que es donde estuvo el error real: la selección miraba sólo
 * `plan_vencimiento`, y a quien arma su EOS sin conversaciones ese campo le
 * queda en NULL. Esa gente no se renovaba nunca. Se les caía el servicio y
 * nadie se enteraba, ni ellos ni nosotros.
 *
 * ============================================================
 * LO QUE HAY QUE MANTENER A MANO
 * ============================================================
 *
 * Las consultas de acá espejan las de `app/api/cron/bancard-renovaciones`. Si
 * alguien cambia el cron y no cambia esto, la suite seguiría en verde probando
 * una lógica que ya no existe. Es la debilidad conocida de este caso y por eso
 * queda escrita: la alternativa —sacar la selección a una función compartida—
 * es la mejora que corresponde el día que esto moleste.
 */

const DIA = 24 * 60 * 60 * 1000;

export const caso = {
  numero: 5,
  nombre: "Renovación mensual: a quién se le cobra",
  critico: true,

  async correr({ admin, usuario, comprobar, alTerminar }) {
    const cliente = admin();

    const desde = new Date(Date.now() - DIA);
    const hasta = new Date(Date.now() + 3 * DIA);

    /* Se deja la cuenta como estaba: acá se toca lo que de verdad se cobra. */
    const { data: modulosAntes } = await cliente
      .from("eos_usuario_modulos")
      .select("*")
      .eq("usuario_id", usuario.id);

    const { data: perfilAntes } = await cliente
      .from("usuarios")
      .select("plan,plan_vencimiento,estado_suscripcion,cancelar_al_vencimiento")
      .eq("id", usuario.id)
      .single();

    alTerminar(async () => {
      await cliente.from("eos_usuario_modulos").delete().eq("usuario_id", usuario.id);
      if (modulosAntes?.length) await cliente.from("eos_usuario_modulos").insert(modulosAntes);
      await cliente.from("usuarios").update(perfilAntes).eq("id", usuario.id);
    });

    /** La misma selección que hace el cron, sin cobrar nada. */
    const candidatos = async () => {
      const comunes = (q) =>
        q
          .select("id")
          .eq("estado_suscripcion", "active")
          .eq("cancelar_al_vencimiento", false);

      const { data: porPlan } = await comunes(cliente.from("usuarios"))
        .neq("plan", "free")
        .gte("plan_vencimiento", desde.toISOString())
        .lte("plan_vencimiento", hasta.toISOString());

      const [{ data: porVencer }, { data: armados }] = await Promise.all([
        cliente
          .from("eos_usuario_modulos")
          .select("usuario_id")
          .eq("estado", "activo")
          .not("vencimiento", "is", null)
          .gte("vencimiento", desde.toISOString())
          .lte("vencimiento", hasta.toISOString()),
        cliente.from("eos_planes_armados").select("usuario_id").eq("estado", "vigente"),
      ]);

      const conArmado = new Set((armados ?? []).map((a) => a.usuario_id));
      const ids = [
        ...new Set((porVencer ?? []).map((m) => m.usuario_id).filter((id) => conArmado.has(id))),
      ];

      let porArmado = [];
      if (ids.length) {
        const { data } = await comunes(cliente.from("usuarios")).in("id", ids);
        porArmado = data ?? [];
      }

      // El cron deduplica: caer en las dos listas y cobrar dos veces sería el
      // peor error posible de todo el sistema.
      return [...new Set([...(porPlan ?? []), ...porArmado].map((u) => u.id))];
    };

    // ---------- Nadie que no venza ----------
    await cliente.from("eos_usuario_modulos").delete().eq("usuario_id", usuario.id);
    await cliente
      .from("usuarios")
      .update({
        plan: "free",
        plan_vencimiento: null,
        estado_suscripcion: "active",
        cancelar_al_vencimiento: false,
      })
      .eq("id", usuario.id);

    comprobar(
      "sin nada por vencer, no entra en la renovación",
      !(await candidatos()).includes(usuario.id),
    );

    // ---------- Por plan ----------
    await cliente
      .from("usuarios")
      .update({ plan: "personal", plan_vencimiento: new Date(Date.now() + DIA).toISOString() })
      .eq("id", usuario.id);

    comprobar("a quien se le vence el plan, se le cobra", (await candidatos()).includes(usuario.id));

    // ---------- Por armado, con plan_vencimiento en NULL ----------
    await cliente
      .from("usuarios")
      .update({ plan: "free", plan_vencimiento: null })
      .eq("id", usuario.id);

    const { data: armado } = await cliente.rpc("eos_guardar_armado", {
      p_usuario_id: usuario.id,
      p_modulos: ["dashboard", "briefing"],
      p_periodicidad: "mensual",
    });

    const armadoId = armado?.armado_id ?? armado?.id;
    alTerminar(() => cliente.from("eos_planes_armados").delete().eq("id", armadoId));

    await cliente.from("eos_planes_armados").update({ estado: "vigente" }).eq("id", armadoId);

    await cliente.from("eos_usuario_modulos").insert({
      usuario_id: usuario.id,
      modulo_codigo: "dashboard",
      estado: "activo",
      vencimiento: new Date(Date.now() + DIA).toISOString(),
      origen: "pago",
    });

    comprobar(
      "y a quien armó su EOS sin conversaciones, también",
      (await candidatos()).includes(usuario.id),
      "plan_vencimiento en NULL: es el caso que antes no se renovaba nunca",
    );

    // ---------- Aparece una sola vez ----------
    await cliente
      .from("usuarios")
      .update({ plan: "personal", plan_vencimiento: new Date(Date.now() + DIA).toISOString() })
      .eq("id", usuario.id);

    const lista = await candidatos();

    comprobar(
      "quien cae en las dos listas se cobra UNA sola vez",
      lista.filter((id) => id === usuario.id).length === 1,
    );

    // ---------- Quien canceló, no ----------
    await cliente
      .from("usuarios")
      .update({ cancelar_al_vencimiento: true })
      .eq("id", usuario.id);

    comprobar(
      "a quien pidió cancelar no se le cobra de nuevo",
      !(await candidatos()).includes(usuario.id),
    );

    await cliente
      .from("usuarios")
      .update({ cancelar_al_vencimiento: false, estado_suscripcion: "canceled" })
      .eq("id", usuario.id);

    comprobar(
      "ni a quien ya no tiene la suscripción activa",
      !(await candidatos()).includes(usuario.id),
    );
  },
};
