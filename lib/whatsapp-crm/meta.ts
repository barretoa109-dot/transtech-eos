/**
 * El cliente de la API de WhatsApp Business de Meta (Graph API).
 *
 * ============================================================
 * QUÉ HACE Y QUÉ NO
 * ============================================================
 *
 * Es la ÚNICA puerta hacia Meta: verificar unas credenciales, mandar un mensaje
 * de texto o de plantilla, y crear/consultar plantillas. No decide nada —si se
 * puede enviar lo decide `politica.ts`— ni guarda nada.
 *
 * `fetch` entra por parámetro: las pruebas lo reemplazan y el código real nunca
 * se prueba pegándole a Meta con credenciales de verdad.
 *
 * ============================================================
 * LOS ERRORES SE TRADUCEN
 * ============================================================
 *
 * Meta devuelve "(#131047) Re-engagement message" y a la persona eso no le dice
 * nada. Cada código conocido se traduce a lo que pasó y a qué hacer, y el
 * transitorio (se puede reintentar) se distingue del definitivo (no sirve
 * reintentar: hay que arreglar algo).
 */

export const META_VERSION = "v21.0";
const BASE = `https://graph.facebook.com/${META_VERSION}`;
/** Meta contesta en un segundo casi siempre; más de diez es que algo anda mal. */
const TIMEOUT_MS = 10_000;

export type Fetcher = typeof fetch;

export type ResultadoMeta<T> =
  | { ok: true; datos: T }
  | {
      ok: false;
      codigo: number | null;
      /** En castellano, lo que pasó y qué hacer. */
      mensaje: string;
      /** ¿Tiene sentido reintentar más tarde? */
      transitorio: boolean;
    };

const MENSAJES: Record<number, { mensaje: string; transitorio: boolean }> = {
  190: {
    mensaje: "El token de acceso venció o no es válido. Generá uno nuevo en Meta y volvé a conectarlo.",
    transitorio: false,
  },
  10: { mensaje: "El token no tiene permiso para usar este número de WhatsApp.", transitorio: false },
  200: { mensaje: "El token no tiene los permisos de WhatsApp Business necesarios.", transitorio: false },
  100: { mensaje: "Meta rechazó los datos: revisá el ID del número y el mensaje.", transitorio: false },
  131009: { mensaje: "Meta rechazó un parámetro del mensaje.", transitorio: false },
  131026: {
    mensaje: "El mensaje no se pudo entregar: ese número no usa WhatsApp o no aceptó los términos.",
    transitorio: false,
  },
  131047: {
    mensaje: "Pasaron más de 24 horas desde que el cliente escribió: solo se puede retomar con una plantilla aprobada.",
    transitorio: false,
  },
  131048: {
    mensaje: "WhatsApp limitó los envíos de este número por reportes de spam. Esperá y revisá la calidad del número.",
    transitorio: true,
  },
  131049: {
    mensaje: "WhatsApp no entregó este mensaje para cuidar la experiencia del cliente. No insistas.",
    transitorio: false,
  },
  131056: { mensaje: "Se mandaron demasiados mensajes seguidos a este cliente. Probá más tarde.", transitorio: true },
  132000: { mensaje: "La plantilla necesita otros datos: revisá las variables.", transitorio: false },
  132001: { mensaje: "Esa plantilla no existe o todavía no está aprobada.", transitorio: false },
  132007: { mensaje: "WhatsApp rechazó el contenido de la plantilla por sus políticas.", transitorio: false },
  80007: { mensaje: "Se llegó al límite de pedidos a Meta. Esperá unos minutos.", transitorio: true },
  130429: { mensaje: "Se llegó al límite de mensajes por segundo. Reintentá en un momento.", transitorio: true },
  368: { mensaje: "Meta bloqueó temporalmente la cuenta por políticas. Revisá el Business Manager.", transitorio: false },
};

function traducir(codigo: number | null, textoMeta: string, status: number): { mensaje: string; transitorio: boolean } {
  if (codigo !== null && MENSAJES[codigo]) return MENSAJES[codigo];

  // Sin un código conocido: los 5xx y los límites son transitorios; lo demás, no.
  if (status >= 500 || status === 429) {
    return { mensaje: "Meta no respondió bien. Reintentá en unos minutos.", transitorio: true };
  }

  // Lo que dijo Meta, recortado: sirve para soporte y no lleva datos del cliente.
  const resto = textoMeta.replace(/\s+/g, " ").trim().slice(0, 160);
  return { mensaje: resto ? `Meta respondió: ${resto}` : "Meta rechazó el pedido.", transitorio: false };
}

