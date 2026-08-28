/**
 * Que el primer día tenga principio y final.
 *
 * ============================================================
 * POR QUÉ ES CRÍTICO Y NO "DESEABLE"
 * ============================================================
 *
 * El onboarding es donde se decide si alguien vuelve. Alguien que paga, entra,
 * ve una pantalla vacía y no sabe qué hacer, no se queja: se va. Y eso no
 * aparece en ninguna métrica de error.
 *
 * Lo que esta prueba cuida es que el recorrido sea recorrible: que exista desde
 * el primer minuto, que avance, que se pueda terminar, y que una vez terminado
 * no vuelva a empezar. Un onboarding que reaparece cada vez que alguien entra
 * es peor que no tenerlo.
 *
 * Que las preguntas sean las correctas, y que el tono acompañe, no lo puede
 * juzgar una prueba automática. Eso está en la lista de revisión a mano.
 */

import crypto from "node:crypto";

const PASOS = [
  "bienvenida",
  "cuentas",
  "ingresos",
  "gastos_fijos",
  "deudas",
  "preocupaciones",
  "correo",
  "cierre",
  "completado",
];

export const caso = {
  numero: 7,
  nombre: "Onboarding: el primer día",
  critico: true,

  async correr({ admin, comprobar, alTerminar }) {
    const cliente = admin();

    /* Una cuenta nueva de verdad: el onboarding es lo primero que ve. */
    const { data: creado, error } = await cliente.auth.admin.createUser({
      email: `cert-onb-${crypto.randomUUID().slice(0, 8)}@transtech.test`,
      password: crypto.randomUUID(),
      email_confirm: true,
      user_metadata: { nombre: "Recién llegada" },
    });

    comprobar("se puede crear la cuenta de prueba", !error, error?.message ?? "");
    if (!creado?.user) return;

    const id = creado.user.id;
    alTerminar(() => cliente.auth.admin.deleteUser(id));

    // ---------- Arranca ----------
    const { error: errorInicio } = await cliente
      .from("eos_onboarding")
      .insert({ usuario_id: id, paso: "bienvenida" });

    comprobar("el recorrido arranca en la bienvenida", !errorInicio, errorInicio?.message ?? "");

    // ---------- Avanza paso por paso ----------
    const noAvanzan = [];

    for (const paso of PASOS) {
      const { error: e } = await cliente
        .from("eos_onboarding")
        .update({ paso, updated_at: new Date().toISOString() })
        .eq("usuario_id", id);

      if (e) noAvanzan.push(`${paso} (${e.message})`);
    }

    comprobar(
      `los ${PASOS.length} pasos del recorrido son válidos`,
      noAvanzan.length === 0,
      noAvanzan.join("; "),
    );

    // ---------- Un paso inventado no entra ----------
    const { error: errorPaso } = await cliente
      .from("eos_onboarding")
      .update({ paso: "paso_que_no_existe" })
      .eq("usuario_id", id);

    comprobar("un paso que no existe se rechaza", Boolean(errorPaso));

    // ---------- Se cierra y queda cerrado ----------
    await cliente
      .from("eos_onboarding")
      .update({ paso: "completado", completado_en: new Date().toISOString() })
      .eq("usuario_id", id);

    const { data: final } = await cliente
      .from("eos_onboarding")
      .select("paso,completado_en")
      .eq("usuario_id", id)
      .maybeSingle();

    comprobar("se puede terminar", final?.paso === "completado");
    comprobar("y queda registrado cuándo", Boolean(final?.completado_en));

    // ---------- No se duplica ----------
    const { error: errorDuplicado } = await cliente
      .from("eos_onboarding")
      .insert({ usuario_id: id, paso: "bienvenida" });

    comprobar(
      "no puede volver a empezar por accidente",
      Boolean(errorDuplicado),
      errorDuplicado ? "" : "se creó un segundo onboarding para el mismo usuario",
    );

    // ---------- La API pide sesión ----------
    const sinSesion = await fetch("https://www.transtech.com.py/api/onboarding", {
      cache: "no-store",
    }).catch(() => null);

    comprobar("la API de onboarding pide sesión", sinSesion?.status === 401);
  },
};
