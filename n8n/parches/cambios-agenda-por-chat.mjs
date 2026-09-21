/**
 * Lo que la persona dice con fecha por el chat llega solo al Calendario.
 *
 * ============================================================
 * EL HUECO
 * ============================================================
 *
 * "Tengo que pagar los salarios el 25" ya podía guardarse: el chat tiene el verbo
 * CREAR_TAREA. Pero la fecha se perdía, por tres lados a la vez:
 *
 *   1. El prompt no enseñaba la forma de los datos de CREAR_TAREA. Sin ella, el
 *      modelo elige entre guardarlo como memoria (que tapa el hueco: la persona
 *      cree que quedó agendado) o mandar una tarea sin fecha.
 *   2. El nodo `06 GW Preparar Jobs Worker` arma los datos de CREAR_TAREA con una
 *      lista EXPLÍCITA de campos y descarta el resto en silencio. Aunque el
 *      modelo mandara `vence_dia`, nunca llegaba al ejecutor.
 *   3. El worker contestaba "La tarea quedó registrada.", sin decir para cuándo.
 *
 * ============================================================
 * POR QUÉ EL MODELO NO MANDA UNA FECHA
 * ============================================================
 *
 * No sabe qué día es hoy: el prompt es idéntico para todos, a propósito, para
 * poder cachearlo. Convertir "el 25" a AAAA-MM-DD sería adivinar el mes. Manda LO
 * QUE LA PERSONA DIJO y la base hace la cuenta con la fecha de Paraguay (v189),
 * igual que con los vencimientos de las ventas (v182).
 *
 * El prompt no puede tener comillas invertidas ni la secuencia dólar-llave: vive
 * dentro de un literal de plantilla de JavaScript (ver `verificar.mjs`).
 */

export const CAMBIOS_PROMPT = [
  {
    donde: "CREAR_TAREA: la forma de los datos y las fechas",
    viejo: [
      "GUARDAR_MEMORIA",
      "  datos: { titulo, categoria?, contenido, importancia? }",
    ].join("\n"),
    nuevo: [
      "CREAR_TAREA",
      "  datos: { titulo, descripcion?, prioridad?, vence_dia?, vence_en_dias?,",
      "           vence_semana?, vence_el?, hora? }",
      "  Es para TODO lo que la persona tiene que hacer, pagar, llamar o no",
      "  olvidar, y para lo que quiere agendar. Una tarea con fecha aparece sola en",
      "  su Calendario, sin que tenga que cargarla a mano: \"tengo que pagar los",
      "  salarios el 25\", \"recordame llamar al proveedor el lunes\", \"reunión con",
      "  el contador mañana a las 10\".",
      "  Lo que TODAVÍA NO pasó no es un gasto ni una venta: \"tengo que pagar\",",
      "  \"voy a comprar\", \"me tienen que pagar\" son una tarea, no un movimiento.",
      "  Si dicen CUÁNDO, mandá UNO de estos y no hagas la cuenta vos (no sabés qué",
      "  día es hoy; el sistema sí):",
      "    vence_dia      el día del mes: \"el 25\" → 25",
      "    vence_en_dias  \"hoy\" → 0, \"mañana\" → 1, \"en 15 días\" → 15",
      "    vence_semana   el día de la semana: \"el lunes\" → lunes, \"el viernes\" → viernes",
      "    vence_el       AAAA-MM-DD, SOLO si dicen la fecha completa con el año",
      "  hora: HH:MM de 24 horas, solo si la dicen (\"a las 10\" → 10:00, \"a las 3 de",
      "  la tarde\" → 15:00). Sin hora, es de todo el día.",
      "  El titulo es corto y dice qué hay que hacer (\"Pagar los salarios\"). Si dicen",
      "  un monto, un nombre o un detalle, va en la descripcion.",
      "  Si no dicen cuándo, no lo preguntes: mandá la tarea igual, sin fecha.",
      "",
      "GUARDAR_MEMORIA",
      "  datos: { titulo, categoria?, contenido, importancia? }",
    ].join("\n"),
  },
  {
    donde: "GUARDAR_MEMORIA no tapa lo que tiene fecha",
    viejo: "  REGISTRAR_MOVIMIENTO_PERSONAL; una deuda en REGISTRAR_DEUDA.\n",
    nuevo: [
      "  REGISTRAR_MOVIMIENTO_PERSONAL; una deuda en REGISTRAR_DEUDA; algo que hay",
      "  que hacer o pagar en una fecha (\"tengo que pagar los salarios el 25\") en",
      "  CREAR_TAREA.",
      "",
    ].join("\n"),
  },
];

