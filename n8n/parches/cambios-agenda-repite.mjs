/**
 * "El 25 de cada mes": lo que se repite, dicho por el chat.
 *
 * ============================================================
 * QUÉ AGREGA SOBRE `cambios-agenda-por-chat.mjs`
 * ============================================================
 *
 * Aquel parche hizo que "tengo que pagar los salarios el 25" llegara al Calendario
 * como UNA tarea. Éste hace que "todos los meses el 25" llegue como una tarea que se
 * repite, y no como una que hay que volver a pedir cada mes.
 *
 * Tiene que aplicarse DESPUÉS de aquél: las anclas son su texto.
 *
 * ============================================================
 * LOS TRES LUGARES, OTRA VEZ
 * ============================================================
 *
 * Igual que con la fecha, `repite` se pierde en silencio si falta en cualquiera:
 *
 *   1. El prompt: sin él, el modelo no sabe que existe y manda una tarea suelta.
 *   2. El nodo `06 GW Preparar Jobs Worker`: una lista explícita que descarta lo que
 *      no nombra. Entra SOLO si la persona lo dijo (ver la razón en
 *      `cambios-agenda-por-chat.mjs`: la huella exactly-once).
 *   3. La frase del worker: si dijera solo "para el 25 de septiembre", la persona
 *      creería que se anotó una vez.
 *
 * Y del lado de la base, la v191 (ejecutor). ORDEN: la v191 se aplica ANTES.
 *
 * El prompt no puede tener comillas invertidas ni la secuencia dólar-llave.
 */

export const CAMBIOS_PROMPT = [
  {
    donde: "CREAR_TAREA: la forma de los datos incluye repite",
    viejo: "           vence_semana?, vence_el?, hora? }",
    nuevo: "           vence_semana?, vence_el?, hora?, repite? }",
  },
  {
    donde: "CREAR_TAREA: qué es repetir",
    viejo: [
      "  Si no dicen cuándo, no lo preguntes: mandá la tarea igual, sin fecha.",
      "",
      "GUARDAR_MEMORIA",
    ].join("\n"),
    nuevo: [
      "  repite: diaria, semanal, mensual o anual, SOLO si dicen que se repite:",
      "    \"el 25 de cada mes\", \"todos los meses el 25\" → repite mensual y vence_dia 25",
      "    \"todos los lunes\", \"cada semana\" → repite semanal (y vence_semana si dicen el día)",
      "    \"todos los días\" → diaria; \"todos los años\", \"cada año\" → anual",
      "  Una tarea que se repite es UNA sola, no una por mes. Necesita el día en que",
      "  empieza: mandá también vence_dia, vence_en_dias o vence_semana. Sin eso, no",
      "  mandes repite.",
      "  Si no dicen cuándo, no lo preguntes: mandá la tarea igual, sin fecha.",
      "",
      "GUARDAR_MEMORIA",
    ].join("\n"),
  },
];

/** El nodo `06 GW Preparar Jobs Worker` del gateway. */
export const CAMBIOS_JOBS = [
  {
    donde: "CREAR_TAREA: repite se recoge como los demás campos de fecha",
    viejo: "    for (const campo of ['vence_dia', 'vence_en_dias', 'vence_semana', 'vence_el', 'hora']) {",
    nuevo: "    for (const campo of ['vence_dia', 'vence_en_dias', 'vence_semana', 'vence_el', 'hora', 'repite']) {",
  },
];

export const CAMBIOS_WORKER = [
  {
    donde: "la frase de la tarea dice cada cuánto se repite",
    viejo: [
      "  let frase = 'Listo, lo anoté en tu Calendario para el ' + fechaLarga(r.fecha_limite);",
      "  if (r.hora) frase += ' a las ' + r.hora;",
    ].join("\n"),
    nuevo: [
      "  /*",
      "    Si se repite, lo dice: \"para el 25\" a secas suena a una sola vez, y quien pidió",
      "    \"todos los meses\" se quedaría creyendo que tiene que volver a pedirlo (v191).",
      "  */",
      "  const cadaCuanto = {",
      "    diaria: 'todos los días',",
      "    semanal: 'todas las semanas',",
      "    mensual: 'todos los meses',",
      "    anual: 'todos los años'",
      "  }[r.repite];",
      "",
      "  let frase = cadaCuanto",
      "    ? 'Listo, lo anoté en tu Calendario ' + cadaCuanto + ', desde el ' + fechaLarga(r.fecha_limite)",
      "    : 'Listo, lo anoté en tu Calendario para el ' + fechaLarga(r.fecha_limite);",
      "  if (r.hora) frase += ' a las ' + r.hora;",
    ].join("\n"),
  },
];

function aplicar(texto, cambios, etiqueta) {
  let salida = texto;

  for (const c of cambios) {
    if (c.nuevo.includes("`")) throw new Error(`[${etiqueta}] comilla invertida en "${c.donde}"`);
    if (c.nuevo.includes("${")) throw new Error(`[${etiqueta}] dólar-llave en "${c.donde}"`);

    const partes = salida.split(c.viejo);
    if (partes.length !== 2) {
      throw new Error(`[${etiqueta}] "${c.donde}": aparece ${partes.length - 1} veces, no 1. No se escribió nada.`);
    }
    salida = partes.join(c.nuevo);
  }

  return salida;
}

export function aplicarPrompt(texto, etiqueta = "prompt") {
  if (texto.includes("hora?, repite? }")) {
    throw new Error(`[${etiqueta}] el prompt ya conoce repite. No se escribió nada.`);
  }
  if (!texto.includes("vence_semana")) {
    throw new Error(`[${etiqueta}] falta el parche de fechas por chat: aplicá primero cambios-agenda-por-chat.`);
  }
  return aplicar(texto, CAMBIOS_PROMPT, etiqueta);
}

export function aplicarJobs(codigo, etiqueta = "06 GW Preparar Jobs Worker") {
  if (codigo.includes("'hora', 'repite'")) {
    throw new Error(`[${etiqueta}] el nodo ya conoce repite. No se escribió nada.`);
  }
  return aplicar(codigo, CAMBIOS_JOBS, etiqueta);
}

export function aplicarWorker(codigo, etiqueta = "worker") {
  if (codigo.includes("const cadaCuanto")) {
    throw new Error(`[${etiqueta}] la frase ya conoce la repetición. No se escribió nada.`);
  }
  if (!codigo.includes("function fraseDeTarea")) {
    throw new Error(`[${etiqueta}] falta fraseDeTarea: aplicá primero cambios-agenda-por-chat.`);
  }
  return aplicar(codigo, CAMBIOS_WORKER, etiqueta);
}
