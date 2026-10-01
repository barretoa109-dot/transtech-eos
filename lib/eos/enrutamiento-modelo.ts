/**
 * ¿Este turno necesita el modelo caro? — en MODO SOMBRA (punto 10 del plan).
 *
 * ============================================================
 * QUÉ HACE Y QUÉ NO
 * ============================================================
 *
 * Clasifica cada mensaje entrante como `simple` o `completo` con una regla
 * determinística y barata (sin otra llamada a un modelo), y el motor lo
 * REGISTRA en la línea "EOS mensaje" del log. Mientras el paso 4 esté apagado
 * (`modeloSimple`, más abajo) no cambia qué modelo responde: todo sigue yendo a
 * `gpt-5.5` (`lib/gateway/sistema.ts`).
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

import { MODELO, MODELO_PRINCIPAL } from "../gateway/sistema.ts";

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

/**
 * Paso 4: el modelo barato, de verdad. APAGADO por defecto.
 *
 * Hacen falta las dos variables: `EOS_ENRUTAR_MODELO=1` y
 * `EOS_MODELO_SIMPLE=<modelo>`. Sin cualquiera de ellas todo sigue en el modelo
 * de siempre. `EOS_ENRUTAR_MODELO` es el interruptor único del diseño: borrarla
 * en Vercel devuelve el 100 % del tráfico al modelo completo desde el próximo
 * despliegue, sin tocar código.
 *
 * Solo lo usa el gateway en TypeScript: lo que atiende n8n sigue con su modelo.
 */
export function modeloSimple(env: Record<string, string | undefined> = process.env): string | null {
  if (env.EOS_ENRUTAR_MODELO !== "1") return null;
  const modelo = String(env.EOS_MODELO_SIMPLE ?? "").trim();
  return modelo || null;
}

/** El modelo barato si este turno va a él; `null` si va al de siempre. */
export function modeloDelTurno(
  clasificacion: Clasificacion,
  env: Record<string, string | undefined> = process.env,
): string | null {
  return clasificacion.clase === "simple" ? modeloSimple(env) : null;
}

// ------------------------------------------------------------------
// GPT 6 Sol para la mayoría, GPT 5.5 para lo complejo (01/10/2026)
// ------------------------------------------------------------------

/*
 * Lo de arriba manda al modelo BARATO solo los saludos. Esto es la decisión
 * del dueño del 01/10/2026: el principal (`MODELO_PRINCIPAL`, gpt-6-sol)
 * contesta la mayoría —incluidas las acciones, que midió al 98 %— y el
 * completo (`MODELO`, gpt-5.5) los turnos donde equivocarse cuesta más o donde
 * Sol falló en la batería del 30/09:
 *
 *   adjunto             leer una foto, un comprobante, un catálogo: lo medido
 *                       (foto-catalogo, 20/20) es con gpt-5.5.
 *   reclamo             "no está", "no hiciste nada": el caso Green del 29/09
 *                       fue una cadena de reclamos mal contestados.
 *   varias_operaciones  dos montos o más en un mensaje: el caso Green también.
 *   largo               más de 280 caracteres.
 *   documento           planillas, informes, PDF.
 *   whatsapp            escribirle a un cliente: Sol preguntaba en vez de mandar.
 *   agenda              "agendá a Nati": Sol preguntaba día y hora.
 *   cartera             cobros y pagos de lo que se debe: Sol preguntaba si era
 *                       todo o una parte en vez de anotarlo.
 *   jopara              guaraní mezclado: Sol leyó "osẽ … ko'ẽme" como futuro.
 *
 * Sin otra llamada a un modelo para decidir: una regla fija, auditable en el
 * log (`motivo`), que no suma ni costo ni demora.
 */

export type Eleccion = {
  modelo: string;
  /** "principal", "unico" o el motivo por el que fue al completo. */
  motivo: string;
};

const RECLAMO =
  /\bno (esta|aparece|figura|lo anotaste|la anotaste|los anotaste|anotaste|hiciste|registraste|cargaste|guardaste|lo veo|la veo|los veo)\b|no hiciste nada|te equivocaste|te estas equivocando|esta mal|de donde sacaste|sos tont|inutil|no entendes|no sirve/;

const DOCUMENTO = /\b(excel|pdf|word|planilla|informe|reporte|documento)\b/;
const WHATSAPP = /\b(mandale|mandales|escribile|escribiles|avisale|avisales|whatsapp|wpp|wsp)\b|manda(le)? un mensaje/;
const AGENDA = /\bagend/;
const CARTERA = /\b(le pague|les pague|pague a|me pago|me pagaron|cobre|cobramos|abono|abonaron|me debe|le debo)\b/;
const JOPARA = /[ẽỹĩũãõ]/;

/** Montos de plata: un número de 3 cifras o más, o seguido de mil, millón o lucas. */
const MONTO = /\d{1,3}(?:[.,]\d{3})+|\d{3,}|\d+(?:[.,]\d+)?\s*(?:mil\b|millon|millones|lucas|palo)/gi;

const TELEFONO = /\+?595[\s-]?\d{2,3}[\s-]?\d{3}[\s-]?\d{3,4}|\b0\d{3}[\s-]?\d{3}[\s-]?\d{3}\b/g;

const MAX_CARACTERES = 280;

/** Por qué este turno va al modelo completo, o `null` si lo contesta el principal. */
export function motivoComplejo(turno: TurnoParaClasificar): string | null {
  if (turno.adjuntos > 0) return "adjunto";

  const crudo = String(turno.mensaje ?? "");
  if (crudo.length > MAX_CARACTERES) return "largo";
  // Un teléfono ("0985 444 000", "+595 981 123456") no son tres montos.
  const sinTelefonos = crudo.replace(TELEFONO, " ");
  if ((sinTelefonos.match(MONTO) ?? []).length >= 2) return "varias_operaciones";
  if (JOPARA.test(crudo)) return "jopara";

  const texto = normalizar(crudo);
  if (RECLAMO.test(texto)) return "reclamo";
  if (DOCUMENTO.test(texto)) return "documento";
  if (WHATSAPP.test(texto)) return "whatsapp";
  if (AGENDA.test(texto)) return "agenda";
  if (CARTERA.test(texto)) return "cartera";

  return null;
}

/**
 * Qué modelo contesta este turno.
 *
 * `EOS_MODELO_PRINCIPAL` reemplaza al principal; igual a `MODELO` (gpt-5.5),
 * todo vuelve al modelo completo: es el interruptor para deshacer esto desde
 * Vercel sin tocar código.
 */
export function elegirModelo(
  turno: TurnoParaClasificar,
  env: Record<string, string | undefined> = process.env,
): Eleccion {
  const principal = String(env.EOS_MODELO_PRINCIPAL ?? "").trim() || MODELO_PRINCIPAL;
  if (principal === MODELO) return { modelo: MODELO, motivo: "unico" };

  const motivo = motivoComplejo(turno);
  return motivo ? { modelo: MODELO, motivo } : { modelo: principal, motivo: "principal" };
}
