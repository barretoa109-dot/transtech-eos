import { aprobada, cobrar, esCobroRepetido, tarjetasDe } from "../bancard.mjs";

/**
 * Que cuando se vence se apague, y que cuando vuelve a pagar vuelva completo.
 *
 * ============================================================
 * LA RECUPERACIÓN ES LA MITAD OLVIDADA
 * ============================================================
 *
 * Que un módulo vencido deje de funcionar lo prueba todo el mundo. Lo que casi
 * nunca se prueba es la vuelta: alguien que se atrasó, pagó, y necesita que su
 * EOS esté como lo dejó.
 *
 * Y ahí hay una promesa que no se puede romper: **sus datos siguen ahí**. El
 * módulo se apaga, las ventas no se borran. Si alguien vuelve después de un mes
 * y encuentra su inventario vacío, no vuelve una segunda vez.
 */

const DIA = 24 * 60 * 60 * 1000;

export const caso = {
  numero: 6,
  nombre: "Vencimiento y recuperación",
  critico: true,

  async correr({ admin, usuario, comprobar, sinProbar, alTerminar }) {
    const cliente = admin();

    const { data: modulosAntes } = await cliente
      .from("eos_usuario_modulos")
      .select("*")
      .eq("usuario_id", usuario.id);

    /*
     * También el perfil, no sólo los módulos.
     *
     * Este caso paga de verdad, y confirmar un pago reescribe el plan según el
     * tramo de conversaciones que tenga el armado. Como acá se compra sólo el
     * ERP, el plan queda en `free` — que es lo correcto para esa compra, pero
     * deja la cuenta distinta de como estaba. Sin reponerlo, cada corrida
     * desvía un poco más la cuenta de certificación y en algún momento un caso
     * falla por un motivo que no tiene nada que ver con lo que prueba.
     */
    const { data: perfilAntes } = await cliente
      .from("usuarios")
      .select("plan,plan_vencimiento,estado_suscripcion,cancelar_al_vencimiento")
      .eq("id", usuario.id)
      .single();

    alTerminar(async () => {
      await cliente.from("eos_usuario_modulos").delete().eq("usuario_id", usuario.id);
      if (modulosAntes?.length) await cliente.from("eos_usuario_modulos").insert(modulosAntes);
      if (perfilAntes) await cliente.from("usuarios").update(perfilAntes).eq("id", usuario.id);
    });

    const tiene = async (codigo) =>
      (await cliente.rpc("eos_tiene_modulo", { p_usuario_id: usuario.id, p_modulo: codigo }))
        .data === true;

    // ---------- Un dato del usuario, para ver si sobrevive ----------
    const { data: producto } = await cliente
      .from("eos_erp_productos")
      .insert({
        usuario_id: usuario.id,
        nombre: "CERT vencimiento",
        precio_venta: 7000,
        iva: 10,
        unidad: "unidad",
      })
      .select("id")
      .single();

    alTerminar(() => cliente.from("eos_erp_productos").delete().eq("id", producto.id));

    // ---------- Vencido ----------
    await cliente.from("eos_usuario_modulos").delete().eq("usuario_id", usuario.id);
    await cliente.from("eos_usuario_modulos").insert({
      usuario_id: usuario.id,
      modulo_codigo: "erp",
      estado: "activo",
      vencimiento: new Date(Date.now() - DIA).toISOString(),
      origen: "pago",
    });

    comprobar("un módulo vencido deja de funcionar", !(await tiene("erp")));

    const { data: sobrevive } = await cliente
      .from("eos_erp_productos")
      .select("id,nombre")
      .eq("id", producto.id)
      .maybeSingle();

    comprobar(
      "pero sus datos siguen ahí, no se borran",
      sobrevive?.nombre === "CERT vencimiento",
    );

    // ---------- La API también lo respeta ----------
    const respuesta = await fetch("https://www.transtech.com.py/api/erp/productos", {
      cache: "no-store",
    }).catch(() => null);

    comprobar(
      "la API del ERP no atiende sin sesión",
      respuesta?.status === 401,
      String(respuesta?.status ?? "sin respuesta"),
    );

    // ---------- Vuelve a pagar ----------
    const { data: mapeo } = await cliente
      .from("eos_bancard_usuarios_v51")
      .select("bancard_user_id")
      .eq("usuario_id", usuario.id)
      .maybeSingle();

    const { data: tarjeta } = await cliente
      .from("eos_bancard_tarjetas_v51")
      .select("id,bancard_card_id")
      .eq("usuario_id", usuario.id)
      .eq("estado", "activa")
      .limit(1)
      .maybeSingle();

    if (!mapeo?.bancard_user_id || !tarjeta) {
      comprobar("hay tarjeta para probar la recuperación", false);
      return;
    }

    const { data: armado } = await cliente.rpc("eos_guardar_armado", {
      p_usuario_id: usuario.id,
      p_modulos: ["erp"],
      p_periodicidad: "mensual",
    });

    const armadoId = armado?.armado_id ?? armado?.id;
    alTerminar(() => cliente.from("eos_planes_armados").delete().eq("id", armadoId));

    const { data: cobro } = await cliente.rpc("eos_bancard_crear_pago_armado_v71", {
      p_usuario_id: usuario.id,
      p_armado_id: armadoId,
      p_tarjeta_id: tarjeta.id,
    });

    alTerminar(() =>
      cliente
        .from("solicitudes_pago")
        .delete()
        .eq("referencia_externa", String(cobro.shop_process_id)),
    );

    const tarjetas = await tarjetasDe(mapeo.bancard_user_id);
    const elegida = tarjetas.find((t) => Number(t.card_id) === Number(tarjeta.bancard_card_id));

    const operacion = await cobrar({
      shopProcessId: cobro.shop_process_id,
      monto: cobro.monto,
      aliasToken: elegida?.alias_token,
      descripcion: "EOS recupera",
    });

    if (operacion.process_id) {
      comprobar("el cobro pidió 3DS", true, "verificar a mano");
      return;
    }

    if (esCobroRepetido(operacion)) {
      sinProbar("la recuperación tras pagar de nuevo", "Bancard bloquea el mismo importe sobre la misma tarjeta por 5 minutos. Esperá y volvé a correr este caso.");
      return;
    }

    /*
     * Con el detalle de Bancard, siempre.
     *
     * Una comprobación que falla y no dice por qué obliga a rehacer a mano lo
     * que la suite acaba de hacer. Acá el motivo importa especialmente: no es
     * lo mismo que la tarjeta rechace a que le hayamos mandado mal el monto.
     */
    comprobar(
      "el pago de recuperación se aprueba",
      aprobada(operacion),
      `${operacion.response ?? "?"}/${operacion.response_code ?? "?"} ${
        operacion.response_description ?? operacion.response_details ?? JSON.stringify(operacion).slice(0, 120)
      }`,
    );

    await cliente.rpc("eos_bancard_confirmar_cobro_v51", {
      p_shop_process_id: String(cobro.shop_process_id),
      p_aprobado: aprobada(operacion),
      p_detalle: { origen: "certificacion_recuperacion" },
    });

    comprobar("y el módulo vuelve a funcionar", await tiene("erp"));

    const { data: vuelve } = await cliente
      .from("eos_usuario_modulos")
      .select("vencimiento,origen")
      .eq("usuario_id", usuario.id)
      .eq("modulo_codigo", "erp")
      .maybeSingle();

    comprobar(
      "con un vencimiento nuevo hacia adelante",
      vuelve?.vencimiento && new Date(vuelve.vencimiento).getTime() > Date.now(),
      vuelve?.vencimiento ?? "",
    );

    const { data: intacto } = await cliente
      .from("eos_erp_productos")
      .select("nombre")
      .eq("id", producto.id)
      .maybeSingle();

    comprobar("y encuentra sus datos como los dejó", intacto?.nombre === "CERT vencimiento");
  },
};
