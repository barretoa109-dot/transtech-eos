/**
 * ¿Este turno necesita el modelo caro? — en MODO SOMBRA (punto 10 del plan).
 *
 * ============================================================
 * QUÉ HACE Y QUÉ NO
 * ============================================================
 *
 * Clasifica cada mensaje entrante como `simple` o `completo` con una regla
 * determinística y barata (sin otra llamada a un modelo), y el motor lo
 * REGISTRA en la línea "EOS mensaje" del log. No cambia qué modelo responde:
 * todo sigue yendo a `gpt-5.5` (`lib/gateway/sistema.ts`).
 *
 * Es el paso 3 de docs/estrategia/enrutamiento-modelo-diseno.md: medir en
 * producción qué HABRÍA pasado, antes de comprometer calidad. Con una semana de
 * logs se sabe (a) qué parte del tráfico es simple, (b) cuánto costo se
 * ahorraría de verdad —ya con el descuento de caché del punto 8— y (c) cuántas
 * veces un turno "simple" terminó igual pidiendo una acción de negocio, que es
 * la tasa de error de la regla (`simple_con_accion` en el log).
 *
 * ============================================================
 * LA REGLA ES CONSERVADORA A PROPÓSITO
 * ============================================================
 *
 * `completo` es el valor por defecto. `simple` es solo lo que no puede terminar
 * en una acción ni en una cuenta de plata: saludos, agradecimientos, despedidas
 * y acuses cortos ("ok", "genial") SIN una pregunta de EOS pendiente.
 *
 * Una confirmación ("sí", "dale") después de que EOS preguntó algo NO es
 * simple, aunque parezca la más simple de todas: en este sistema ese "sí" es el
 * que dispara la venta que EOS acaba de proponer. El diseño la listaba como
 * candidata; leyendo el flujo real, es justo la que no puede ir al modelo barato.
 *
 * Tampoco es simple nada con números (importes, cantidades, fechas), con un
 * adjunto, con una cita, o con vocabulario de negocio o de plata.
 */

export type ClaseTurno = "simple" | "completo";

export type Clasificacion = {
  clase: ClaseTurno;
  /** Por qué, en una palabra o dos: va al log para poder auditar la regla. */
  motivo: string;
};

export type TurnoParaClasificar = {
  mensaje: string;
  /** Cantidad de archivos adjuntos (imágenes, audio, documentos). */
  adjuntos: number;
  /** Si la persona está preguntando sobre un pedazo de una respuesta anterior. */
  conCita: boolean;
  /** El historial ya normalizado; se mira solo el último turno de EOS. */
  historial: ReadonlyArray<{ rol: "usuario" | "eos"; texto: string }>;
};

/** Hasta cuántas palabras puede tener un acuse para contarse como simple. */
const MAX_PALABRAS_SIMPLE = 6;

/*
 * Frases de cortesía completas. Se compara el mensaje ENTERO normalizado
 * contra estas formas, no se buscan adentro: "gracias, vendí 3 panes" no es un
 * agradecimiento.
 */
const CORTESIA = new Set([
  "hola",
  "holi",
  "buenas",
  "buen dia",
  "buenos dias",
  "buenas tardes",
  "buenas noches",
  "hola eos",
  "hola buenas",
  "hola buen dia",
  "hola buenos dias",
  "hola buenas tardes",
  "hola buenas noches",
  "que tal",
  "hola que tal",
  "como estas",
  "hola como estas",
  "gracias",
  "muchas gracias",
  "mil gracias",
  "gracias eos",
  "ok gracias",
  "listo gracias",
  "perfecto gracias",
  "genial gracias",
  "buenisimo gracias",
  "chau",
  "chau gracias",
  "hasta luego",
  "hasta manana",
  "nos vemos",
  "ok",
  "oka",
  "okey",
  "okay",
  "genial",
  "buenisimo",
  "excelente",
  "joya",
  "barbaro",
  "entendido",
  "entiendo",
  "de acuerdo",
]);

/*
 * Afirmaciones que, SIN una pregunta pendiente, son un acuse; CON una pregunta
 * pendiente, son una confirmación que puede ejecutar algo.
 */
const AFIRMACION = new Set([
  "si",
  "sii",
  "dale",
  "listo",
  "perfecto",
  "bueno",
  "claro",
  "de una",
  "si dale",
  "dale gracias",
  "ok dale",
  "si por favor",
  "hacelo",
  "confirmo",
  "confirmar",
  "confirma",
]);

