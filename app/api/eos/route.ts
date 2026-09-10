import { after } from "next/server";

import { createAdminClient } from "@/lib/supabase-admin";
import { createClient } from "@/lib/supabase/server";
import type { Documento } from "@/lib/documentos/especificacion";
import {
  extraerDocumento,
  formatoPedido,
  guardarDocumento,
  FORMATOS as FORMATOS_DOCUMENTO,
} from "@/lib/documentos/guardar";
import { textoContexto, type ContextoNegocio } from "@/lib/eos/contexto-negocio";
import { textoMemoria } from "@/lib/eos/memoria-contexto";
import { MAX_ADJUNTOS, MAX_BASE64_TOTAL } from "@/lib/eos/adjuntos";
import {
  avisoDeVerificacion,
  corregirAfirmacionFallida,
  corregirAfirmacionSinAccion,
} from "@/lib/eos/acciones-chat";
import { leerEvidencia, verificarAcciones } from "@/lib/eos/verificacion";
import { limpiarSeleccion } from "@/lib/eos/cita";
import { POST as ingestDocument } from "@/app/api/documents/ingest/route";
import { POST as analyzeDocument } from "@/app/api/documents/[id]/analyze/route";
import { adminSinTipos } from "@/lib/supabase/sin-tipos";
import { conversar, gatewayEnTypeScript } from "@/lib/gateway/conversar";
import { resumenDeRespuesta } from "@/lib/seguridad/registro";

const SYNC_EXTRACTABLE_TYPES = new Set([
  "text/plain",
  "text/csv",
  "application/json",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  // PDF con capa de texto: extraído con unpdf en /api/documents/ingest.
  // Los escaneados quedan marcados como pendientes de OCR y no rompen nada.
  "application/pdf",
]);

const N8N_EOS_URL =
  process.env.N8N_EOS_WEBHOOK_URL ||
  "https://n8n-production-6cdb.up.railway.app/webhook/eos-chat";

const MAX_MESSAGE_LENGTH = 12_000;
const MAX_HISTORY_ITEMS = 10;
const MAX_FILE_SIZE_BYTES = 15 * 1024 * 1024;
const MAX_FILE_BASE64_LENGTH = 21 * 1024 * 1024;
const N8N_TIMEOUT_MS = 90_000;

const ALLOWED_FILE_TYPES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/csv",
  "text/plain",
]);

type HistorialItem = {
  rol?: unknown;
  texto?: unknown;
};

type UsuarioEOS = {
  nombre: string | null;
  plan: string | null;
  estado_suscripcion: string | null;
  plan_vencimiento: string | null;
};

type ArchivoEOS = {
  nombre: string;
  tipo: string;
  tamanio?: number;
  base64: string;
  extension?: string;
};

type RespuestaN8N = {
  respuesta: string;
  archivo_url: string;
  archivo_tipo: string;
  archivo_nombre: string;
  tipo: string;
  accion: string;
  metadata: Record<string, unknown>;
  acciones: Array<{ tipo?: unknown; datos?: unknown }>;
  /*
   * Lo que el Worker informó de este mensaje.
   *
   * n8n lo manda desde siempre (nodo `08 GW Agregar Resultados Worker`) y
   * hasta el 9 de septiembre de 2026 se descartaba acá. Sin esto la ruta no
   * tiene forma de saber si la venta entró, y terminaba deduciéndolo de si
   * había una aprobación pendiente — que dejó de existir cuando estas
   * acciones pasaron a ejecutarse solas. Ver `lib/eos/verificacion.ts`.
   */
  worker: unknown;
  /* Lo que consumió el mensaje en OpenAI. Cero si el gateway no lo mandó. */
  tokens_entrada: number;
  tokens_salida: number;
};

function buscarTexto(valor: unknown): string {
  if (!valor) return "";

  if (typeof valor === "string") return valor;

  if (Array.isArray(valor)) {
    for (const item of valor) {
      const encontrado = buscarTexto(item);
      if (encontrado) return encontrado;
    }
    return "";
  }

  if (typeof valor === "object") {
    const objeto = valor as Record<string, unknown>;

    const camposPrioritarios = [
      "respuesta",
      "text",
      "message",
      "output",
      "content",
      "data",
      "body",
      "json",
    ];

    for (const campo of camposPrioritarios) {
      const encontrado = buscarTexto(objeto[campo]);
      if (encontrado) return encontrado;
    }

    for (const valorInterno of Object.values(objeto)) {
      const encontrado = buscarTexto(valorInterno);
      if (encontrado) return encontrado;
    }
  }

  return "";
}

