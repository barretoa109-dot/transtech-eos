import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { CONFIG } from "../entorno.mjs";

/**
 * Llevarse lo suyo, e irse.
 *
 * ============================================================
 * NO ES SÓLO UN REQUISITO DE TIENDA
 * ============================================================
 *
 * Apple y Google lo exigen para publicar, pero además es lo correcto: quien se
 * va tiene derecho a llevarse sus datos, y quien pide que lo borren tiene
 * derecho a que lo borren de verdad.
 *
 * Lo que se certifica acá es que las dos cosas pasen **de verdad**:
 *
 *   · La exportación trae los datos, no un archivo vacío con buena intención.
 *   · El borrado borra. Si quedaran las ventas de alguien que pidió irse,
 *     tendríamos datos de una persona que ya no nos autorizó a tenerlos.
 *
 * Y una cosa más: las dos funciones usan `auth.uid()`, así que se prueban con
 * una sesión de verdad y no con la clave de servicio. Probarlas con el rol de
 * servicio pasaría por alto justamente lo que las protege — que cada quien sólo
 * pueda exportar y borrar lo propio.
 */

export const caso = {
  numero: 10,
  nombre: "Exportar los datos y eliminar la cuenta",
  critico: true,

  async correr({ admin, comprobar, alTerminar }) {
    const servicio = admin();

    const correo = `cert-baja-${crypto.randomUUID().slice(0, 8)}@transtech.test`;
    const clave = crypto.randomUUID() + "Aa1!";

    const { data: creado, error } = await servicio.auth.admin.createUser({
      email: correo,
      password: clave,
      email_confirm: true,
      user_metadata: { nombre: "Se va" },
    });

    comprobar("se crea la cuenta descartable", !error, error?.message ?? "");
    if (!creado?.user) return;

    const id = creado.user.id;

    // Si el borrado falla, la cuenta se limpia igual: no queda basura.
    alTerminar(() => servicio.auth.admin.deleteUser(id).catch(() => {}));

    // ---------- Datos suyos, para ver si viajan y si se borran ----------
    const { data: producto } = await servicio
      .from("eos_erp_productos")
      .insert({
        usuario_id: id,
        nombre: "CERT se va",
        precio_venta: 9_000,
        iva: 10,
        unidad: "unidad",
      })
      .select("id")
      .single();

    await servicio.from("eos_movimientos_financieros").insert({
      usuario_id: id,
      tipo: "ingreso",
      monto: 250_000,
      moneda: "PYG",
      descripcion: "CERT movimiento propio",
      categoria: "ventas",
      fecha: new Date().toISOString().slice(0, 10),
      origen: "manual",
    });

    // ---------- Su sesión ----------
    const suyo = createClient(CONFIG.supabaseUrl, CONFIG.anonKey, {
      auth: { persistSession: false },
    });

    const { error: errorSesion } = await suyo.auth.signInWithPassword({
      email: correo,
      password: clave,
    });

    comprobar("puede iniciar sesión", !errorSesion, errorSesion?.message ?? "");
    if (errorSesion) return;

    // ---------- Exportar ----------
    const { data: exportado, error: errorExportar } = await suyo.rpc("eos_exportar_mis_datos_v56");

    comprobar("puede exportar sus datos", !errorExportar, errorExportar?.message ?? "");

    const texto = JSON.stringify(exportado ?? {});

    comprobar(
      "y la exportación trae algo, no viene vacía",
      texto.length > 50,
      `${texto.length} caracteres`,
    );

    comprobar(
      "con sus movimientos adentro",
      texto.includes("CERT movimiento propio"),
      texto.includes("CERT movimiento propio") ? "" : "no encontré el movimiento en la exportación",
    );

    // ---------- Borrar ----------
    const { error: errorBorrar } = await suyo.rpc("eos_borrar_mis_datos_v55");

    comprobar("puede pedir que lo borren", !errorBorrar, errorBorrar?.message ?? "");

    const quedan = async (tabla) => {
      const { count } = await servicio
        .from(tabla)
        .select("id", { count: "exact", head: true })
        .eq("usuario_id", id);

      return count ?? 0;
    };

    comprobar("sus movimientos se borran", (await quedan("eos_movimientos_financieros")) === 0);
    comprobar("sus productos también", (await quedan("eos_erp_productos")) === 0);

    if (producto?.id) {
      const { data: rastro } = await servicio
        .from("eos_erp_productos")
        .select("id")
        .eq("id", producto.id)
        .maybeSingle();

      comprobar("no queda ni el rastro del producto", !rastro);
    }

    // ---------- Y no puede tocar lo de otro ----------
    const { data: ajeno } = await suyo
      .from("eos_erp_productos")
      .select("id")
      .neq("usuario_id", id)
      .limit(1);

    comprobar(
      "nunca pudo ver datos de otra cuenta",
      (ajeno?.length ?? 0) === 0,
      (ajeno?.length ?? 0) === 0 ? "" : "leyó filas ajenas",
    );
  },
};
