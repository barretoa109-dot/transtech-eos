import { adminSinTipos } from "@/lib/supabase/sin-tipos";
import { procesarMensajeEOS, MAX_MESSAGE_LENGTH, type ArchivoEOS } from "@/lib/eos/procesar-mensaje";
import { firmaWhatsappValida } from "@/lib/whatsapp/firma";
import { enviarTexto } from "@/lib/whatsapp/enviar";
import { descargarMedia } from "@/lib/whatsapp/media";
import { idDeterministico } from "@/lib/whatsapp/id-determinista";

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

  return new Response("Forbidden", { status: 403 });
}

export async function POST(req: Request) {
  const cuerpoCrudo = await req.text();

  if (!firmaWhatsappValida(cuerpoCrudo, req.headers.get("x-hub-signature-256"))) {
    return new Response("Firma inválida", { status: 401 });
  }

  let payload: {
    entry?: Array<{
      changes?: Array<{
        value?: { messages?: MensajeEntrante[]; contacts?: ContactoEntrante[] };
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
  const cambios = (payload.entry ?? []).flatMap((entrada) => entrada.changes ?? []);

  for (const cambio of cambios) {
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

  // `value.statuses` (confirmaciones de entrega) no se procesa: no son
  // mensajes de una persona, y no vienen en `messages`.
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

/**
 * Un número que todavía no tiene cuenta de EOS asociada.
 *
 * Dos caminos, y se distinguen por la FORMA del texto, no por su contenido:
 * un mensaje de texto que son exactamente 6 dígitos y nada más es, con
 * certeza razonable, un código pedido desde el perfil de una cuenta que ya
 * existe. Cualquier otra cosa —"Hola", una foto, un audio— es alguien nuevo
 * que le está hablando a EOS por primera vez, y se le da de alta ahí mismo:
 * el número de WhatsApp, que Meta ya verificó del lado de la persona, es
 * identidad suficiente para arrancar.
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
  } else if (mensaje.type === "image" || mensaje.type === "document") {
    const media = mensaje.type === "image" ? mensaje.image : mensaje.document;
    mensajeTexto = String(media?.caption || "").trim();

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
    await enviarTexto(desde, "Por ahora puedo leer texto, imágenes y documentos. Probá mandarlo de otra forma.");
    return;
  }

  if (!mensajeTexto && archivos.length === 0) return;

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

  const textoParaWhatsapp = archivoUrl
    ? `${respuestaTexto}\n\nTu archivo está listo — todavía no puedo mandarlo por WhatsApp, pero lo tenés esperando en la app de EOS.`
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
}
