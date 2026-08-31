import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { CONFIG } from "../entorno.mjs";

/**
 * Que nadie alcance los datos de nadie. Probado, no afirmado.
 *
 * ============================================================
 * POR QUÉ NO ALCANZA CON "TIENE RLS"
 * ============================================================
 *
 * Cada tabla de EOS tiene su política de RLS, y hay migraciones enteras
 * dedicadas a endurecerlas. Eso es el diseño. Lo que faltaba era la evidencia:
 * el punto 43 de la lista pide *probar* que ningún usuario, rol, enlace o API
 * pueda consultar o modificar información ajena.
 *
 * La diferencia importa porque las tres formas en que esto se rompe no se ven
 * leyendo el esquema:
 *
 *   · una tabla nueva a la que alguien se olvidó de activarle RLS;
 *   · una política escrita con `using (true)` para salir del paso;
 *   · un `grant` a `anon` que quedó de una prueba.
 *
 * Ninguna de las tres se nota hasta que alguien la busca a propósito.
 *
 * ============================================================
 * LA LISTA DE TABLAS SE DESCUBRE SOLA
 * ============================================================
 *
 * No hay una lista escrita a mano acá. El caso lee las migraciones del propio
 * repositorio y saca de ahí todas las tablas con `usuario_id`, que son las que
 * guardan datos de una persona.
 *
 * Es a propósito: una lista a mano se desactualiza el día que alguien agrega
 * una tabla y no se acuerda de venir hasta acá — y ese es exactamente el día
 * en que esta prueba tendría que haber saltado. Descubriéndolas, una tabla
 * nueva queda cubierta desde que existe.
 *
 * ============================================================
 * DOS INTRUSOS, PORQUE SON DOS RIESGOS DISTINTOS
 * ============================================================
 *
 *   · **Con sesión.** Un usuario real de EOS mirando lo de otro. Lo frena la
 *     RLS, y es el caso más probable.
 *   · **Sin sesión.** Cualquiera con la clave pública, que está en el
 *     JavaScript del navegador y no es un secreto. Lo frena el `revoke` a
 *     `anon`. Es menos probable y mucho más grave.
 */

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const MIGRACIONES = path.resolve(AQUI, "..", "..", "supabase", "migrations");

/** Toda tabla `public.eos_*` que guarde un `usuario_id`. */
function tablasConDatosDeUnaPersona() {
  const tablas = new Set();

  for (const archivo of fs.readdirSync(MIGRACIONES)) {
    if (!archivo.endsWith(".sql")) continue;

    const sql = fs.readFileSync(path.join(MIGRACIONES, archivo), "utf8");
    const bloque = /create table if not exists\s+public\.([a-z0-9_]+)\s*\(([\s\S]*?)\n\)/gi;

    let m;
    while ((m = bloque.exec(sql))) {
      if (/usuario_id/.test(m[2])) tablas.add(m[1]);
    }
  }

  return [...tablas].sort();
}

/**
 * Qué pasó al intentar leer una tabla ajena.
 *
 * `no-alcanzable` no es una falla: una tabla que PostgREST no expone, o sobre
 * la que el rol no tiene permiso, es justamente lo que se quiere. La única
 * respuesta mala es que devuelva filas.
 */
async function intentarLeer(cliente, tabla, usuarioAjeno) {
  const { count, error } = await cliente
    .from(tabla)
    .select("usuario_id", { count: "exact", head: true })
    .eq("usuario_id", usuarioAjeno);

  if (error) return { estado: "no-alcanzable", detalle: error.code ?? error.message };
  if ((count ?? 0) > 0) return { estado: "FUGA", detalle: `${count} fila(s)` };

  return { estado: "vacio" };
}

