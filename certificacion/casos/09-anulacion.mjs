/**
 * Poder equivocarse.
 *
 * ============================================================
 * ESTO ES LO QUE DECIDE SI ALGUIEN SIGUE USANDO EOS
 * ============================================================
 *
 * El almacenero que carga mal una venta el primer día y descubre que el sistema
 * no lo deja arreglarla, no vuelve a abrirlo. No escribe a soporte: deja de
 * usarlo.
 *
 * Lo que se certifica es que deshacer deshaga TODO —el stock vuelve, la plata
 * se va— y que hacerlo dos veces no devuelva el stock dos veces. Una anulación
 * que deja la mitad hecha es peor que no poder anular, porque el usuario cree
 * que quedó bien.
 *
 * Y una regla que no es técnica: una venta con factura electrónica emitida NO
 * se puede anular desde acá. El hecho imponible existe ante la SET y deshacerlo
 * es un trámite fiscal. Dejar que el sistema diga "listo" sería hacerle creer a
 * alguien que resolvió algo que la SET todavía tiene registrado.
 */

export const caso = {
  numero: 9,
  nombre: "Anulación y corrección",
  critico: true,

  async correr({ admin, usuario, comprobar, alTerminar }) {
    const cliente = admin();

    const neto = async () => {
      const { data } = await cliente
        .from("eos_movimientos_financieros")
        .select("monto,tipo")
        .eq("usuario_id", usuario.id)
        .eq("origen", "erp");

      return (data ?? []).reduce(
        (t, m) => t + (m.tipo === "ingreso" ? Number(m.monto) : -Number(m.monto)),
        0,
      );
    };

    const stockDe = async (id) =>
      Number(
        (await cliente.from("eos_erp_productos").select("stock_actual").eq("id", id).single()).data
          .stock_actual,
      );

    const netoAntes = await neto();

    const { data: producto } = await cliente
      .from("eos_erp_productos")
      .insert({
        usuario_id: usuario.id,
        nombre: "CERT anulacion",
        precio_venta: 11_000,
        costo: 5_000,
        iva: 10,
        controla_stock: true,
        stock_actual: 100,
        unidad: "unidad",
      })
      .select("id")
      .single();

    alTerminar(async () => {
      await cliente.from("eos_erp_movimientos_stock").delete().eq("producto_id", producto.id);
      await cliente.from("eos_erp_productos").delete().eq("id", producto.id);
    });

    // ---------- Una venta mal cargada ----------
    const { data: venta } = await cliente.rpc("eos_erp_registrar_venta", {
      p_usuario_id: usuario.id,
      p_items: [{ producto_id: producto.id, cantidad: 7 }],
      p_cobrada: true,
    });

    alTerminar(async () => {
      await cliente.from("eos_erp_venta_items").delete().eq("venta_id", venta.venta_id);
      await cliente.from("eos_erp_ventas").delete().eq("id", venta.venta_id);
    });

    comprobar("la venta descuenta el stock", (await stockDe(producto.id)) === 93);
    comprobar("y suma la plata", (await neto()) === netoAntes + 77_000);

    // ---------- Sin motivo no se anula ----------
    const { error: sinMotivo } = await cliente.rpc("eos_erp_anular_venta", {
      p_usuario_id: usuario.id,
      p_venta_id: venta.venta_id,
    });

    comprobar(
      "no se puede anular sin decir por qué",
      String(sinMotivo?.message ?? "").includes("EOS_ANULACION_MOTIVO_REQUERIDO"),
    );

    // ---------- Anulada ----------
    const { data: anulacion, error: errorAnular } = await cliente.rpc("eos_erp_anular_venta", {
      p_usuario_id: usuario.id,
      p_venta_id: venta.venta_id,
      p_motivo: "cargada por error durante la certificación",
    });

    comprobar("se puede anular", !errorAnular, errorAnular?.message ?? "");
    comprobar("el stock vuelve al estante", (await stockDe(producto.id)) === 100);
    comprobar("la plata deja de figurar", (await neto()) === netoAntes);
    comprobar("y se anotó el movimiento de vuelta", anulacion?.productos_devueltos === 1);

    const { data: v } = await cliente
      .from("eos_erp_ventas")
      .select("estado,notas,movimiento_id")
      .eq("id", venta.venta_id)
      .single();

    comprobar("la venta queda marcada como anulada", v.estado === "anulada");
    comprobar("con el motivo escrito", String(v.notas ?? "").includes("certificación"));
    comprobar("y sin movimiento colgando", v.movimiento_id === null);

    // ---------- Dos veces no ----------
    const { data: otra } = await cliente.rpc("eos_erp_anular_venta", {
      p_usuario_id: usuario.id,
      p_venta_id: venta.venta_id,
      p_motivo: "doble clic",
    });

    comprobar("anular dos veces avisa que ya estaba", otra?.ya_estaba === true);
    comprobar("y no devuelve el stock dos veces", (await stockDe(producto.id)) === 100);

    // ---------- El rastro completo ----------
    const { data: movs } = await cliente
      .from("eos_erp_movimientos_stock")
      .select("tipo,cantidad,motivo")
      .eq("producto_id", producto.id)
      .order("creado_en");

    comprobar(
      "queda el rastro de la salida y de la vuelta",
      movs?.length === 2 && movs[0].tipo === "salida" && movs[1].tipo === "entrada",
      (movs ?? []).map((m) => `${m.tipo} ${m.cantidad}`).join(" · "),
    );

    // ---------- Corregir sin anular: el precio ----------
    const { error: errorPrecio } = await cliente
      .from("eos_erp_productos")
      .update({ precio_venta: 13_000 })
      .eq("id", producto.id)
      .eq("usuario_id", usuario.id);

    comprobar("se puede corregir el precio de un producto", !errorPrecio);

    // ---------- Ajustar el inventario ----------
    const { data: ajuste, error: errorAjuste } = await cliente.rpc("eos_erp_ajustar_stock", {
      p_usuario_id: usuario.id,
      p_producto_id: producto.id,
      p_stock_contado: 94,
      p_motivo: "conteo de certificación",
    });

    comprobar("se puede ajustar el stock contando", !errorAjuste, errorAjuste?.message ?? "");
    comprobar("queda en lo contado", (await stockDe(producto.id)) === 94);
    comprobar("con la diferencia anotada", Number(ajuste?.diferencia) === -6);

    const { error: errorSinMotivo } = await cliente.rpc("eos_erp_ajustar_stock", {
      p_usuario_id: usuario.id,
      p_producto_id: producto.id,
      p_delta: -1,
    });

    comprobar(
      "y tampoco se ajusta sin motivo",
      String(errorSinMotivo?.message ?? "").includes("EOS_AJUSTE_MOTIVO_REQUERIDO"),
    );

    // ---------- Lo ajeno no se toca ----------
    const { error: ajeno } = await cliente.rpc("eos_erp_ajustar_stock", {
      p_usuario_id: "00000000-0000-0000-0000-000000000000",
      p_producto_id: producto.id,
      p_stock_contado: 1,
      p_motivo: "intento ajeno",
    });

    comprobar(
      "nadie puede ajustar el stock de otra cuenta",
      String(ajeno?.message ?? "").includes("EOS_PRODUCTO_NO_EXISTE"),
    );
  },
};
