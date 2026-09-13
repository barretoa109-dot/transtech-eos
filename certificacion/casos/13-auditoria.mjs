/**
 * Que la bitácora sea prueba de algo. Verificado, no afirmado.
 *
 * ============================================================
 * QUÉ SE COMPRUEBA
 * ============================================================
 *
 * `eos_auditoria_v60` promete tres cosas: que nada se reescribe, que cada fila
 * engancha con la anterior, y que ninguna credencial de la aplicación —ni la
 * de servicio— puede alterar el pasado. Las tres se pueden romper sin que nada
 * falle: un trigger deshabilitado a mano "para una corrección", un `grant` que
 * alguien agregó para salir del paso, una migración que cambia la función del
 * hash y deja todas las filas viejas sin calzar.
 *
 * Desde la v163 promete una cuarta: que lo que EOS hace desde el chat queda
 * asentado. Hasta ese día no quedaba nada — 64 órdenes y ninguna fila.
 *
 * ============================================================
 * POR QUÉ NO ESCRIBE NADA
 * ============================================================
 *
 * Los demás casos crean usuarios y los borran al terminar. Este no puede: la
 * bitácora es append-only, y una fila de prueba quedaría ahí para siempre.
 * Todo sale de `eos_auditoria_salud_v163()`, que recalcula cada sello con la
 * misma función que los escribió y lee triggers y permisos del catálogo.
 */
export const caso = {
  numero: 13,
  nombre: "Bitácora inmutable",
  critico: true,

  async correr({ admin, comprobar }) {
    const { data, error } = await admin().rpc("eos_auditoria_salud_v163");

    if (error || !data) {
      throw new Error(`no se pudo leer la salud de la bitácora: ${error?.message ?? "sin datos"}`);
    }

    const s = data;

    comprobar(
      "ninguna cadena tiene huecos, desenganches ni sellos rotos",
      s.huecos === 0 && s.desenganches === 0 && s.sellos_rotos === 0,
      `${s.filas} filas en ${s.cadenas} cadenas · ${s.huecos} huecos · ${s.desenganches} desenganches · ${s.sellos_rotos} sellos rotos`,
    );
    comprobar("cada fila se numera y se sella sola", s.trigger_sellar === true, "eos_auditoria_sellar_trg");
    comprobar(
      "ninguna fila se puede editar ni borrar",
      s.trigger_solo_agregar === true,
      "eos_auditoria_solo_agregar_trg",
    );
    comprobar(
      "la clave de servicio no puede reescribir el pasado",
      s.service_role_puede_reescribir === false,
      "sin UPDATE, DELETE ni TRUNCATE para service_role",
    );
    comprobar(
      "una sesión de usuario no puede fabricar registros",
      s.authenticated_puede_escribir === false,
      "authenticated solo lee lo propio",
    );
    comprobar("la clave pública no lee la bitácora", s.anon_puede_leer === false, "revoke a anon");
    comprobar(
      "lo que EOS hace desde el chat queda asentado",
      s.trigger_ordenes_del_chat === true,
      `${s.filas_del_chat} filas del chat hasta hoy`,
    );
  },
};