export const caso = {
  numero: 12,
  nombre: "Aislamiento entre cuentas",
  critico: true,

  async correr({ admin, comprobar, alTerminar }) {
    const servicio = admin();
    const tablas = tablasConDatosDeUnaPersona();

    comprobar(
      "se descubren las tablas con datos de una persona",
      tablas.length >= 40,
      `${tablas.length} tablas leídas de las migraciones`,
    );

    // ---------- La víctima, con datos que valga la pena robar ----------
    const crearCuenta = async (etiqueta) => {
      const correo = `cert-${etiqueta}-${crypto.randomUUID().slice(0, 8)}@transtech.test`;
      const clave = crypto.randomUUID() + "Aa1!";

      const { data, error } = await servicio.auth.admin.createUser({
        email: correo,
        password: clave,
        email_confirm: true,
      });

      if (error || !data?.user) throw new Error(`no se pudo crear ${etiqueta}: ${error?.message}`);

      alTerminar(() => servicio.auth.admin.deleteUser(data.user.id).catch(() => {}));

      return { id: data.user.id, correo, clave };
    };

    const victima = await crearCuenta("victima");
    const intruso = await crearCuenta("intruso");

    const { error: errorDatos } = await servicio.from("eos_movimientos_financieros").insert({
      usuario_id: victima.id,
      tipo: "ingreso",
      monto: 7_777_777,
      moneda: "PYG",
      descripcion: "CERT secreto de la víctima",
      categoria: "ventas",
      fecha: new Date().toISOString().slice(0, 10),
      origen: "manual",
    });

    const { data: productoVictima } = await servicio
      .from("eos_erp_productos")
      .insert({
        usuario_id: victima.id,
        nombre: "CERT producto de la víctima",
        precio_venta: 12_345,
        iva: 10,
        unidad: "unidad",
      })
      .select("id")
      .single();

    comprobar("la víctima tiene datos que proteger", !errorDatos && Boolean(productoVictima?.id));

    // ---------- El intruso, con sesión de verdad ----------
    const conSesion = createClient(CONFIG.supabaseUrl, CONFIG.anonKey, {
      auth: { persistSession: false },
    });

    const { error: errorSesion } = await conSesion.auth.signInWithPassword({
      email: intruso.correo,
      password: intruso.clave,
    });

    comprobar("el intruso puede entrar a su propia cuenta", !errorSesion, errorSesion?.message ?? "");
    if (errorSesion) return;

    // ---------- 1. Leer, con sesión ----------
    const fugas = [];
    const noAlcanzables = [];

    for (const tabla of tablas) {
      const r = await intentarLeer(conSesion, tabla, victima.id);
      if (r.estado === "FUGA") fugas.push(`${tabla} (${r.detalle})`);
      if (r.estado === "no-alcanzable") noAlcanzables.push(tabla);
    }

    comprobar(
      `ninguna de las ${tablas.length} tablas le devuelve filas ajenas a un usuario con sesión`,
      fugas.length === 0,
      fugas.length === 0
        ? `${tablas.length - noAlcanzables.length} consultadas · ${noAlcanzables.length} no expuestas`
        : `FUGAS: ${fugas.join(", ")}`,
    );

    // ---------- 2. Leer, sin sesión ----------
    //
    // La clave pública está en el JavaScript que sirve el navegador: no es un
    // secreto y cualquiera la tiene. Lo único que separa a un curioso de los
    // datos de todos es el `revoke` a `anon`.
    const sinSesion = createClient(CONFIG.supabaseUrl, CONFIG.anonKey, {
      auth: { persistSession: false },
    });

    const fugasAnon = [];

    for (const tabla of tablas) {
      const r = await intentarLeer(sinSesion, tabla, victima.id);
      if (r.estado === "FUGA") fugasAnon.push(`${tabla} (${r.detalle})`);
    }

    comprobar(
      `y tampoco a alguien sin sesión, con sólo la clave pública`,
      fugasAnon.length === 0,
      fugasAnon.length === 0 ? "" : `FUGAS: ${fugasAnon.join(", ")}`,
    );

    // ---------- 3. Escribir sobre lo ajeno ----------
    const { data: editado } = await conSesion
      .from("eos_erp_productos")
      .update({ precio_venta: 1 })
      .eq("id", productoVictima.id)
      .select("id");

    comprobar(
      "no puede cambiarle el precio a un producto ajeno",
      (editado?.length ?? 0) === 0,
      (editado?.length ?? 0) === 0 ? "" : "editó una fila ajena",
    );

    const { data: precioReal } = await servicio
      .from("eos_erp_productos")
      .select("precio_venta")
      .eq("id", productoVictima.id)
      .maybeSingle();

    comprobar(
      "y el precio de la víctima quedó intacto",
      Number(precioReal?.precio_venta) === 12_345,
      `quedó en ${precioReal?.precio_venta}`,
    );

    const { data: borrado } = await conSesion
      .from("eos_erp_productos")
      .delete()
      .eq("id", productoVictima.id)
      .select("id");

    comprobar(
      "no puede borrarle un producto",
      (borrado?.length ?? 0) === 0,
      (borrado?.length ?? 0) === 0 ? "" : "borró una fila ajena",
    );

    // ---------- 4. Escribir A NOMBRE de otro ----------
    //
    // El reverso del anterior, y el que se olvida: no alcanza con que no pueda
    // leer lo ajeno si puede meterle un movimiento en su panel.
    const { error: errorInsertar } = await conSesion.from("eos_movimientos_financieros").insert({
      usuario_id: victima.id,
      tipo: "gasto",
      monto: 999_999,
      moneda: "PYG",
      descripcion: "CERT gasto plantado por un tercero",
      categoria: "otros",
      fecha: new Date().toISOString().slice(0, 10),
      origen: "manual",
    });

    comprobar("no puede plantarle un movimiento a otra cuenta", Boolean(errorInsertar), errorInsertar?.code ?? "");

    const { count: plantados } = await servicio
      .from("eos_movimientos_financieros")
      .select("id", { count: "exact", head: true })
      .eq("usuario_id", victima.id)
      .eq("descripcion", "CERT gasto plantado por un tercero");

    comprobar("y en el panel de la víctima no aparece nada plantado", (plantados ?? 0) === 0);

    // ---------- 5. Las funciones que se saltan la RLS ----------
    //
    // Son `security definer`: la RLS no las cubre y tienen que filtrar por
    // dueño adentro. Si alguna se olvidara, este es el único lugar donde se
    // vería.
    const rpcAjenas = [
      ["eos_exportar_mis_datos_v56", {}],
      ["eos_borrar_mis_datos_v55", {}],
    ];

    for (const [nombre, args] of rpcAjenas) {
      const { data, error } = await conSesion.rpc(nombre, args);
      const texto = JSON.stringify(data ?? {});

      comprobar(
        `${nombre} sólo alcanza los datos de quien la llama`,
        !texto.includes("CERT secreto de la víctima"),
        error?.message?.slice(0, 60) ?? "",
      );
    }

    // ---------- 6. El producto de la víctima sigue vivo ----------
    const { data: sobrevivio } = await servicio
      .from("eos_erp_productos")
      .select("id,nombre")
      .eq("id", productoVictima.id)
      .maybeSingle();

    comprobar(
      "después de todos los intentos, los datos de la víctima siguen enteros",
      sobrevivio?.nombre === "CERT producto de la víctima",
      sobrevivio ? "" : "el producto desapareció",
    );
  },
};