/**
 * El nodo `06 GW Preparar Jobs Worker` del gateway: la lista explícita de campos.
 *
 * Los campos nuevos entran SOLO si la persona los dijo. Ponerlos siempre, aunque
 * vacíos, cambia la huella de TODAS las tareas —también las que no llevan fecha—
 * y la huella es lo que hace que un reintento no cree la tarea dos veces (el
 * contrato exactly-once que cuidan los evals). Una tarea sin fecha tiene que
 * seguir dando exactamente la misma huella que antes.
 */
export const CAMBIOS_JOBS = [
  {
    donde: "CREAR_TAREA: se recogen los campos de fecha que la persona dijo",
    viejo: [
      "  if (tipo === 'CREAR_TAREA') {",
      "    return {",
    ].join("\n"),
    nuevo: [
      "  if (tipo === 'CREAR_TAREA') {",
      "    /*",
      "      Lo que la persona DIJO (\"el 25\", \"mañana\", \"el lunes\", \"a las 10\"): la",
      "      base hace la cuenta con la fecha de Paraguay (v189). Esta lista descarta",
      "      en silencio todo lo que no nombra, así que sin esto el ejecutor nunca se",
      "      entera. Solo entran los que vinieron con algo: ver el porqué arriba.",
      "    */",
      "    const cuando = {};",
      "    for (const campo of ['vence_dia', 'vence_en_dias', 'vence_semana', 'vence_el', 'hora']) {",
      "      const valor = texto(d[campo]);",
      "      if (valor) cuando[campo] = valor;",
      "    }",
      "",
      "    return {",
    ].join("\n"),
  },
  {
    donde: "CREAR_TAREA: los campos de fecha se suman al final",
    viejo: [
      "        d.due_date,",
      "        d.vencimiento",
      "      )",
      "    };",
    ].join("\n"),
    nuevo: [
      "        d.due_date,",
      "        d.vencimiento",
      "      ),",
      "",
      "      ...cuando",
      "    };",
    ].join("\n"),
  },
];

export const CAMBIOS_WORKER = [
  {
    donde: "la frase de la tarea: se elige",
    viejo: "  if (accion === 'REGISTRAR_OPORTUNIDAD') return fraseDeOportunidad(result);\n  return null;",
    nuevo: [
      "  if (accion === 'REGISTRAR_OPORTUNIDAD') return fraseDeOportunidad(result);",
      "  if (accion === 'CREAR_TAREA') return fraseDeTarea(result);",
      "  return null;",
    ].join("\n"),
  },
  {
    donde: "la frase de la tarea: se define",
    viejo: "var ETAPAS = {",
    nuevo: [
      "/*",
      "  Dice el día que QUEDÓ, no el que la persona dijo: \"el 25\" lo resolvió la base",
      "  con la fecha de Paraguay y acá se lee de vuelta. Si algo salió distinto de lo",
      "  esperado, es lo primero que se ve. Sin fecha lo dice: no aparece en el",
      "  Calendario, y callarlo dejaría a la persona esperando un aviso que no va a",
      "  llegar (v189).",
      "*/",
      "function fraseDeTarea(result) {",
      "  const r = (result && result.resultado) || {};",
      "",
      "  if (!r.fecha_limite) {",
      "    return 'La tarea quedó registrada, pero sin fecha, así que no aparece en el Calendario. Si querés, ponele fecha desde ahí.';",
      "  }",
      "",
      "  let frase = 'Listo, lo anoté en tu Calendario para el ' + fechaLarga(r.fecha_limite);",
      "  if (r.hora) frase += ' a las ' + r.hora;",
      "",
      "  return frase + '. Lo ves en Calendario, y ahí lo podés cambiar o marcar como hecho.';",
      "}",
      "",
      "var ETAPAS = {",
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
  if (texto.includes("vence_semana")) {
    throw new Error(`[${etiqueta}] el prompt ya conoce vence_semana. No se escribió nada.`);
  }
  return aplicar(texto, CAMBIOS_PROMPT, etiqueta);
}

export function aplicarJobs(codigo, etiqueta = "06 GW Preparar Jobs Worker") {
  if (codigo.includes("vence_semana")) {
    throw new Error(`[${etiqueta}] el nodo ya conoce vence_semana. No se escribió nada.`);
  }
  return aplicar(codigo, CAMBIOS_JOBS, etiqueta);
}

export function aplicarWorker(codigo, etiqueta = "worker") {
  if (codigo.includes("function fraseDeTarea")) {
    throw new Error(`[${etiqueta}] ya existe fraseDeTarea. No se escribió nada.`);
  }
  if (!codigo.includes("function fechaLarga")) {
    throw new Error(`[${etiqueta}] falta fechaLarga: aplicá primero el parche de fechas legibles.`);
  }
  return aplicar(codigo, CAMBIOS_WORKER, etiqueta);
}
