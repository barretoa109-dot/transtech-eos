import { adminSinTipos } from "@/lib/supabase/sin-tipos";
import { procesarMensajeEOS, MAX_MESSAGE_LENGTH, type ArchivoEOS } from "@/lib/eos/procesar-mensaje";
import { atenderOnboardingPorChat } from "@/lib/eos/onboarding-chat";
import { textoPorDefecto } from "@/lib/eos/adjuntos";
import { renderizarDocumento } from "@/lib/documentos/renderizar";
import { firmaWhatsappValida } from "@/lib/whatsapp/firma";
import { enviarTexto, enviarDocumento } from "@/lib/whatsapp/enviar";
import { descargarMedia } from "@/lib/whatsapp/media";
import { idDeterministico } from "@/lib/whatsapp/id-determinista";
import { atenderCanalEmpresa, buscarCanalEmpresa, type ValorWebhook } from "@/lib/whatsapp-crm/entrante";
import { extraerPhoneNumberIds, secretoParaPayload } from "@/lib/whatsapp-crm/firma-canal";
import {
  aplicarEstadoDePlantilla,
  secretosDeApp,
  tokenDeVerificacionValido,
  type AvisoDePlantilla,
} from "@/lib/whatsapp-crm/webhook-canal";

/**
 * WhatsApp como segundo canal de EOS.
 *
 * Todo lo que decide qué pasó con un mensaje —cupo, contexto, memoria,
 * verificación de acciones— vive en `lib/eos/procesar-mensaje.ts`, la misma
 * función que usa el chat web. Este archivo solo hace lo que es específico
 * de WhatsApp: verificar que el mensaje sea de Meta, encontrar a qué cuenta
 * de EOS corresponde el número, y mandar la respuesta de vuelta por acá.
 */

const HISTORIAL_LIMITE = 10;

type MensajeEntrante = {
  id?: string;
  from?: string;
  type?: string;
  text?: { body?: string };
  image?: { id?: string; mime_type?: string; caption?: string };
  document?: { id?: string; mime_type?: string; caption?: string; filename?: string };
  // Un audio no trae pie de foto: WhatsApp no lo ofrece para notas de voz.
  audio?: { id?: string; mime_type?: string };
};

type ContactoEntrante = { wa_id?: string; profile?: { name?: string } };

export async function GET(req: Request) {
  const url = new URL(req.url);
  const modo = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge") || "";

  const esperado = process.env.WHATSAPP_VERIFY_TOKEN;

  if (modo === "subscribe" && esperado && token === esperado) {
    return new Response(challenge, { status: 200 });
  }

  // El apretón de manos de una empresa que conectó su propio WhatsApp: cada canal
  // tiene su token de verificación (v185). Solo si el canal sigue conectado.
  if (modo === "subscribe" && token && (await tokenDeVerificacionValido(adminSinTipos(), token))) {
    return new Response(challenge, { status: 200 });
  }

  return new Response("Forbidden", { status: 403 });
}

