/**
 * La primera venta y la primera compra.
 *
 * ============================================================
 * EL PUENTE ENTRE EL MOSTRADOR Y LA PLATA
 * ============================================================
 *
 * Un ERP que no habla con las finanzas obliga a cargar todo dos veces, y a la
 * semana nadie carga nada. Lo que se certifica acá es ese puente:
 *
 *   · El IVA se SACA del precio, no se suma. Los precios en Paraguay se dicen
 *     con IVA adentro; sumarlo factura un 10% de más sobre cada línea.
 *   · Una venta cobrada entra al panel financiero. Una a crédito NO, porque esa
 *     plata todavía no está y mostrarla haría que alguien gaste lo que no tiene.
 *   · El stock se mueve dejando rastro, nunca en silencio.
 */

export const caso = {
  numero: 8,
  nombre: "Primera venta y primera compra",
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

    const netoAntes = await neto();

    // ---------- Un producto ----------
    const { data: producto, error: errorProducto } = await cliente
      .from("eos_erp_productos")
      .insert({
        usuario_id: usuario.id,
        nombre: "CERT chipa",
        precio_venta: 11_000,
        iva: 10,
        controla_stock: true,
        stock_actual: 50,
        unidad: "unidad",
      })
      .select("id")
      .single();

    comprobar("se puede cargar un producto", !errorProducto, errorProducto?.message ?? "");
    if (!producto) return;

    alTerminar(async () => {
      await cliente.from("eos_erp_movimientos_stock").delete().eq("producto_id", producto.id);
      await cliente.from("eos_erp_productos").delete().eq("id", producto.id);
    });

    // ---------- Un cliente ----------
    const { data: contacto } = await cliente
      .from("eos_crm_contactos")
      .insert({
        usuario_id: usuario.id,
        nombre: "CERT Rossana",
        tipo: "persona",
        es_cliente: true,
      })
      .select("id")
      .single();

    alTerminar(() => cliente.from("eos_crm_contactos").delete().eq("id", contacto.id));

    // ---------- Venta al contado ----------
    const { data: venta, error: errorVenta } = await cliente.rpc("eos_erp_registrar_venta", {
      p_usuario_id: usuario.id,
      p_items: [{ producto_id: producto.id, cantidad: 3 }],
      p_contacto_id: contacto.id,
      p_cobrada: true,
    });

    comprobar("se puede registrar una venta", !errorVenta, errorVenta?.message ?? "");
    if (!venta?.venta_id) return;

    alTerminar(async () => {
      await cliente.from("eos_erp_venta_items").delete().eq("venta_id", venta.venta_id);
      await cliente.from("eos_erp_ventas").delete().eq("id", venta.venta_id);
    });

    comprobar("el total son 3 por 11.000", Number(venta.total) === 33_000, `Gs. ${venta.total}`);

    /* 33.000 con IVA 10% adentro: el impuesto es 33.000/11 = 3.000. */
    comprobar(
      "el IVA se saca del precio y no se suma",
      Number(venta.iva_total) === 3_000,
      `IVA Gs. ${venta.iva_total} sobre Gs. ${venta.total}`,
    );

    comprobar(
      "y el subtotal más el IVA da el total",
      Number(venta.subtotal) + Number(venta.iva_total) === Number(venta.total),
    );

    const { data: p1 } = await cliente
      .from("eos_erp_productos")
      .select("stock_actual")
      .eq("id", producto.id)
      .single();

    comprobar("el stock baja", Number(p1.stock_actual) === 47, String(p1.stock_actual));

    const { data: movStock } = await cliente
      .from("eos_erp_movimientos_stock")
      .select("tipo,cantidad,saldo_resultante")
      .eq("referencia_id", venta.venta_id)
      .maybeSingle();

    comprobar(
      "dejando su movimiento con el saldo que quedó",
      movStock?.tipo === "salida" && Number(movStock?.saldo_resultante) === 47,
    );

    comprobar(
      "la venta cobrada entra al panel financiero",
      (await neto()) === netoAntes + 33_000,
    );

    // ---------- Venta a crédito ----------
    const netoTrasContado = await neto();

    const { data: credito } = await cliente.rpc("eos_erp_registrar_venta", {
      p_usuario_id: usuario.id,
      p_items: [{ producto_id: producto.id, cantidad: 1 }],
      p_contacto_id: contacto.id,
      p_condicion: "credito",
      p_cobrada: false,
    });

    alTerminar(async () => {
      await cliente.from("eos_erp_venta_items").delete().eq("venta_id", credito.venta_id);
      await cliente.from("eos_erp_ventas").delete().eq("id", credito.venta_id);
    });

    comprobar(
      "una venta a crédito NO suma plata que todavía no está",
      (await neto()) === netoTrasContado,
    );

    // ---------- Y cuando se cobra, sí ----------
    const { error: errorCobrar } = await cliente.rpc("eos_erp_cobrar_venta", {
      p_usuario_id: usuario.id,
      p_venta_id: credito.venta_id,
    });

    comprobar("se puede cobrar después", !errorCobrar, errorCobrar?.message ?? "");
    comprobar(
      "y ahí sí entra al panel",
      (await neto()) === netoTrasContado + 11_000,
    );

    const { data: repetido } = await cliente.rpc("eos_erp_cobrar_venta", {
      p_usuario_id: usuario.id,
      p_venta_id: credito.venta_id,
    });

    comprobar(
      "cobrar dos veces no duplica el ingreso",
      repetido?.ya_estaba === true && (await neto()) === netoTrasContado + 11_000,
    );

    // ---------- Compra ----------
    const netoTrasVentas = await neto();

    const { data: compra, error: errorCompra } = await cliente.rpc("eos_erp_registrar_compra", {
      p_usuario_id: usuario.id,
      p_items: [{ producto_id: producto.id, cantidad: 20, precio_unitario: 6_000 }],
      p_pagada: true,
    });

    comprobar("se puede registrar una compra", !errorCompra, errorCompra?.message ?? "");
    if (!compra?.compra_id) return;

    alTerminar(async () => {
      await cliente.from("eos_erp_compra_items").delete().eq("compra_id", compra.compra_id);
      await cliente.from("eos_erp_compras").delete().eq("id", compra.compra_id);
    });

    const { data: p2 } = await cliente
      .from("eos_erp_productos")
      .select("stock_actual,costo")
      .eq("id", producto.id)
      .single();

    comprobar("la compra sube el stock", Number(p2.stock_actual) === 66, String(p2.stock_actual));
    comprobar("y actualiza el costo", Number(p2.costo) === 6_000, String(p2.costo));

    comprobar(
      "una compra pagada sale del panel financiero",
      (await neto()) === netoTrasVentas - 120_000,
    );
  },
};
