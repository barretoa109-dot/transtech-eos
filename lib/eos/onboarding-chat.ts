import { hoyEnParaguay } from "../fecha.ts";
import { leerMonto } from "../finanzas/gastoRapido.ts";
import { validarDeuda } from "../finanzas/deudas.ts";
import type { ClienteSinTipos } from "../supabase/sin-tipos.ts";

/**
 * La conversación fundacional, pero por chat.
 *
 * ============================================================
 * POR QUÉ ESTO NO ES LA MISMA COSA QUE `OnboardingConversacion.tsx`
 * ============================================================
 *
 * La pantalla web es un asistente de varios pasos con desplegables y
 * casilleros — no un chat con IA. Esto reimplementa la misma secuencia
 * (`eos_onboarding.paso`, la misma tabla) para un canal de puro texto: cada
 * respuesta se interpreta con reglas fijas (montos "3 millones"/"50 mil" via
 * `leerMonto`, el mismo lector que usa el gasto rápido en efectivo), nunca con
 * el modelo del chat. A propósito: tocar el prompt compartido del gateway de
 * n8n es la operación de mayor riesgo de todo el proyecto — una sola comilla
 * de más ahí tumbó el chat de producción una vez — y esta conversación no
 * necesita nada de lo que ese prompt sabe hacer (acciones, memoria, verificación).
 *
 * Escribe en las MISMAS tablas que las rutas de `/api/finanzas/*`
 * (`eos_finanzas_cuentas`, `eos_finanzas_fijos`, `eos_finanzas_deudas`), así
 * que lo que alguien cuenta por WhatsApp aparece en el panel web como si lo
 * hubiera cargado ahí. `validarDeuda` se reusa tal cual: es la misma regla de
 * qué es una deuda válida, no una copia.
 *
 * ============================================================
 * QUÉ CANALES LA USAN
 * ============================================================
 *
 * Por ahora, solo WhatsApp (`app/api/whatsapp/webhook/route.ts`). La web no la
 * necesita: ya tiene su propia pantalla, y nada la fuerza a completarla antes
 * de entrar al chat. Si algún día hiciera falta un onboarding conversacional
 * también en la web, esto ya está separado de todo lo específico de WhatsApp
 * y se puede llamar igual desde ahí.
 */

type Paso =
  | "bienvenida"
  | "cuentas"
  | "ingresos"
  | "gastos_fijos"
  | "deudas"
  | "preocupaciones"
  | "correo"
  | "cierre"
  | "completado";

const PALABRAS_SALTEAR = [
  "no",
  "no tengo",
  "ninguna",
  "ninguno",
  "nada",
  "paso",
  "salteo",
  "sigamos",
  "siguiente",
  "no se",
  "no sé",
  "por ahora no",
];