export async function POST(req: Request) {
  const cuerpoCrudo = await req.text();

  /*
   * ¿Con qué secreto se valida la firma?
   *
   * Si el número al que le escriben es de una empresa con su PROPIA app de Meta, la
   * firma salió con el secreto de esa app y el global no la valida. La regla que lo
   * hace seguro —todos los números del paquete resuelven al MISMO secreto— vive en
   * `lib/whatsapp-crm/firma-canal.ts` y tiene sus casos de ataque escritos.
   */
  let secretoDeCanal: string | null;
  try {
    const ids = extraerPhoneNumberIds(cuerpoCrudo);
    const decision = secretoParaPayload(ids, ids.length ? await secretosDeApp(adminSinTipos(), ids) : new Map());

    if (!decision.ok) return new Response("Firma inválida", { status: 401 });
    secretoDeCanal = decision.secreto;
  } catch (error) {
    // No se pudo resolver el secreto: validar con el global sería aceptar lo que
    // firmó otra app. Meta reintenta.
    console.error("WhatsApp: no se pudo resolver el secreto de la firma:", error);
    return new Response("Error", { status: 500 });
  }

  if (!firmaWhatsappValida(cuerpoCrudo, req.headers.get("x-hub-signature-256"), secretoDeCanal)) {
    return new Response("Firma inválida", { status: 401 });
  }

  let payload: {
    entry?: Array<{
      id?: string;
      changes?: Array<{
        field?: string;
        value?: {
          messages?: MensajeEntrante[];
          contacts?: ContactoEntrante[];
          metadata?: { phone_number_id?: string };
          statuses?: ValorWebhook["statuses"];
        };
      }>;
    }>;
  };
  try {
    payload = JSON.parse(cuerpoCrudo);
  } catch {
    // Cuerpo inválido de un remitente ya autenticado por firma: no hay nada
    // que reintentar, pero tampoco hace falta que Meta lo vuelva a mandar.
    return new Response("OK", { status: 200 });
  }

  const admin = adminSinTipos();
  // Cada cambio se acompaña del id de la cuenta de WhatsApp Business (`entry.id`):
  // hace falta para los avisos de plantillas, que se atan a la cuenta y no al número.
  const cambios = (payload.entry ?? []).flatMap((entrada) =>
    (entrada.changes ?? []).map((cambio) => ({ ...cambio, waba_id: entrada.id })),
  );

  // Si algo del canal de una empresa falla, se contesta con error para que Meta
  // reintente: registrar el mensaje es idempotente por su id, así que repetir
  // no duplica nada, y no reintentar perdería la conversación del cliente.
  let fallaDeCanalEmpresa = false;

  for (const cambio of cambios) {
    // Meta avisa que revisó una plantilla (aprobada, rechazada, pausada). No es un
    // mensaje: solo actualiza el estado de la plantilla de esa cuenta.
    if (cambio.field === "message_template_status_update") {
      await aplicarEstadoDePlantilla(
        admin,
        String(cambio.waba_id ?? ""),
        (cambio.value ?? {}) as AvisoDePlantilla,
      ).catch((error) => console.error("WhatsApp empresa: no se pudo aplicar el aviso de plantilla:", error));
      continue;
    }

    /*
     * ¿Es el WhatsApp de una EMPRESA y no el de EOS?
     *
     * Todos los números de la plataforma le pegan a esta misma URL. Sin este
     * desvío, un cliente que le escribe a una empresa caería más abajo como
     * "número sin vincular" y se lo trataría como alguien que quiere abrir una
     * cuenta de EOS. Ver `lib/whatsapp-crm/entrante.ts`.
     */
    let canalEmpresa;
    try {
      canalEmpresa = await buscarCanalEmpresa(admin, cambio.value?.metadata?.phone_number_id);
    } catch (error) {
      // No se puede decir "no es de una empresa" si no se pudo leer: seguir
      // mandaría el mensaje del cliente al camino equivocado.
      console.error("WhatsApp: no se pudo resolver el canal de empresa:", error);
      return new Response("Error", { status: 500 });
    }

    if (canalEmpresa) {
      const resumen = await atenderCanalEmpresa(admin, canalEmpresa, cambio.value as ValorWebhook);
      if (resumen.errores > 0) fallaDeCanalEmpresa = true;
      continue;
    }

    // El nombre de perfil viaja junto a `messages`, no adentro: hace falta
    // para el alta nueva (`altaPorWhatsapp`), que todavía no tiene ningún
    // `usuarios.nombre` de dónde sacarlo.
    const nombresPorTelefono = new Map(
      (cambio.value?.contacts ?? [])
        .filter((c): c is ContactoEntrante & { wa_id: string } => Boolean(c.wa_id))
        .map((c) => [c.wa_id, c.profile?.name?.trim() || ""]),
    );

    for (const mensaje of cambio.value?.messages ?? []) {
      try {
        await procesarUnMensaje(admin, mensaje, nombresPorTelefono.get(mensaje.from || "") || "");
      } catch (error) {
        console.error("WhatsApp: error procesando un mensaje entrante:", error);
      }
    }
  }

  if (fallaDeCanalEmpresa) return new Response("Error", { status: 500 });

  // `value.statuses` (confirmaciones de entrega) del canal de EOS no se
  // procesa: no son mensajes de una persona, y no vienen en `messages`. Las del
  // canal de una empresa sí, arriba: actualizan el estado de cada mensaje.
  return new Response("OK", { status: 200 });
}

