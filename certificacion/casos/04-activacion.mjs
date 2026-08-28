/**
 * Que lo que se pagó quede prendido, y que lo que no se pagó quede apagado.
 *
 * ============================================================
 * LAS DOS FORMAS DE FALLAR
 * ============================================================
 *
 * Cobrar y no activar: el cliente pagó y no tiene lo que compró. Se arregla
 * activándolo a mano, pero para ese cliente EOS ya falló una vez.
 *
 * Activar sin cobrar: se regala el producto y nadie se entera hasta que alguien
 * mira los números. Es el que no se descubre solo.
 *
 * Este caso comprueba las dos direcciones para CADA módulo del catálogo, no
 * para uno de muestra. Un módulo nuevo que alguien agrega y se olvida de
 * conectar a la puerta es exactamente el agujero que esto tiene que encontrar.
 */

export const caso = {
  numero: 4,
  nombre: "Cada módulo se activa al pagarlo",
  critico: true,

  async correr({ admin, usuario, comprobar, alTerminar }) {
    const cliente = admin();

    const { data: catalogo } = await cliente
      .from("eos_modulos")
      .select("codigo,nombre")
      .eq("activo", true)
      .order("codigo");

    if (!catalogo?.length) {
      comprobar("hay catálogo para activar", false);
      return;
    }

    /*
     * El estado de los módulos se guarda y se repone al final.
     *
     * La cuenta de certificación tiene módulos contratados de verdad, y esta
     * prueba los prende y apaga. Dejarla como estaba no es prolijidad: si la
     * suite le apaga el ERP a la cuenta con la que después se prueba el chat,
     * el caso siguiente falla por un motivo que no tiene nada que ver.
     */
    const { data: antes } = await cliente
      .from("eos_usuario_modulos")
      .select("*")
      .eq("usuario_id", usuario.id);

    alTerminar(async () => {
      await cliente.from("eos_usuario_modulos").delete().eq("usuario_id", usuario.id);
      if (antes?.length) await cliente.from("eos_usuario_modulos").insert(antes);
    });

    const tiene = async (codigo) => {
      const { data } = await cliente.rpc("eos_tiene_modulo", {
        p_usuario_id: usuario.id,
        p_modulo: codigo,
      });

      return data === true;
    };

    // ---------- Sin nada contratado, nada está prendido ----------
    await cliente.from("eos_usuario_modulos").delete().eq("usuario_id", usuario.id);

    const prendidosSinPagar = [];

    for (const m of catalogo) {
      if (await tiene(m.codigo)) prendidosSinPagar.push(m.codigo);
    }

    comprobar(
      "sin contratar nada, ningún módulo está prendido",
      prendidosSinPagar.length === 0,
      prendidosSinPagar.join(", "),
    );

    // ---------- Cada uno se prende al contratarlo ----------
    const noSePrenden = [];
    const vencen = [];

    for (const m of catalogo) {
      const vencimiento = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

      await cliente.from("eos_usuario_modulos").insert({
        usuario_id: usuario.id,
        modulo_codigo: m.codigo,
        estado: "activo",
        vencimiento,
        origen: "pago",
      });

      if (!(await tiene(m.codigo))) noSePrenden.push(m.codigo);

      // Vencido, tiene que apagarse solo sin que nadie corra nada.
      await cliente
        .from("eos_usuario_modulos")
        .update({ vencimiento: new Date(Date.now() - 60_000).toISOString() })
        .eq("usuario_id", usuario.id)
        .eq("modulo_codigo", m.codigo);

      if (await tiene(m.codigo)) vencen.push(m.codigo);

      await cliente
        .from("eos_usuario_modulos")
        .delete()
        .eq("usuario_id", usuario.id)
        .eq("modulo_codigo", m.codigo);
    }

    comprobar(
      `los ${catalogo.length} módulos del catálogo se prenden al contratarlos`,
      noSePrenden.length === 0,
      noSePrenden.length ? "no se prendieron: " + noSePrenden.join(", ") : "",
    );

    comprobar(
      "y ninguno sigue prendido después de vencido",
      vencen.length === 0,
      vencen.length ? "siguen prendidos: " + vencen.join(", ") : "",
    );

    // ---------- Un módulo cancelado no sirve ----------
    await cliente.from("eos_usuario_modulos").insert({
      usuario_id: usuario.id,
      modulo_codigo: catalogo[0].codigo,
      estado: "cancelado",
      vencimiento: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      origen: "pago",
    });

    comprobar(
      "un módulo cancelado no queda usable aunque no haya vencido",
      !(await tiene(catalogo[0].codigo)),
    );
  },
};