function limpiarRespuesta(texto: string): string {
  return texto
    .replace(/^```json/i, "")
    .replace(/^```/, "")
    .replace(/```$/, "")
    .replace(/\\n/g, "\n")
    .replace(/\\"/g, '"')
    .trim();
}

function esUuid(valor: unknown): valor is string {
  return (
    typeof valor === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      valor,
    )
  );
}

function textoSeguro(valor: unknown, max = 500) {
  return typeof valor === "string"
    ? valor.replace(/\s+/g, " ").trim().slice(0, max)
    : "";
}

function noStoreHeaders() {
  return {
    "Cache-Control": "private, no-store, max-age=0",
    Vary: "Cookie",
  };
}

function normalizarHistorial(valor: unknown) {
  if (!Array.isArray(valor)) {
    return [];
  }

  return valor
    .slice(-MAX_HISTORY_ITEMS)
    .map((item): { rol: "usuario" | "eos"; texto: string } | null => {
      if (!item || typeof item !== "object") {
        return null;
      }

      const registro = item as HistorialItem;

      const rol =
        registro.rol === "usuario" || registro.rol === "eos"
          ? registro.rol
          : null;

      const texto =
        typeof registro.texto === "string"
          ? registro.texto.trim().slice(0, MAX_MESSAGE_LENGTH)
          : "";

      if (!rol || !texto) {
        return null;
      }

      return { rol, texto };
    })
    .filter(
      (item): item is { rol: "usuario" | "eos"; texto: string } =>
        item !== null,
    );
}

function planEfectivo(usuario: UsuarioEOS | null): string {
  if (!usuario) return "free";

  const plan = usuario.plan?.trim().toLowerCase() || "free";

  const estado = usuario.estado_suscripcion?.trim().toLowerCase() || "active";

  if (estado !== "active" && estado !== "activo" && plan !== "free") {
    return "free";
  }

  if (
    usuario.plan_vencimiento &&
    new Date(usuario.plan_vencimiento).getTime() <= Date.now()
  ) {
    return "free";
  }

  return plan;
}

function tipoArchivoPermitido(tipo: string): boolean {
  return tipo.startsWith("image/") || ALLOWED_FILE_TYPES.has(tipo);
}

function obtenerExtension(nombre: string): string {
  const partes = nombre.split(".");
  return partes.length > 1 ? partes.pop()!.toLowerCase() : "";
}

function normalizarArchivo(valor: unknown): ArchivoEOS | null {
  if (!valor || typeof valor !== "object") {
    return null;
  }

  const registro = valor as Record<string, unknown>;

  const nombre =
    typeof registro.nombre === "string"
      ? registro.nombre.trim().slice(0, 255)
      : "";

  const tipo =
    typeof registro.tipo === "string"
      ? registro.tipo.trim().toLowerCase()
      : "";

  const base64 =
    typeof registro.base64 === "string" ? registro.base64.trim() : "";

  const tamanio =
    typeof registro.tamanio === "number" && Number.isFinite(registro.tamanio)
      ? Math.max(0, Math.trunc(registro.tamanio))
      : undefined;

  if (!nombre || !tipo || !base64) {
    throw new Error("El archivo adjunto está incompleto.");
  }

  if (!tipoArchivoPermitido(tipo)) {
    throw new Error("El formato del archivo no está permitido.");
  }

  if (tamanio !== undefined && tamanio > MAX_FILE_SIZE_BYTES) {
    throw new Error(
      "El archivo supera el tamaño máximo permitido de 15 MB.",
    );
  }

  if (base64.length > MAX_FILE_BASE64_LENGTH) {
    throw new Error("El archivo supera el tamaño máximo permitido.");
  }

  return {
    nombre,
    tipo,
    tamanio,
    base64,
    extension:
      typeof registro.extension === "string"
        ? registro.extension.trim().toLowerCase().slice(0, 15)
        : obtenerExtension(nombre),
  };
}

/**
 * Los adjuntos del mensaje, ya validados.
 *
 * Acepta el campo nuevo (`archivos`, una lista) y el viejo (`archivo`, uno
 * solo). Los dos porque durante el despliegue conviven clientes de las dos
 * versiones: alguien con la pestaña abierta desde antes sigue mandando el
 * campo viejo, y su foto tiene que llegar igual.
 *
 * Cuando llegan los dos —que es lo que manda el cliente nuevo, a propósito,
 * para que n8n siga viendo el suyo— gana la lista y el suelto se ignora: es el
 * primero de la lista, así que sumarlo lo duplicaría.
 */
function normalizarArchivos(cuerpo: Record<string, unknown>): ArchivoEOS[] {
  const crudos = Array.isArray(cuerpo.archivos)
    ? cuerpo.archivos
    : cuerpo.archivo
      ? [cuerpo.archivo]
      : [];

  if (crudos.length > MAX_ADJUNTOS) {
    throw new Error(`Podés mandar hasta ${MAX_ADJUNTOS} archivos por mensaje.`);
  }

  const archivos: ArchivoEOS[] = [];

  for (const crudo of crudos) {
    const archivo = normalizarArchivo(crudo);
    if (archivo) archivos.push(archivo);
  }

  const total = archivos.reduce((suma, a) => suma + a.base64.length, 0);

  if (total > MAX_BASE64_TOTAL) {
    throw new Error("Los archivos adjuntos superan el tamaño máximo del mensaje.");
  }

  return archivos;
}

function combinarObjetoRespuesta(valor: unknown): Record<string, unknown> {
  if (!valor || typeof valor !== "object") {
    return {};
  }

  if (Array.isArray(valor)) {
    for (const item of valor) {
      const encontrado = combinarObjetoRespuesta(item);
      if (Object.keys(encontrado).length > 0) {
        return encontrado;
      }
    }
    return {};
  }

  let data = valor as Record<string, unknown>;

  if (data.body && typeof data.body === "object" && !Array.isArray(data.body)) {
    data = { ...data, ...(data.body as Record<string, unknown>) };
  }

  if (
    data.response &&
    typeof data.response === "object" &&
    !Array.isArray(data.response)
  ) {
    const response = data.response as Record<string, unknown>;

    if (
      response.body &&
      typeof response.body === "object" &&
      !Array.isArray(response.body)
    ) {
      data = { ...data, ...(response.body as Record<string, unknown>) };
    }
  }

  if (data.data && typeof data.data === "object" && !Array.isArray(data.data)) {
    data = { ...data, ...(data.data as Record<string, unknown>) };
  }

  return data;
}

/**
 * Igual que `normalizarRespuestaN8N`, pero además saca del texto la
 * descripción del documento que EOS haya querido armar.
 *
 * Va separado de la normalización porque guardar el documento necesita el
 * usuario y la conversación, y la normalización es pura. Ver
 * `lib/documentos/guardar.ts` para las dos formas en que puede llegar.
 */
function normalizarRespuestaConDocumento(rawText: string): RespuestaN8N & {
  documento: Documento | null;
  recortes: string[];
} {
  const base = normalizarRespuestaN8N(rawText);

  let datos: Record<string, unknown> = {};
  try {
    datos = combinarObjetoRespuesta(JSON.parse(rawText));
  } catch {
    datos = {};
  }

  const extraido = extraerDocumento(base.respuesta, datos);

  if (extraido.motivo) {
    console.error("Documentos: EOS mandó un documento que no se pudo leer:", extraido.motivo);
  }

  return {
    ...base,
    // El texto sin el bloque cercado: el JSON crudo no puede quedar en la
    // burbuja del chat.
    respuesta: extraido.texto || base.respuesta,
    documento: extraido.documento,
    recortes: extraido.recortes,
  };
}

function normalizarRespuestaN8N(rawText: string): RespuestaN8N {
  let parsed: unknown = rawText;

  try {
    parsed = JSON.parse(rawText);
  } catch {
    parsed = rawText;
  }

  const data = combinarObjetoRespuesta(parsed);

  const textoOriginal =
    data.respuesta ?? data.output ?? data.text ?? data.message ?? buscarTexto(parsed);

  const texto =
    typeof textoOriginal === "string" ? textoOriginal : String(textoOriginal || "");

  const urlEncontrada = texto.match(/https?:\/\/[^\s]+/)?.[0] || "";

  const archivoUrl = String(
    data.archivo_url ?? data.archivoUrl ?? data.download_url ?? data.url ?? urlEncontrada,
  ).trim();

  const respuesta = limpiarRespuesta(
    texto.replace(/Descargar archivo:\s*https?:\/\/[^\s]+/i, "").trim() ||
      (archivoUrl ? "Tu archivo ya está listo para descargar." : "Listo."),
  );

  return {
    respuesta:
      respuesta && respuesta !== "[object Object]"
        ? respuesta
        : "Recibí tu mensaje, pero EOS no pudo generar una respuesta clara en este momento. Probá nuevamente.",
    archivo_url: archivoUrl,
    archivo_tipo: archivoUrl ? String(data.archivo_tipo ?? data.archivoTipo ?? "archivo") : "",
    archivo_nombre: String(data.archivo_nombre ?? data.archivoNombre ?? ""),
    tipo: archivoUrl ? "archivo" : String(data.tipo ?? "texto"),
    accion: archivoUrl
      ? String(data.accion ?? "GENERAR_ARCHIVO")
      : String(data.accion ?? "RESPONDER"),
    metadata:
      data.metadata && typeof data.metadata === "object" && !Array.isArray(data.metadata)
        ? (data.metadata as Record<string, unknown>)
        : {},
    acciones: Array.isArray(data.acciones)
      ? data.acciones.filter(
          (accion): accion is { tipo?: unknown; datos?: unknown } =>
            Boolean(accion) && typeof accion === "object" && !Array.isArray(accion),
        )
      : [],

    // Se pasa crudo: `leerEvidencia` es la única que sabe leerlo, y validarlo
    // en dos lugares distintos es cómo terminan diciendo cosas distintas.
    worker: data.worker,

    /* Si el gateway todavía no los manda, quedan en cero y no rompen nada. */
    tokens_entrada: Number(data.tokens_entrada ?? 0) || 0,
    tokens_salida: Number(data.tokens_salida ?? 0) || 0,
  };
}

async function analizarArchivoSincrono(
  archivo: ArchivoEOS,
  conversacionId: string,
): Promise<string | null> {
  try {
    const bytes = Buffer.from(archivo.base64, "base64");
    const file = new File([bytes], archivo.nombre, { type: archivo.tipo });

    const formData = new FormData();
    formData.append("archivo", file);
    if (conversacionId) formData.append("conversacion_id", conversacionId);

    const ingestRequest = new Request("http://eos.internal/api/documents/ingest", {
      method: "POST",
      body: formData,
    });

    const ingestResponse = await ingestDocument(ingestRequest);
    if (!ingestResponse.ok) return null;

    const ingestData = (await ingestResponse.json()) as {
      document?: { id?: string; extraction_status?: string };
      extraction?: { status?: string };
    };

    const documentId = ingestData.document?.id;
    const extractionStatus =
      ingestData.extraction?.status || ingestData.document?.extraction_status || "";
    if (!documentId || !["ready", "partial"].includes(extractionStatus)) {
      return null;
    }

    const analyzeRequest = new Request(
      `http://eos.internal/api/documents/${documentId}/analyze`,
      { method: "POST" },
    );

    const analyzeResponse = await analyzeDocument(analyzeRequest, {
      params: Promise.resolve({ id: documentId }),
    });
    if (!analyzeResponse.ok) return null;

    const analysis = (await analyzeResponse.json()) as {
      summary?: string;
      top_findings?: Array<{ title?: string; value_text?: string | null }>;
    };

    const hallazgos = (analysis.top_findings || [])
      .slice(0, 6)
      .map((f) => `- ${f.title}${f.value_text ? `: ${f.value_text}` : ""}`)
      .join("\n");

    const partes = [
      `[Documento adjunto: ${archivo.nombre}]`,
      analysis.summary ? `Resumen: ${analysis.summary}` : "",
      hallazgos ? `Hallazgos:\n${hallazgos}` : "",
    ].filter(Boolean);

    return partes.length > 1 ? partes.join("\n") : null;
  } catch (error) {
    console.error("No se pudo analizar el documento adjunto de forma sincrónica:", error);
    return null;
  }
}