async function procesarUnMensaje(
  admin: ReturnType<typeof adminSinTipos>,
  mensaje: MensajeEntrante,
  nombrePerfil: string,
) {
  const desde = String(mensaje.from || "").trim();
  if (!desde) return;

  const { data: vinculo, error: vinculoError } = await admin
    .from("eos_whatsapp_vinculos_v162")
    .select("usuario_id, conversacion_id")
    .eq("telefono", desde)
    .not("verificado_at", "is", null)
    .maybeSingle();

  if (vinculoError) {
    console.error("WhatsApp: no se pudo consultar el vínculo del número:", vinculoError);
    return;
  }

  if (!vinculo) {
    await atenderNumeroSinVinculo(admin, desde, mensaje, nombrePerfil);
    return;
  }

  await atenderMensajeVinculado(admin, vinculo, mensaje, desde);
}

function sinAcentos(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

const RESPUESTAS_EMPEZAR = [
  "si",
  "sí",
  "dale",
  "ok",
  "okay",
  "listo",
  "va",
  "quiero empezar",
  "empecemos",
  "arranquemos",
  "soy nuevo",
  "soy nueva",
  "cuenta nueva",
  "nueva cuenta",
  "no tengo cuenta",
];

function quiereEmpezarDeCero(texto: string): boolean {
  const plano = sinAcentos(texto.trim());
  if (!plano) return false;
  return RESPUESTAS_EMPEZAR.some((r) => plano === sinAcentos(r));
}

const TEXTO_NUMERO_SIN_VINCULO = [
  "¡Hola! Soy EOS 👋 Este número todavía no está conectado a ninguna cuenta.",
  "",
  'Si ya usás EOS en la web, entrá a tu perfil, tocá "Conectar WhatsApp" y mandame el código de 6 dígitos que te va a mostrar — así seguís con la misma cuenta, no una nueva.',
  "",
  'Si es tu primera vez, contestame "quiero empezar" y arrancamos.',
].join("\n");

/**
 * Un número que todavía no tiene cuenta de EOS asociada.
 *
 * No se asume nada: sin una de estas dos señales explícitas, no se crea
 * ninguna cuenta y no se guarda nada. La primera versión de esto creaba una
 * cuenta con el primer mensaje que llegara —"Hola" incluido—, y a alguien que
 * ya tenía cuenta en la web eso le abría una segunda, vacía, sin que lo
 * hubiera pedido. Ahora hace falta una de dos:
 *
 *   1. Un texto de exactamente 6 dígitos: probablemente el código pedido
 *      desde el perfil de una cuenta que YA existe.
 *   2. Una respuesta afirmativa a la pregunta de abajo ("quiero empezar",
 *      "dale", "sí"): recién ahí se entiende que la persona no tiene cuenta y
 *      quiere una.
 *
 * Cualquier otra cosa —"Hola", una pregunta, una foto— recibe la misma
 * pregunta de siempre y no deja rastro en la base.
 */
async function atenderNumeroSinVinculo(
  admin: ReturnType<typeof adminSinTipos>,
  desde: string,
  mensaje: MensajeEntrante,
  nombrePerfil: string,
) {
  const textoRecibido = mensaje.type === "text" ? String(mensaje.text?.body || "").trim() : "";
  const codigo = textoRecibido.replace(/\D/g, "");

  if (codigo.length === 6 && codigo === textoRecibido) {
    await confirmarCodigo(admin, desde, codigo);
    return;
  }

  if (!quiereEmpezarDeCero(textoRecibido)) {
    await enviarTexto(desde, TEXTO_NUMERO_SIN_VINCULO);
    return;
  }

  const vinculo = await altaPorWhatsapp(admin, desde, nombrePerfil);

  if (!vinculo) {
    await enviarTexto(desde, "No pude crear tu cuenta en este momento. Probá nuevamente en unos minutos.");
    return;
  }

  await atenderMensajeVinculado(admin, vinculo, mensaje, desde);
}

async function confirmarCodigo(admin: ReturnType<typeof adminSinTipos>, desde: string, codigo: string) {
  const { data: pendiente, error: buscarError } = await admin
    .from("eos_whatsapp_vinculos_v162")
    .select("usuario_id, codigo_expira_at")
    .eq("codigo", codigo)
    .is("verificado_at", null)
    .maybeSingle();

  if (buscarError) {
    console.error("WhatsApp: no se pudo buscar el código de vinculación:", buscarError);
    return;
  }

  if (!pendiente || !pendiente.codigo_expira_at || new Date(pendiente.codigo_expira_at).getTime() < Date.now()) {
    await enviarTexto(desde, "Ese código no es válido o ya venció. Generá uno nuevo desde tu perfil en la app.");
    return;
  }

  // Si este número ya estaba vinculado a otra cuenta, se libera primero: un
  // teléfono es de quien lo tiene en la mano ahora, no de quien lo vinculó
  // antes. La columna es única, así que sin este paso la siguiente
  // actualización fallaría por conflicto.
  await admin
    .from("eos_whatsapp_vinculos_v162")
    .update({ telefono: null, verificado_at: null })
    .eq("telefono", desde);

  const { error: confirmarError } = await admin
    .from("eos_whatsapp_vinculos_v162")
    .update({ telefono: desde, verificado_at: new Date().toISOString(), codigo: null, codigo_expira_at: null })
    .eq("usuario_id", pendiente.usuario_id);

  if (confirmarError) {
    console.error("WhatsApp: no se pudo confirmar la vinculación:", confirmarError);
    await enviarTexto(desde, "Hubo un problema vinculando tu cuenta. Probá nuevamente en unos minutos.");
    return;
  }

  await enviarTexto(
    desde,
    "¡Listo! Tu WhatsApp quedó vinculado a tu cuenta de EOS. Ya podés escribirme por acá igual que en la app.",
  );
}

/**
 * Cuenta nueva, creada desde WhatsApp, sin pasar por la web.
 *
 * `auth.admin.createUser` con `phone` (no `email`) hace que el trigger
 * `on_auth_user_created` (`handle_new_user()`, ver
 * `supabase/migrations/20260904000000_eos_onboarding_al_nacer_v114.sql`) cree
 * solo, en la misma operación, la fila de `usuarios` (plan `free`, el nombre
 * de perfil de WhatsApp si vino) y la de `eos_onboarding` en paso
 * `bienvenida` — el mismo arranque que tiene cualquier alta por la web. No
 * hace falta repetir nada de eso acá.
 */
async function altaPorWhatsapp(
  admin: ReturnType<typeof adminSinTipos>,
  desde: string,
  nombrePerfil: string,
): Promise<{ usuario_id: string; conversacion_id: string | null } | null> {
  const { data: alta, error: crearError } = await admin.auth.admin.createUser({
    phone: desde,
    phone_confirm: true,
    user_metadata: {
      whatsapp: desde,
      ...(nombrePerfil ? { nombre: nombrePerfil.slice(0, 160) } : {}),
    },
  });

  if (crearError || !alta?.user) {
    console.error("WhatsApp: no se pudo crear la cuenta nueva:", crearError);
    return null;
  }

  const usuarioId = alta.user.id;

  const { error: vinculoError } = await admin.from("eos_whatsapp_vinculos_v162").insert([
    { usuario_id: usuarioId, telefono: desde, verificado_at: new Date().toISOString() },
  ]);

  if (vinculoError) {
    // La cuenta ya quedó creada (huérfana, sin teléfono vinculado). No se
    // reintenta el insert acá: mejor pedirle a la persona que reintente y que
    // el siguiente mensaje encuentre TODO en un estado limpio, a dejarla
    // hablando con una cuenta a la que el próximo mensaje de este número no
    // va a volver a encontrar.
    console.error("WhatsApp: cuenta creada pero no se pudo vincular el número:", vinculoError);
    return null;
  }

  return { usuario_id: usuarioId, conversacion_id: null };
}

async function atenderMensajeVinculado(
  admin: ReturnType<typeof adminSinTipos>,
  vinculo: { usuario_id: string; conversacion_id: string | null },
  mensaje: MensajeEntrante,
  desde: string,
) {
  const usuarioId = vinculo.usuario_id;

  let mensajeTexto = "";
  let archivos: ArchivoEOS[] = [];

  if (mensaje.type === "text") {
    mensajeTexto = String(mensaje.text?.body || "").trim();
  } else if (mensaje.type === "image" || mensaje.type === "document" || mensaje.type === "audio") {
    const media =
      mensaje.type === "image" ? mensaje.image : mensaje.type === "document" ? mensaje.document : mensaje.audio;

    // El audio no trae pie de foto: WhatsApp no lo ofrece para notas de voz.
    mensajeTexto = mensaje.type === "audio" ? "" : String((media as { caption?: string })?.caption || "").trim();

    if (media?.id) {
      const archivo = await descargarMedia(
        media.id,
        media.mime_type || "",
        (mensaje.type === "document" && "filename" in (media || {}) ? (media as { filename?: string }).filename : undefined) ||
          `whatsapp-${mensaje.type}`,
      );
      if (archivo) archivos = [archivo];
    }
  } else {
    await enviarTexto(
      desde,
      "Por ahora puedo leer texto, imágenes, documentos y audios. Probá mandarlo de otra forma.",
    );
    return;
  }

  if (!mensajeTexto && archivos.length === 0) return;

  /*
   * Una imagen sin texto llega con `mensajeTexto` vacío, y el gateway exige
   * un mensaje no vacío —revienta con "mensaje es obligatorio" si no lo
   * tiene—. La web nunca lo pisó porque ya arma este mismo texto por
   * defecto antes de mandar (`lib/eos/adjuntos.ts`); acá faltaba.
   */
  if (!mensajeTexto && archivos.length > 0) {
    mensajeTexto = textoPorDefecto(archivos);
  }

  if (mensajeTexto.length > MAX_MESSAGE_LENGTH) {
    mensajeTexto = mensajeTexto.slice(0, MAX_MESSAGE_LENGTH);
  }

  let conversacionId = vinculo.conversacion_id;

  if (!conversacionId) {
    const { data: nueva, error: crearError } = await admin
      .from("conversaciones")
      .insert([{ usuario_id: usuarioId, titulo: "WhatsApp" }])
      .select("id")
      .single();

    if (crearError || !nueva) {
      console.error("WhatsApp: no se pudo crear la conversación:", crearError);
      await enviarTexto(desde, "No pude abrir tu conversación en este momento. Probá nuevamente.");
      return;
    }

    conversacionId = nueva.id as string;

    await admin
      .from("eos_whatsapp_vinculos_v162")
      .update({ conversacion_id: conversacionId })
      .eq("usuario_id", usuarioId);
  }

  /*
   * Mientras la conversación fundacional no haya terminado, el mensaje no
   * pasa por el motor de chat: lo atiende `atenderOnboardingPorChat`, que
   * pregunta lo que falta y guarda cada respuesta en las mismas tablas que
   * usa la pantalla web (`eos_finanzas_cuentas`, `_fijos`, `_deudas`). No
   * consume cupo de mensajes, igual que llenar el formulario de la web
   * tampoco lo consume.
   */
  const respuestaOnboarding = await atenderOnboardingPorChat(admin, usuarioId, mensajeTexto);

  if (respuestaOnboarding !== null) {
    const { error: guardarOnboardingError } = await admin.from("mensajes").insert([
      {
        conversacion_id: conversacionId,
        usuario_id: usuarioId,
        rol: "usuario",
        texto: mensajeTexto || "[adjunto]",
        origen: "whatsapp",
      },
      {
        conversacion_id: conversacionId,
        usuario_id: usuarioId,
        rol: "eos",
        texto: respuestaOnboarding,
        origen: "whatsapp",
      },
    ]);

    if (guardarOnboardingError) {
      console.error("WhatsApp: no se pudo guardar el historial del onboarding:", guardarOnboardingError);
    }

    await enviarTexto(desde, respuestaOnboarding);
    return;
  }

  const { data: historialFilas } = await admin
    .from("mensajes")
    .select("rol, texto")
    .eq("conversacion_id", conversacionId)
    .eq("usuario_id", usuarioId)
    .order("created_at", { ascending: false })
    .limit(HISTORIAL_LIMITE);

  const historial = (historialFilas ?? []).slice().reverse();

  const resultado = await procesarMensajeEOS(usuarioId, {
    mensaje: mensajeTexto,
    archivos,
    conversacionId,
    historial,
    origen: "whatsapp",
    nuevoChat: false,
    cita: null,
    requestId: idDeterministico(mensaje.id || `${usuarioId}:${Date.now()}`),
    requestOrigin: process.env.EOS_APP_BASE_URL || "https://www.transtech.com.py",
  });

  if (resultado.status === 409) {
    // Ya se está procesando (o ya se procesó) esta misma entrega de Meta —
    // Meta reintrega el mismo webhook seguido. El intento original es el que
    // guarda el historial y contesta; este no repite ninguna de las dos
    // cosas, porque duplicaría el mensaje del usuario en su propio chat.
    return;
  }

  const respuesta = resultado.body as Record<string, unknown>;
  const respuestaTexto =
    typeof respuesta.respuesta === "string"
      ? respuesta.respuesta
      : "EOS tuvo un problema respondiendo tu mensaje. Probá nuevamente.";

  const archivoUrl = typeof respuesta.archivo_url === "string" ? respuesta.archivo_url : "";
  const archivoNombre = typeof respuesta.archivo_nombre === "string" ? respuesta.archivo_nombre : "";

  // La URL de un documento generado por EOS tiene esta forma exacta
  // (`guardarDocumento`, en lib/documentos/guardar.ts). Cualquier otro link
  // —uno que el modelo haya escrito suelto en la respuesta— no es nuestro y
  // no se puede resubir: se deja como texto, que WhatsApp muestra clickeable.
  const idDocumento = archivoUrl.match(/^\/api\/documentos\/([0-9a-f-]{36})\?formato=([a-z]+)$/i);

  const textoParaWhatsapp =
    archivoUrl && !idDocumento && archivoUrl.startsWith("http")
      ? `${respuestaTexto}\n\n${archivoUrl}`
      : respuestaTexto;

  const { error: guardarError } = await admin.from("mensajes").insert([
    {
      conversacion_id: conversacionId,
      usuario_id: usuarioId,
      rol: "usuario",
      texto: mensajeTexto || "[adjunto]",
      origen: "whatsapp",
    },
    {
      conversacion_id: conversacionId,
      usuario_id: usuarioId,
      rol: "eos",
      texto: textoParaWhatsapp,
      origen: "whatsapp",
    },
  ]);

  if (guardarError) {
    // No es motivo para no contestar: perder la fila de historial es peor
    // solo si además no se manda la respuesta.
    console.error("WhatsApp: no se pudo guardar el historial de la conversación:", guardarError);
  }

  await enviarTexto(desde, textoParaWhatsapp);

  if (idDocumento) {
    const enviado = await mandarDocumentoGenerado(
      admin,
      usuarioId,
      idDocumento[1],
      idDocumento[2],
      archivoNombre,
      desde,
    );

    if (!enviado) {
      await enviarTexto(
        desde,
        "Tu archivo quedó listo, pero no lo pude mandar por acá — lo tenés esperando en la app de EOS.",
      );
    }
  }
}

/**
 * Manda por WhatsApp un documento que EOS ya generó y guardó.
 *
 * Lee la fila directo de la base (con `usuario_id` en el filtro, como exige
 * cualquier consulta con el cliente de servicio) y la dibuja con
 * `renderizarDocumento` —el mismo camino que usa la descarga desde la
 * web—, así las reglas de validación no se duplican en un segundo lugar.
 */
async function mandarDocumentoGenerado(
  admin: ReturnType<typeof adminSinTipos>,
  usuarioId: string,
  documentoId: string,
  formatoPedido: string,
  nombreSugerido: string,
  desde: string,
): Promise<boolean> {
  const { data, error } = await admin
    .from("eos_documentos_generados")
    .select("especificacion, formato")
    .eq("id", documentoId)
    .eq("usuario_id", usuarioId)
    .maybeSingle();

  if (error || !data) {
    console.error("WhatsApp: no se encontró el documento a mandar:", error);
    return false;
  }

  const renderizado = await renderizarDocumento(data.especificacion, data.formato, formatoPedido);

  if (!renderizado.ok) {
    console.error("WhatsApp: no se pudo renderizar el documento:", renderizado.error);
    return false;
  }

  return enviarDocumento(desde, renderizado.cuerpo, nombreSugerido || renderizado.nombre, renderizado.tipo);
}
