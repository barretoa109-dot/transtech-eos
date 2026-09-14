import { createClient } from "@/lib/supabase/server";
import { MAX_ADJUNTOS, MAX_BASE64_TOTAL } from "@/lib/eos/adjuntos";
import {
  procesarMensajeEOS,
  normalizarArchivo,
  textoSeguro,
  MAX_MESSAGE_LENGTH,
  type ArchivoEOS,
} from "@/lib/eos/procesar-mensaje";

function noStoreHeaders() {
  return {
    "Cache-Control": "private, no-store, max-age=0",
    Vary: "Cookie",
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

export async function POST(req: Request) {
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
    archivos = normalizarArchivos(body);
  } catch (error) {
    return Response.json(
      {
        respuesta:
          error instanceof Error ? error.message : "El archivo adjunto no es válido.",
      },
      { status: 400, headers: noStoreHeaders() },
    );
  }

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

  // El nombre que se usa si `usuarios.nombre` está vacío. El motor
  // compartido no sabe nada de la sesión de Supabase, así que se resuelve
  // acá con lo que ya tenemos del `user` autenticado.
  const nombreFallback =
    textoSeguro(user.user_metadata?.nombre, 120) ||
    textoSeguro(user.user_metadata?.name, 120) ||
    textoSeguro(user.email?.split("@")[0], 120);

  const resultado = await procesarMensajeEOS(user.id, {
    mensaje,
    archivos,
    conversacionId: textoSeguro(body.conversacion_id, 120),
    historial: body.historial,
    origen: textoSeguro(body.origen, 50) || "eos-web",
    nuevoChat: body.nuevo_chat === true,
    cita: body.cita,
    requestId: body.request_id,
    nombreFallback,
    requestOrigin: new URL(req.url).origin,
  });

  return Response.json(resultado.body, {
    status: resultado.status,
    headers: noStoreHeaders(),
  });
}