export async function POST(req: Request) {
  const comienzo = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), N8N_TIMEOUT_MS);

  let releaseReservedQuota: ((reason: string) => Promise<void>) | null = null;

  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return Response.json(
        { respuesta: "Tu sesión no es válida o venció. Iniciá sesión nuevamente." },
        { status: 401, headers: noStoreHeaders() },
      );
    }

    let body: Record<string, unknown>;
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return Response.json(
        { respuesta: "La solicitud enviada no es válida." },
        { status: 400, headers: noStoreHeaders() },
      );
    }

    let archivos: ArchivoEOS[];
    try {
      archivos = normalizarArchivos(body as unknown as Record<string, unknown>);
    } catch (error) {
      return Response.json(
        {
          respuesta:
            error instanceof Error ? error.message : "El archivo adjunto no es válido.",
        },
        { status: 400, headers: noStoreHeaders() },
      );
    }

    // El primero, para todo lo que sigue esperando uno solo: el payload que
    // viaja a n8n y los campos `archivo_*` de la respuesta.
    const archivo = archivos[0] ?? null;

    const mensaje = typeof body.mensaje === "string" ? body.mensaje.trim() : "";

    if (!mensaje && archivos.length === 0) {
      return Response.json(
        { respuesta: "Necesito recibir un mensaje o un archivo para poder ayudarte." },
        { status: 400, headers: noStoreHeaders() },
      );
    }

    if (mensaje.length > MAX_MESSAGE_LENGTH) {
      return Response.json(
        { respuesta: "El mensaje es demasiado extenso. Reducilo e intentá nuevamente." },
        { status: 413, headers: noStoreHeaders() },
      );
    }

    const conversacionId = textoSeguro(body.conversacion_id, 120);

    // El perfil no depende de la verificación de la conversación ni del
    // análisis del adjunto, así que se dispara ya y se espera recién cuando
    // hace falta: era un viaje a Supabase esperando en fila sin motivo.
    // Nunca rechaza, para que un `return` temprano no deje una promesa suelta.
    const usuarioPromise: Promise<{ data: UsuarioEOS | null; error: unknown }> = Promise.resolve(
      supabase
        .from("usuarios")
        .select("nombre, plan, estado_suscripcion, plan_vencimiento")
        .eq("id", user.id)
        .maybeSingle<UsuarioEOS>(),
    ).catch((error: unknown) => ({ data: null, error }));

    /*
     * Cómo va el negocio, pedido en paralelo con el perfil.
     *
     * Va en el prompt de CADA mensaje: sin esto el asistente no sabe una sola
     * cifra del negocio de quien le escribe, y "¿cómo venimos este mes?" sólo
     * se puede contestar con generalidades.
     *
     * Es una función sola —29 ms medidos contra producción— y no ocho consultas
     * sueltas, porque esto está en el camino crítico de una conversación. Si
     * falla, se sigue sin contexto: quedarse sin contestar por no poder contar
     * las ventas sería peor que contestar sin las ventas.
     */
    const contextoPromise: Promise<ContextoNegocio | null> = Promise.resolve(
      adminSinTipos().rpc("eos_contexto_negocio", { p_usuario_id: user.id }),
    )
      .then(({ data, error }: { data: ContextoNegocio | null; error: unknown }) => {
        if (error) {
          console.error("EOS: no se pudo armar el contexto del negocio:", error);
          return null;
        }

        return data;
      })
      .catch((error: unknown) => {
        console.error("EOS: error inesperado armando el contexto:", error);
        return null;
      });

    /*
     * Lo que EOS ya sabía de esta persona, y nunca leía.
     *
     * `GUARDAR_MEMORIA` es la acción más ejecutada del sistema y la cabecera
     * del chat dice "Memoria contextual", pero el prompt jamás incluyó una
     * sola de esas filas: se guardaban y ahí terminaba todo. Cada conversación
     * arrancaba de cero sobre una base llena de contexto, que es exactamente
     * lo que se siente como que el asistente se olvida de todo.
     *
     * Las tres lecturas van juntas y en paralelo con el resto. Si alguna
     * falla, se sigue sin ese pedazo: no poder leer un objetivo no es motivo
     * para no contestar. `lib/eos/memoria-contexto.ts` filtra, deduplica y
     * corta —lo guardado tiene repetidos— y devuelve cadena vacía cuando no
     * hay nada que valga la pena.
     */
    const memoriaPromise: Promise<string> = (async () => {
      try {
        const admin = adminSinTipos();

        const [memorias, objetivosPersonales, objetivosNegocio, tareas, aprendizajes] = await Promise.all([
          admin
            .from("eos_memory")
            .select("titulo, contenido, importancia, estado")
            .eq("usuario_id", user.id)
            .eq("estado", "activo")
            .order("importancia", { ascending: false })
            .order("updated_at", { ascending: false })
            .limit(30),
          /*
           * Los objetivos, en dos consultas y no en una.
           *
           * "Llegar a 30 millones" significa cosas distintas si es la
           * facturación del negocio o el ahorro de la persona. Leerlos juntos
           * los deja indistinguibles para el modelo, que después contesta
           * sobre una mezcla; `textoMemoria` los rotula cuando hay de los dos.
           */
          admin
            .from("eos_goals")
            .select("titulo, progreso, fecha_limite, proximo_paso, estado, ambito")
            .eq("usuario_id", user.id)
            .eq("ambito", "personal")
            .eq("estado", "activo")
            .order("prioridad", { ascending: false })
            .limit(20),
          admin
            .from("eos_goals")
            .select("titulo, progreso, fecha_limite, proximo_paso, estado, ambito")
            .eq("usuario_id", user.id)
            .eq("ambito", "negocio")
            .eq("estado", "activo")
            .order("prioridad", { ascending: false })
            .limit(20),
          // Lo que tiene pendiente. "¿Qué tengo pendiente hoy?" es una de las
          // cuatro tarjetas de la pantalla de inicio, y el modelo nunca recibía
          // una sola tarea.
          admin
            .from("eos_tasks")
            .select("titulo, estado, prioridad, fecha_limite")
            .eq("usuario_id", user.id)
            .neq("estado", "completada")
            .order("prioridad", { ascending: false })
            .limit(20),
          admin
            .from("eos_learnings")
            .select("recomendacion, confianza, evidence_count, estado, categoria")
            .eq("usuario_id", user.id)
            .eq("estado", "activo")
            .order("confianza", { ascending: false })
            .limit(10),
        ]);

        return textoMemoria({
          memorias: memorias.data ?? [],
          objetivos: [...(objetivosPersonales.data ?? []), ...(objetivosNegocio.data ?? [])],
          tareas: tareas.data ?? [],
          aprendizajes: aprendizajes.data ?? [],
        });
      } catch (error) {
        console.error("EOS: no se pudo leer la memoria del usuario:", error);
        return "";
      }
    })();

    if (conversacionId) {
      if (!esUuid(conversacionId)) {
        return Response.json(
          { respuesta: "La conversación indicada no es válida." },
          { status: 400, headers: noStoreHeaders() },
        );
      }

      const { data: conversacion, error: conversationError } = await supabase
        .from("conversaciones")
        .select("id")
        .eq("id", conversacionId)
        .eq("usuario_id", user.id)
        .maybeSingle();

      if (conversationError) {
        console.error("No se pudo verificar la conversación EOS:", conversationError);
        return Response.json(
          {
            respuesta:
              "No pudimos verificar esta conversación de forma segura. Probá nuevamente.",
          },
          { status: 503, headers: noStoreHeaders() },
        );
      }

      if (!conversacion) {
        return Response.json(
          { respuesta: "La conversación no pertenece a tu sesión actual." },
          { status: 403, headers: noStoreHeaders() },
        );
      }
    }

    /*
     * Los documentos se leen TODOS, y en paralelo.
     *
     * Antes se leía el único que había. Con varios, hacerlo en serie sumaría
     * la espera de cada uno a la del mensaje: cinco planillas de dos segundos
     * son diez segundos antes de que el modelo empiece siquiera a leer.
     *
     * Las imágenes no pasan por acá: las mira el modelo directamente.
     */
    let mensajeConAnalisis = mensaje;

    const extraibles = archivos.filter((a) => SYNC_EXTRACTABLE_TYPES.has(a.tipo));

    if (extraibles.length > 0) {
      const analisis = (
        await Promise.all(extraibles.map((a) => analizarArchivoSincrono(a, conversacionId)))
      ).filter((texto): texto is string => Boolean(texto));

      if (analisis.length > 0) {
        const bloque = analisis.join("\n\n");
        mensajeConAnalisis = mensaje ? `${mensaje}\n\n${bloque}` : bloque;
      }
    }

    const { data: usuario, error: usuarioError } = await usuarioPromise;

    if (usuarioError) {
      console.error("No se pudo cargar el perfil EOS:", usuarioError);
    }

    const nombreServidor =
      textoSeguro(usuario?.nombre, 120) ||
      textoSeguro(user.user_metadata?.nombre, 120) ||
      textoSeguro(user.user_metadata?.name, 120) ||
      textoSeguro(user.email?.split("@")[0], 120) ||
      "Usuario";
    const planServidor = planEfectivo(usuario ?? null);

    /*
     * Las cifras primero y la memoria después, en un solo campo.
     *
     * El nodo 01 del workflow descarta todo campo del payload que no nombre
     * explícitamente, así que agregar `memoria` como campo propio exigiría
     * tocar n8n para que viaje. Va acá adentro, separado por su encabezado.
     * El día que el gateway corra entero en TypeScript esto se puede partir en
     * dos; hasta entonces, un campo que llega es mejor que dos que se pierden.
     */
    const contextoNegocio = [textoContexto(await contextoPromise), await memoriaPromise]
      .filter((parte) => parte.trim() !== "")
      .join("\n\n");

    const origen = textoSeguro(body.origen, 50) || "eos-web";
    const nuevoChat = body.nuevo_chat === true;
    const requestId = esUuid(body.request_id) ? body.request_id : crypto.randomUUID();

    /*
     * La cita, validada del lado del servidor.
     *
     * El `mensaje_id` se guarda como texto y no se comprueba contra la base: es
     * para poder rastrear a qué respuesta apuntaba, no una llave que abra nada.
     * Lo que sí se acota es el TEXTO, que es lo que entra en el prompt.
     */
    const citaCruda = (body.cita ?? null) as Record<string, unknown> | null;
    const citaTexto = limpiarSeleccion(
      citaCruda && typeof citaCruda === "object" && !Array.isArray(citaCruda)
        ? citaCruda.texto
        : "",
    );

    const cita = citaTexto
      ? {
          texto: citaTexto,
          mensaje_id: textoSeguro(
            (citaCruda as Record<string, unknown>).mensaje_id ??
              (citaCruda as Record<string, unknown>).mensajeId,
            120,
          ),
        }
      : null;

    const payload = {
      request_id: requestId,
      usuario_id: user.id,
      conversacion_id: conversacionId,
      nombre: nombreServidor,
      plan: planServidor,
      // Vacío cuando la persona todavía no cargó nada: mandar un bloque lleno
      // de ceros haría que el modelo hable de un negocio parado.
      contexto_negocio: contextoNegocio,
      mensaje: mensajeConAnalisis,
      historial: normalizarHistorial(body.historial),
      nuevo_chat: nuevoChat,
      /*
       * Los dos campos, y no uno.
       *
       * `archivos` es la lista completa y es lo que hay que leer. `archivo`
       * con el primero se sigue mandando porque el nodo 01 del workflow arma
       * su salida campo por campo y descarta lo que no nombra: hasta que ese
       * nodo lea `archivos`, sacar `archivo` dejaría a EOS sin ver ninguna
       * imagen. Ver `n8n/parches/2026-09-06-varias-imagenes.mjs`.
       */
      archivo,
      archivos,
      /*
       * El pedazo de una respuesta de EOS sobre el que se está preguntando.
       *
       * Viaja aparte del mensaje —que ya lo lleva adentro con "> " adelante—
       * porque las dos cosas dicen algo distinto: el texto le da el contenido
       * al modelo, y este campo le dice que ese contenido es SUYO. Sin la
       * distinción, el modelo lee la cita como algo que escribió la persona y
       * recalcula el número en vez de explicar de dónde salió.
       *
       * Se limpia acá y no se confía en el cliente: `limpiarSeleccion` acota
       * el largo, y sin ese tope el prompt lo pone cualquiera que edite el
       * pedido a mano.
       */
      cita,
      origen,
      fecha: new Date().toISOString(),
    };

    const quotaAdmin = adminSinTipos();
    const { data: quotaRaw, error: quotaError } = await quotaAdmin.rpc(
      "eos_reserve_message_quota_server_v75",
      {
        p_usuario_id: user.id,
        p_request_id: payload.request_id,
      },
    );

    if (quotaError || !quotaRaw || typeof quotaRaw !== "object" || Array.isArray(quotaRaw)) {
      console.error("No se pudo reservar la cuota de mensajes EOS:", quotaError || quotaRaw);
      return Response.json(
        {
          respuesta:
            "No pudimos verificar tu disponibilidad de mensajes. Probá nuevamente en unos segundos.",
          code: "EOS_MESSAGE_QUOTA_UNAVAILABLE",
        },
        { status: 503, headers: noStoreHeaders() },
      );
    }

    const quota = quotaRaw as Record<string, unknown>;
    if (quota.allowed !== true) {
      const code = typeof quota.code === "string" ? quota.code : "EOS_MESSAGE_NOT_ALLOWED";
      const isLimit = code === "EOS_MESSAGE_LIMIT_REACHED";
      const isInProgress = code === "EOS_MESSAGE_REQUEST_IN_PROGRESS";
      const isConsumedReplay = code === "EOS_MESSAGE_REQUEST_ALREADY_CONSUMED";
      const isReplayConflict = isInProgress || isConsumedReplay;
      const isFree = quota.plan === "free";

      return Response.json(
        {
          respuesta: isLimit
            ? isFree
              ? "Llegaste a tus 5 mensajes gratuitos de hoy. Tu cupo se renueva mañana según la hora de Paraguay. Si querés seguir ahora, podés elegir un plan en Planes."
              : "Llegaste al límite de mensajes de tu plan actual. Podés revisar tus opciones en Planes."
            : isInProgress
              ? "Este mensaje ya se está procesando. Esperá la respuesta antes de volver a enviarlo."
              : isConsumedReplay
                ? "Este mensaje ya fue procesado. Para continuar, enviá un mensaje nuevo."
                : "Tu suscripción no permite enviar mensajes en este momento. Revisá tu plan para continuar.",
          code,
          commercial: quota,
          ...(isLimit || !isReplayConflict ? { upgrade_url: "/planes" } : {}),
        },
        {
          status: isReplayConflict ? 409 : isLimit ? 429 : 402,
          headers: noStoreHeaders(),
        },
      );
    }

    let quotaReleased = false;
    const releaseQuota = async (reason: string) => {
      if (quotaReleased) return;
      quotaReleased = true;

      const { error: releaseError } = await quotaAdmin.rpc(
        "eos_release_message_quota_server_v75",
        {
          p_usuario_id: user.id,
          p_request_id: payload.request_id,
          p_reason: reason.slice(0, 160),
        },
      );

      if (releaseError) {
        console.error("No se pudo liberar la reserva de mensaje EOS:", releaseError);
      }
    };

    releaseReservedQuota = releaseQuota;

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (process.env.N8N_EOS_INTERNAL_SECRET) {
      headers["x-eos-internal-secret"] = process.env.N8N_EOS_INTERNAL_SECRET;
    }

    /*
     * Etapa 1 de `docs/salida-de-n8n.md`: la conversación pura en TypeScript.
     *
     * Toda la migración cabe acá adentro porque n8n entra por un solo `fetch`.
     * `conversar` devuelve `null` ante cualquier problema y `delegar` cuando
     * el modelo pidió acciones —el nodo que las arma sigue en n8n— así que en
     * los dos casos sigue de largo y el código de abajo es exactamente el de
     * siempre.
     *
     * La bandera es `EOS_GATEWAY_TS=1`. Sin ella, o sin `OPENAI_API_KEY`, este
     * bloque no hace nada.
     */
    let response: Response | null = null;

    if (gatewayEnTypeScript()) {
      const propio = await conversar(payload);

      if (propio?.estado === "respondido" || propio?.estado === "completado") {
        response = Response.json(propio.cuerpo);
      } else if (propio?.estado === "delegar") {
        console.info("Gateway TS: delega en n8n por", propio.motivo);
      }
    }

    if (response === null) {
      try {
        response = await fetch(N8N_EOS_URL, {
          method: "POST",
          headers,
          body: JSON.stringify(payload),
          signal: controller.signal,
          cache: "no-store",
        });
      } catch (n8nError) {
        await releaseQuota(
          n8nError instanceof Error && n8nError.name === "AbortError"
            ? "n8n_timeout"
            : "n8n_fetch_error",
        );
        throw n8nError;
      }
    }

    const rawText = await response.text();

    if (!response.ok) {
      /*
       * El cuerpo NO se registra.
       *
       * Antes iban mil caracteres crudos al log de Vercel. Ese cuerpo puede
       * traer de vuelta el mensaje que escribió la persona —n8n suele
       * devolver la entrada adentro del error— y el log de Vercel queda
       * guardado, lo ve cualquiera con acceso al panel, y no se borra cuando
       * el usuario pide que lo borren.
       *
       * Lo que sirve para diagnosticar es el código y el tamaño. Si alguna vez
       * hace falta el cuerpo, se reproduce.
       */
      console.error("Error desde n8n:", resumenDeRespuesta(response.status, rawText));
      await releaseQuota(`n8n_http_${response.status}`);

      return Response.json(
        {
          respuesta:
            "EOS recibió tu mensaje, pero tuvo un problema procesándolo. Probá nuevamente en unos segundos.",
        },
        {
          status: response.status >= 400 && response.status < 600 ? response.status : 502,
          headers: noStoreHeaders(),
        },
      );
    }

    if (!rawText.trim()) {
      await releaseQuota("n8n_empty_response");
      return Response.json(
        {
          respuesta:
            "Recibí tu mensaje, pero EOS no pudo generar una respuesta clara en este momento. Probá nuevamente.",
          code: "EOS_EMPTY_RESPONSE",
        },
        { status: 502, headers: noStoreHeaders() },
      );
    }

    const resultado = normalizarRespuestaConDocumento(rawText);

    /*
     * Primero: que no diga que hizo algo que no hizo.
     *
     * Va ANTES del aviso de aprobación porque son dos casos distintos que se
     * excluyen. Si hubo acción, la operación existe y solo falta aprobarla —y
     * de eso avisa la línea de abajo—. Si NO hubo ninguna acción y la
     * respuesta igual afirma haber registrado algo que el usuario pidió
     * registrar, la afirmación es falsa con certeza, y eso se corrige antes de
     * que la persona siga con su día creyendo que quedó guardado.
     */
    resultado.respuesta = corregirAfirmacionSinAccion(
      resultado.respuesta,
      resultado.acciones,
      mensaje,
    );

    /*
     * ============================================================
     * QUÉ PASÓ DE VERDAD CON LO QUE PIDIÓ
     * ============================================================
     *
     * Lo que había acá antes deducía "no se guardó nada" de que no hubiera
     * una aprobación pendiente. Eso fue cierto hasta el 3 de septiembre de
     * 2026; desde entonces las acciones del negocio se ejecutan solas y una
     * venta que sale BIEN no deja ninguna aprobación. Resultado: durante seis
     * días, toda venta registrada con éxito venía con "⚠️ No llegué a dejarlo
     * listo… no se guardó nada. Cargalo desde la sección Negocio".
     *
     * Ahora se lee lo que el Worker informó —que n8n manda desde siempre y se
     * descartaba— y la base solo se consulta cuando de verdad hace falta:
     * cuando alguna acción quedó sin ninguna noticia. En el camino feliz eso
     * ahorra además un viaje a Supabase en el camino crítico.
     */
    const evidencia = leerEvidencia(resultado.worker);

    let verificaciones = verificarAcciones(resultado.acciones, evidencia, false);

    if (verificaciones.some((v) => v.estado === "sin_evidencia")) {
      // Solo cuenta lo reciente: una aprobación de la semana pasada, todavía
      // vigente, no es la de este mensaje.
      const desde = new Date(Date.now() - 3 * 60_000).toISOString();

      const { data: pendientes } = await adminSinTipos()
        .from("eos_action_approvals_v12")
        .select("id")
        .eq("usuario_id", user.id)
        .eq("status", "pending")
        .gt("expires_at", new Date().toISOString())
        .gte("created_at", desde)
        .limit(1);

      if ((pendientes?.length ?? 0) > 0) {
        verificaciones = verificarAcciones(resultado.acciones, evidencia, true);
      } else {
        console.error(
          "EOS: el modelo pidió una acción con efecto durable y nadie informó qué pasó con ella.",
          {
            acciones: verificaciones
              .filter((v) => v.estado === "sin_evidencia")
              .map((v) => v.accion),
            worker_informado: evidencia.informado,
          },
        );
      }
    }

    // Si el texto habla en pasado y ninguna acción quedó escrita, se corrige
    // antes que nada: el resto del mensaje se lee después de la advertencia.
    resultado.respuesta = corregirAfirmacionFallida(resultado.respuesta, verificaciones);

    resultado.respuesta = avisoDeVerificacion(
      resultado.respuesta,
      verificaciones,
      new URL(req.url).origin,
    );

    /*
     * ============================================================
     * CUÁNTO COSTÓ ESTE MENSAJE
     * ============================================================
     *
     * Los tokens vienen del gateway, que los saca de la respuesta de OpenAI.
     * Antes se descartaban y `uso_mensual` acumulaba ceros: EOS cobraba por mes
     * sin saber cuánto le costaba cada usuario.
     *
     * Importa más de lo que parece porque el consumo NO es proporcional a los
     * mensajes. Un "hola" ya cuesta unos 1.300 tokens de entrada —el prompt
     * lleva el contexto del negocio, el historial y las instrucciones— y un
     * mensaje con una foto adjunta cuesta un orden de magnitud más. Dos
     * clientes con el mismo plan y la misma cantidad de mensajes pueden
     * costarnos diez veces distinto.
     *
     * El precio en dólares sale de dos variables de entorno y NO de una
     * constante en el código: la tarifa cambia con cada modelo, y un número
     * clavado acá es un número que dentro de tres meses es falso y nadie
     * corrige. Si no están configuradas, el costo queda en cero y los tokens
     * igual se guardan — que es lo que después se puede convertir a plata en
     * cualquier momento.
     */
    const tokensEntrada = Math.max(0, Math.trunc(Number(resultado.tokens_entrada ?? 0)) || 0);
    const tokensSalida = Math.max(0, Math.trunc(Number(resultado.tokens_salida ?? 0)) || 0);

    const costoEstimado =
      (tokensEntrada / 1_000_000) * Number(process.env.EOS_USD_POR_MTOK_ENTRADA || 0) +
      (tokensSalida / 1_000_000) * Number(process.env.EOS_USD_POR_MTOK_SALIDA || 0);

    const { data: finalizeRaw, error: finalizeError } = await quotaAdmin.rpc(
      "eos_finalize_message_quota_server_v75",
      {
        p_usuario_id: user.id,
        p_request_id: payload.request_id,
        p_tokens_entrada: tokensEntrada,
        p_tokens_salida: tokensSalida,
        p_costo_estimado_usd: Number.isFinite(costoEstimado) ? costoEstimado : 0,
      },
    );

    const finalizeOk =
      !finalizeError &&
      finalizeRaw &&
      typeof finalizeRaw === "object" &&
      !Array.isArray(finalizeRaw) &&
      (finalizeRaw as Record<string, unknown>).ok === true;

    if (!finalizeOk) {
      console.error(
        "EOS respondió, pero no se pudo confirmar el consumo:",
        finalizeError || finalizeRaw,
      );
      await releaseQuota("quota_finalize_failed");
      return Response.json(
        {
          respuesta:
            "EOS procesó tu mensaje, pero no pudimos confirmar tu cupo de forma segura. Probá nuevamente.",
          code: "EOS_MESSAGE_QUOTA_FINALIZE_FAILED",
        },
        { status: 503, headers: noStoreHeaders() },
      );
    }

    quotaReleased = true;
    releaseReservedQuota = null;

    /*
     * El archivo que EOS quiso mandar.
     *
     * Se guarda DESPUÉS de confirmar el cupo y no antes: si el mensaje se cae a
     * mitad de camino, no queda un documento colgado que el usuario nunca pidió.
     * Y si el guardado falla, la respuesta sale igual sin el enlace — perder el
     * archivo es molesto, perder la respuesta entera por el archivo es peor.
     */
    let archivoDocumento: { url: string; nombre: string; tipo: string } | null = null;

    if (resultado.documento) {
      const formato = formatoPedido(payload.mensaje, resultado.metadata?.formato);

      const guardado = await guardarDocumento(createAdminClient(), {
        usuarioId: user.id,
        conversacionId: payload.conversacion_id,
        documento: resultado.documento,
        formato,
        recortes: resultado.recortes,
      });

      if (guardado) {
        archivoDocumento = {
          url: guardado.url,
          nombre: guardado.nombreArchivo,
          tipo: FORMATOS_DOCUMENTO[formato].etiqueta.toLowerCase(),
        };
      }
    }

    after(async () => {
      try {
        await fetch(
          process.env.N8N_DECISION_CAPTURE_URL ||
            "https://n8n-production-6cdb.up.railway.app/webhook/eos-decision-capture",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              usuario_id: payload.usuario_id,
              request_id: payload.request_id,
              conversacion_id: payload.conversacion_id,
              mensaje: payload.mensaje,
              respuesta: resultado.respuesta,
            }),
            signal: AbortSignal.timeout(2500),
          },
        );
      } catch (captureError) {
        console.log("Registro de decisión no disponible:", captureError);
      }
    });

    /*
     * ============================================================
     * UNA LÍNEA POR MENSAJE, PARA PODER CONTESTAR "¿POR QUÉ NO LO HIZO?"
     * ============================================================
     *
     * Hasta acá, diagnosticar por qué EOS no registró algo pedía mirar el log
     * de Vercel, el de n8n y tres tablas de Supabase, y aun así el dato que
     * más falta —qué acción pidió el modelo y en qué terminó— no estaba
     * escrito en ningún lado. Reconstruir el caso de la venta del 9 de
     * septiembre llevó una auditoría entera del pipeline.
     *
     * Con esto, `request_id` alcanza para saber qué entendió, qué acciones
     * salieron y cómo terminó cada una.
     *
     * NO se registra: el mensaje, la respuesta, la cita, ni ningún nombre de
     * producto o de cliente. El log de Vercel queda guardado, lo ve cualquiera
     * con acceso al panel y no se borra cuando el usuario pide que se borren
     * sus datos. Lo que va son identificadores, tipos de acción y estados —que
     * es exactamente lo que sirve para diagnosticar y nada más.
     */
    console.info(
      "EOS mensaje:",
      JSON.stringify({
        request_id: payload.request_id,
        usuario_id: payload.usuario_id,
        conversacion_id: payload.conversacion_id || null,
        origen: payload.origen,
        gateway: resultado.metadata?.gateway === "ts" ? "ts" : "n8n",
        con_cita: Boolean(cita),
        adjuntos: archivos.length,
        acciones: resultado.acciones.map((a) => String(a?.tipo ?? "")),
        verificacion: verificaciones.map((v) => `${v.accion}:${v.estado}`),
        worker_informado: evidencia.informado,
        tokens: { entrada: tokensEntrada, salida: tokensSalida },
        ms: Date.now() - comienzo,
      }),
    );

    // La descripción del documento no viaja al cliente: ya está guardada, y
    // puede pesar más que la respuesta entera. Por eso se nombran los campos
    // uno por uno en vez de esparcir `resultado`.
    const paraElCliente = {
      respuesta: resultado.respuesta,
      archivo_url: resultado.archivo_url,
      archivo_tipo: resultado.archivo_tipo,
      archivo_nombre: resultado.archivo_nombre,
      tipo: resultado.tipo,
      accion: resultado.accion,
    };

    return Response.json(
      {
        ...paraElCliente,
        ...(archivoDocumento
          ? {
              archivo_url: archivoDocumento.url,
              archivo_nombre: archivoDocumento.nombre,
              archivo_tipo: archivoDocumento.tipo,
              tipo: "archivo",
              accion: "GENERAR_ARCHIVO",
            }
          : {}),
        metadata: {
          ...resultado.metadata,
          usuario_id: payload.usuario_id,
          request_id: payload.request_id,
          conversacion_id: payload.conversacion_id,
          origen: payload.origen,
          fecha: payload.fecha,
          archivo_recibido: Boolean(archivo),
        },
      },
      { headers: noStoreHeaders() },
    );
  } catch (error) {
    if (releaseReservedQuota) {
      try {
        await releaseReservedQuota("api_eos_exception");
      } catch (releaseError) {
        console.error("No se pudo liberar la reserva tras excepción:", releaseError);
      }
    }

    const timeout = error instanceof Error && error.name === "AbortError";

    console.error("Error proxy EOS:", error);

    return Response.json(
      {
        respuesta: timeout
          ? "EOS tardó más de lo esperado en responder. Probá nuevamente en unos segundos."
          : "No pude conectarme con EOS en este momento. Probá nuevamente.",
      },
      { status: timeout ? 504 : 500, headers: noStoreHeaders() },
    );
  } finally {
    clearTimeout(timeout);
  }
}