/*
 * Raíces de vocabulario de negocio o de plata. Si aparece cualquiera, el turno
 * es completo aunque sea corto: "¿y el stock?" tiene tres palabras y necesita
 * razonar sobre el inventario.
 */
const NEGOCIO =
  /\b(vend|venta|compr|gast|pag|cobr|deb|deud|prest|cuota|registr|anot|carg|anul|corrig|correg|stock|inventar|product|precio|factur|comprobante|client|proveedor|contact|transfer|saldo|disponib|alcanz|plata|dinero|guarani|gs|usd|dolar|caja|banco|tarjeta|cuenta|sueldo|ingres|egres|objetiv|meta|ahorr|presupuest|tarea|record|acord|agend|calendario|excel|pdf|word|planilla|informe|reporte|resumen|dashboard|panel|briefing|whatsapp|mand|envi|decisi|oportunidad|ganancia|margen|vengo|mes|semana|hoy|ayer|manana)/;

function normalizar(texto: string): string {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[¡!¿?.,;:()"'…\-_*~]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** ¿El último turno de EOS dejó una pregunta abierta? */
function eosPreguntoAlgo(historial: TurnoParaClasificar["historial"]): boolean {
  for (let i = historial.length - 1; i >= 0; i -= 1) {
    if (historial[i].rol !== "eos") continue;
    return historial[i].texto.includes("?");
  }
  return false;
}

export function clasificarTurno(turno: TurnoParaClasificar): Clasificacion {
  if (turno.adjuntos > 0) return { clase: "completo", motivo: "adjunto" };
  if (turno.conCita) return { clase: "completo", motivo: "cita" };

  const crudo = String(turno.mensaje ?? "");
  if (/\d/.test(crudo)) return { clase: "completo", motivo: "numeros" };

  const texto = normalizar(crudo);
  if (!texto) return { clase: "completo", motivo: "vacio" };

  const palabras = texto.split(" ");
  if (palabras.length > MAX_PALABRAS_SIMPLE) return { clase: "completo", motivo: "largo" };

  if (AFIRMACION.has(texto)) {
    return eosPreguntoAlgo(turno.historial)
      ? { clase: "completo", motivo: "confirma_pendiente" }
      : { clase: "simple", motivo: "acuse" };
  }

  if (NEGOCIO.test(texto)) return { clase: "completo", motivo: "negocio" };

  if (CORTESIA.has(texto)) return { clase: "simple", motivo: "cortesia" };

  return { clase: "completo", motivo: "por_defecto" };
}

/**
 * Lo que va al log. `simple_con_accion` es la señal de error de la regla: la
 * clasificó simple y el modelo igual pidió una acción. Si eso aparece, la clase
 * de mensaje que lo causó sale de la regla antes de enrutar nada.
 */
export function registroDeEnrutamiento(
  clasificacion: Clasificacion,
  accionesPedidas: number,
): { clase: ClaseTurno; motivo: string; simple_con_accion: boolean } {
  return {
    clase: clasificacion.clase,
    motivo: clasificacion.motivo,
    simple_con_accion: clasificacion.clase === "simple" && accionesPedidas > 0,
  };
}

/**
 * ¿Este turno probablemente termina en una acción o en una cuenta de plata?
 *
 * Distinto de `clasificarTurno`: aquella decide el MODELO (y es conservadora
 * hacia "completo" por el largo); esta decide el CAMINO, y mira el contenido
 * sin importar el largo. Un mensaje largo sobre la plata de la persona es de
 * negocio aunque tenga cuarenta palabras.
 *
 * La usa el motor para no pasar por la etapa 1 del gateway en TypeScript
 * cuando el turno igual va a terminar en n8n: con `EOS_GATEWAY_TS=1`, esos
 * mensajes llamaban a OpenAI dos veces (Vercel y después n8n), y el 24/09/2026
 * la espera sumada superó lo que el celular deja abierta la conexión. Con la
 * etapa 2 prendida no terminan en n8n y sí entran (`atiendeTypeScript`).
 */
export function pareceAccion(turno: TurnoParaClasificar): boolean {
  if (turno.adjuntos > 0 || turno.conCita) return true;

  const crudo = String(turno.mensaje ?? "");
  if (/\d/.test(crudo)) return true;

  const texto = normalizar(crudo);
  if (!texto) return false;
  if (NEGOCIO.test(texto)) return true;

  return AFIRMACION.has(texto) && eosPreguntoAlgo(turno.historial);
}