function sinAcentos(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

export function quiereSaltear(texto: string): boolean {
  const plano = sinAcentos(texto.trim());
  if (plano.length === 0) return true;
  return PALABRAS_SALTEAR.some((p) => plano === sinAcentos(p));
}

/**
 * Una lista escrita como se le habla a una persona, no como un CSV.
 *
 * "Banco Itaú, Tigo Money y efectivo" o tres líneas separadas: las dos formas
 * tienen que dar tres cuentas, no una.
 */
export function partirFragmentos(texto: string): string[] {
  return texto
    .split(/\r?\n/)
    .flatMap((linea) => linea.split(/,| y (?=[A-ZÁÉÍÓÚa-záéíóúÑñ])/))
    .map((f) => f.trim())
    .filter((f) => f.length >= 2)
    .slice(0, 15);
}

const TIPOS_CUENTA: { patron: RegExp; tipo: string }[] = [
  { patron: /cooperativ/i, tipo: "cooperativa" },
  { patron: /financier/i, tipo: "financiera" },
  { patron: /billeter|tigo\s*money|zimple|wally|mango|personal\s*pay/i, tipo: "billetera" },
  { patron: /efectivo|caj[oó]n|caja\s*chica/i, tipo: "efectivo" },
  { patron: /tarjeta/i, tipo: "tarjeta_credito" },
  {
    patron: /banco|itau|itaú|gnb|continental|ueno|familiar|bancard|regional|amambay|basa|sudameris|bnf/i,
    tipo: "banco",
  },
];

export function tipoDeCuenta(fragmento: string): string {
  for (const { patron, tipo } of TIPOS_CUENTA) {
    if (patron.test(fragmento)) return tipo;
  }
  return "otro";
}

const TIPOS_DEUDA: { patron: RegExp; tipo: string }[] = [
  { patron: /tarjeta/i, tipo: "tarjeta" },
  { patron: /pr[eé]stamo|cr[eé]dito/i, tipo: "prestamo" },
  { patron: /proveedor/i, tipo: "proveedor" },
  { patron: /familiar|amigo|herman|pap[aá]|mam[aá]/i, tipo: "familiar" },
  { patron: /impuesto|iva|set\b/i, tipo: "impuesto" },
];

export function tipoDeDeuda(fragmento: string): string {
  for (const { patron, tipo } of TIPOS_DEUDA) {
    if (patron.test(fragmento)) return tipo;
  }
  return "otro";
}

/** El texto de un fragmento, sin el tramo del monto que ya se leyó aparte. */
function sinTramo(texto: string, tramo: string): string {
  return texto
    .replace(new RegExp(tramo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** El día del mes mencionado, o el 1 si no se dijo ninguno. */
export function extraerDia(texto: string): number {
  const m = texto.match(/\b([1-9]|[12]\d|3[01])\b/);
  const dia = m ? Number(m[1]) : 1;
  return dia >= 1 && dia <= 31 ? dia : 1;
}

async function guardarCuentas(admin: ClienteSinTipos, usuarioId: string, texto: string) {
  const filas = partirFragmentos(texto).map((fragmento) => ({
    usuario_id: usuarioId,
    ambito: "personal",
    nombre: fragmento.slice(0, 80),
    tipo: tipoDeCuenta(fragmento),
    moneda: "PYG",
    recibe_avisos: false,
    activa: true,
  }));

  if (filas.length === 0) return;

  const { error } = await admin.from("eos_finanzas_cuentas").insert(filas);
  if (error) console.error("Onboarding por chat: no se pudieron guardar las cuentas:", error);
}

async function guardarFijos(
  admin: ClienteSinTipos,
  usuarioId: string,
  texto: string,
  tipo: "ingreso" | "gasto",
) {
  const filas: Record<string, unknown>[] = [];

  for (const fragmento of partirFragmentos(texto)) {
    const importe = leerMonto(fragmento);
    if (!importe) continue;

    const resto = sinTramo(fragmento, importe.tramo);
    const descripcion = resto.replace(/\b([1-9]|[12]\d|3[01])\b/, "").replace(/\s+/g, " ").trim();

    filas.push({
      usuario_id: usuarioId,
      ambito: "personal",
      tipo,
      descripcion: (descripcion || (tipo === "ingreso" ? "Ingreso" : "Gasto fijo")).slice(0, 120),
      monto: importe.monto,
      dia_del_mes: extraerDia(resto),
    });
  }

  if (filas.length === 0) return;

  const { error } = await admin.from("eos_finanzas_fijos").insert(filas);
  if (error) console.error("Onboarding por chat: no se pudieron guardar los fijos:", error);
}

async function guardarDeudas(admin: ClienteSinTipos, usuarioId: string, texto: string, hoy: string) {
  const filas: Record<string, unknown>[] = [];

  for (const fragmento of partirFragmentos(texto)) {
    const importe = leerMonto(fragmento);
    const acreedor = importe ? sinTramo(fragmento, importe.tramo) : fragmento;

    const validada = validarDeuda(
      {
        acreedor,
        tipo: tipoDeDeuda(fragmento),
        saldo_declarado: importe?.monto ?? 0,
        moneda: importe?.moneda ?? "PYG",
      },
      hoy,
    );

    if ("valor" in validada) {
      filas.push({ ...validada.valor, usuario_id: usuarioId, ambito: "personal" });
    }
  }

  if (filas.length === 0) return;

  const { error } = await admin.from("eos_finanzas_deudas").insert(filas);
  if (error) console.error("Onboarding por chat: no se pudieron guardar las deudas:", error);
}

async function avanzar(admin: ClienteSinTipos, usuarioId: string, siguiente: Paso) {
  const { error } = await admin
    .from("eos_onboarding")
    .update({ paso: siguiente, updated_at: new Date().toISOString() })
    .eq("usuario_id", usuarioId);

  if (error) console.error("Onboarding por chat: no se pudo avanzar de paso:", error);
}

const TEXTOS: Record<string, string> = {
  bienvenida: [
    "¡Hola! Soy EOS. Antes de arrancar te voy a hacer algunas preguntas sobre tu plata — dónde la tenés, qué entra, qué sale y a quién le debés.",
    "Es una sola vez: cuando terminemos no vas a tener que contarme esto de nuevo. Si algo no aplica, escribime \"no\" y seguimos.",
    "",
    "¿Dónde tenés tu plata? Bancos, cooperativas, billeteras, el efectivo del cajón — todavía no necesito montos, solo saber qué existe.",
  ].join("\n"),

  ingresos:
    'Listo. Ahora contame: ¿de dónde entra tu plata, y cuánto más o menos por mes? (ej. "sueldo 4 millones el 5")',

  gastos_fijos:
    "¿Y qué se te va todos los meses, sí o sí? Alquiler, colegio, servicios — lo que sabés que sale aunque no lo mires.",

  deudas:
    'Ahora, ¿a quién le debés hoy? No es para juzgarte — es para poder avisarte antes de que una cuota te agarre corto. Si no debés nada, escribime "no".',

  preocupaciones: "Y esto es lo último: ¿qué es lo que más te preocupa de tu plata? Escribilo como se te ocurra.",

  cierre: [
    "Listo. Ya no tenés que contarme nada más — desde acá me encargo yo: miro lo que entra y lo que sale, y te aviso si algo necesita tu atención.",
    "Si algo cambia —una cuenta nueva, una deuda que saldaste— me lo decís cuando quieras. Y si querés ver todo esto ordenado, entrá a la app cuando puedas.",
    "",
    "Contame, ¿en qué te ayudo?",
  ].join("\n"),
};

/**
 * Procesa un mensaje si la cuenta todavía no terminó la conversación
 * fundacional. Devuelve el texto a responder, o `null` si ya terminó —en
 * cuyo caso quien llama sigue con el motor de chat de siempre.
 */
export async function atenderOnboardingPorChat(
  admin: ClienteSinTipos,
  usuarioId: string,
  mensajeTexto: string,
): Promise<string | null> {
  const { data: estado, error } = await admin
    .from("eos_onboarding")
    .select("paso")
    .eq("usuario_id", usuarioId)
    .maybeSingle();

  if (error) {
    console.error("Onboarding por chat: no se pudo leer el estado:", error);
    return null;
  }

  const paso = (estado?.paso as Paso | undefined) ?? "completado";
  if (paso === "completado") return null;

  const hoy = hoyEnParaguay();

  switch (paso) {
    case "bienvenida":
      await avanzar(admin, usuarioId, "cuentas");
      return TEXTOS.bienvenida;

    case "cuentas":
      if (!quiereSaltear(mensajeTexto)) await guardarCuentas(admin, usuarioId, mensajeTexto);
      await avanzar(admin, usuarioId, "ingresos");
      return TEXTOS.ingresos;

    case "ingresos":
      if (!quiereSaltear(mensajeTexto)) await guardarFijos(admin, usuarioId, mensajeTexto, "ingreso");
      await avanzar(admin, usuarioId, "gastos_fijos");
      return TEXTOS.gastos_fijos;

    case "gastos_fijos":
      if (!quiereSaltear(mensajeTexto)) await guardarFijos(admin, usuarioId, mensajeTexto, "gasto");
      await avanzar(admin, usuarioId, "deudas");
      return TEXTOS.deudas;

    case "deudas":
      if (!quiereSaltear(mensajeTexto)) await guardarDeudas(admin, usuarioId, mensajeTexto, hoy);
      await avanzar(admin, usuarioId, "preocupaciones");
      return TEXTOS.preocupaciones;

    // "correo" (el buzón de reenvío de avisos del banco) depende del módulo
    // pago de lectura automática: no tiene sentido pedirlo en el alta
    // gratuita por WhatsApp, así que este paso se saltea siempre y se
    // menciona en el cierre como algo para activar después, desde la app.
    case "preocupaciones":
    case "correo":
    case "cierre": {
      const preocupacion = quiereSaltear(mensajeTexto) ? null : mensajeTexto.trim().slice(0, 500);

      const { error: cierreError } = await admin
        .from("eos_onboarding")
        .update({
          paso: "completado",
          preocupacion_principal: preocupacion,
          completado_en: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("usuario_id", usuarioId);

      if (cierreError) console.error("Onboarding por chat: no se pudo cerrar:", cierreError);

      return TEXTOS.cierre;
    }

    default:
      return null;
  }
}