async function llamar<T>(
  fetcher: Fetcher,
  token: string,
  metodo: "GET" | "POST",
  ruta: string,
  cuerpo?: unknown,
): Promise<ResultadoMeta<T>> {
  let respuesta: Response;

  try {
    respuesta = await fetcher(`${BASE}/${ruta}`, {
      method: metodo,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(cuerpo !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    const agotado = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    return {
      ok: false,
      codigo: null,
      mensaje: agotado
        ? "Meta tardó demasiado en responder. Reintentá en unos minutos."
        : "No se pudo comunicar con Meta. Reintentá en unos minutos.",
      transitorio: true,
    };
  }

  const texto = await respuesta.text().catch(() => "");
  let json: unknown = null;
  try {
    json = texto ? JSON.parse(texto) : null;
  } catch {
    json = null;
  }

  if (!respuesta.ok) {
    const error = (json as { error?: { code?: number; message?: string; error_data?: { details?: string } } } | null)?.error;
    const codigo = typeof error?.code === "number" ? error.code : null;
    const t = traducir(codigo, error?.error_data?.details || error?.message || "", respuesta.status);
    return { ok: false, codigo, ...t };
  }

  return { ok: true, datos: (json ?? {}) as T };
}

// ------------------------------------------------------------------ credenciales

export type NumeroVerificado = {
  id: string;
  /** Como lo muestra WhatsApp, ej. "+595 987 506802". */
  display_phone_number: string;
  verified_name: string;
  quality_rating: string | null;
};

/** ¿El token sirve para este número? Es lo primero que se hace al conectar. */
export function verificarCredenciales(
  token: string,
  phoneNumberId: string,
  fetcher: Fetcher = fetch,
): Promise<ResultadoMeta<NumeroVerificado>> {
  return llamar<NumeroVerificado>(
    fetcher,
    token,
    "GET",
    `${encodeURIComponent(phoneNumberId)}?fields=display_phone_number,verified_name,quality_rating`,
  );
}

// ------------------------------------------------------------------- mensajes

export type EnvioMeta = { messages?: { id?: string }[] };

/** Solo dígitos, como exige la API (`wa_id`). */
const soloDigitos = (t: string) => t.replace(/\D/g, "");

export async function enviarTexto(
  token: string,
  phoneNumberId: string,
  telefono: string,
  texto: string,
  fetcher: Fetcher = fetch,
): Promise<ResultadoMeta<{ wa_message_id: string }>> {
  const r = await llamar<EnvioMeta>(fetcher, token, "POST", `${encodeURIComponent(phoneNumberId)}/messages`, {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: soloDigitos(telefono),
    type: "text",
    // Sin vista previa de enlaces: un mensaje de seguimiento no es una publicidad.
    text: { body: texto, preview_url: false },
  });

  return convertirEnvio(r);
}

export async function enviarPlantilla(
  token: string,
  phoneNumberId: string,
  telefono: string,
  plantilla: { nombre: string; idioma: string; variables: string[] },
  fetcher: Fetcher = fetch,
): Promise<ResultadoMeta<{ wa_message_id: string }>> {
  const r = await llamar<EnvioMeta>(fetcher, token, "POST", `${encodeURIComponent(phoneNumberId)}/messages`, {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: soloDigitos(telefono),
    type: "template",
    template: {
      name: plantilla.nombre,
      language: { code: plantilla.idioma },
      ...(plantilla.variables.length
        ? {
            components: [
              { type: "body", parameters: plantilla.variables.map((v) => ({ type: "text", text: v })) },
            ],
          }
        : {}),
    },
  });

  return convertirEnvio(r);
}

function convertirEnvio(r: ResultadoMeta<EnvioMeta>): ResultadoMeta<{ wa_message_id: string }> {
  if (!r.ok) return r;

  const id = r.datos.messages?.[0]?.id;
  // Un 200 sin id no es un envío confirmado: se trata como error, no como éxito.
  if (!id) {
    return { ok: false, codigo: null, mensaje: "Meta no confirmó el envío del mensaje.", transitorio: true };
  }
  return { ok: true, datos: { wa_message_id: id } };
}

// ------------------------------------------------------------------ plantillas

export type CategoriaMeta = "UTILITY" | "MARKETING" | "AUTHENTICATION";

const CATEGORIAS: Record<string, CategoriaMeta> = {
  utilidad: "UTILITY",
  marketing: "MARKETING",
  autenticacion: "AUTHENTICATION",
};

export function crearPlantilla(
  token: string,
  wabaId: string,
  plantilla: { nombre: string; idioma: string; categoria: string; cuerpo: string; ejemplos: string[] },
  fetcher: Fetcher = fetch,
): Promise<ResultadoMeta<{ id: string; status?: string }>> {
  return llamar<{ id: string; status?: string }>(fetcher, token, "POST", `${encodeURIComponent(wabaId)}/message_templates`, {
    name: plantilla.nombre,
    language: plantilla.idioma,
    category: CATEGORIAS[plantilla.categoria] ?? "UTILITY",
    components: [
      {
        type: "BODY",
        text: plantilla.cuerpo,
        // Meta exige un ejemplo por cada variable {{n}} para aprobarla.
        ...(plantilla.ejemplos.length ? { example: { body_text: [plantilla.ejemplos] } } : {}),
      },
    ],
  });
}

export type EstadoPlantillaMeta = { id: string; name: string; status: string; rejected_reason?: string };

export async function consultarPlantilla(
  token: string,
  wabaId: string,
  nombre: string,
  fetcher: Fetcher = fetch,
): Promise<ResultadoMeta<EstadoPlantillaMeta | null>> {
  const r = await llamar<{ data?: EstadoPlantillaMeta[] }>(
    fetcher,
    token,
    "GET",
    `${encodeURIComponent(wabaId)}/message_templates?name=${encodeURIComponent(nombre)}&fields=id,name,status,rejected_reason`,
  );

  if (!r.ok) return r;
  return { ok: true, datos: r.datos.data?.find((p) => p.name === nombre) ?? null };
}

/** El estado de Meta, en el vocabulario de la tabla `eos_wa_plantillas`. */
export function estadoDePlantilla(estadoMeta: string): "en_revision" | "aprobada" | "rechazada" | "pausada" {
  switch (estadoMeta.toUpperCase()) {
    case "APPROVED":
      return "aprobada";
    case "REJECTED":
      return "rechazada";
    case "PAUSED":
    case "DISABLED":
      return "pausada";
    default:
      return "en_revision"; // PENDING, IN_APPEAL y lo desconocido: todavía no se puede usar.
  }
}
