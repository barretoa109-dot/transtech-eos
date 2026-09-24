import type { ArchivoAdjunto, Mensaje } from "../types/chat";
import type { Cita } from "@/lib/eos/cita";

type EnviarEOSParams = {
  usuarioId: string;
  conversacionId: string;
  nombre: string;
  plan: string;
  mensaje: string;
  historial: Mensaje[];
  nuevoChat: boolean;
  archivos?: ArchivoAdjunto[];
  cita?: Cita | null;
};

export type RespuestaEOS = {
  respuesta?: string;
  archivo_url?: string;
  archivo_tipo?: string;
  archivo_nombre?: string;
  tipo?: string;
  accion?: string;
  metadata?: Record<string, unknown>;
};

function limpiarTexto(valor: unknown): string {
  if (typeof valor !== "string") return "";
  return valor.replace(/^=/,"")
    .replace(/^```json/i,"")
    .replace(/^```/,"")
    .replace(/```$/,"")
    .replace(/\\n/g,"\n")
    .replace(/\\"/g,'"')
    .trim();
}

function normalizarRespuesta(valor: unknown): RespuestaEOS {
  let data:any = valor;
  if(typeof data==="string"){
    try{ data=JSON.parse(data.trim()); }
    catch{
      return {respuesta:limpiarTexto(data),tipo:"texto",accion:"RESPONDER",archivo_url:"",archivo_tipo:"",archivo_nombre:"",metadata:{}};
    }
  }
  if(data?.body && typeof data.body==="object") data=data.body;
  if(data?.response?.body && typeof data.response.body==="object") data=data.response.body;
  if(data?.data && typeof data.data==="object") data={...data,...data.data};

  const original=String(data?.respuesta||data?.output||data?.text||data?.message||"");
  const url=String(
    data?.archivo_url||
    data?.archivoUrl||
    data?.download_url||
    data?.url||
    (original.match(/https?:\/\/[^\s]+/)?.[0]||"")
  ).trim();

  return {
    respuesta: limpiarTexto(
      original.replace(/Descargar archivo:\s*https?:\/\/[^\s]+/i,"").trim() ||
      (url ? "Tu archivo ya está listo para descargar." : "Listo.")
    ),
    tipo: url ? "archivo" : String(data?.tipo||"texto"),
    accion: url ? String(data?.accion||"GENERAR_ARCHIVO") : String(data?.accion||"RESPONDER"),
    archivo_url: url,
    archivo_tipo: url ? String(data?.archivo_tipo||data?.archivoTipo||"archivo") : "",
    archivo_nombre: String(data?.archivo_nombre||data?.archivoNombre||""),
    metadata: data?.metadata && typeof data.metadata==="object" ? data.metadata : {}
  };
}

/*
 * ============================================================
 * QUE UN CORTE DE CONEXIÓN NO PIERDA LA RESPUESTA (24/09/2026)
 * ============================================================
 *
 * En el celular, el sistema operativo corta el `fetch` si la respuesta tarda
 * o si la app pasa a segundo plano, y el chat mostraba "Ahora mismo no pude
 * conectarme" en medio de la conversación. Pero el servidor sigue trabajando
 * aunque el teléfono haya cortado: la respuesta se generaba igual y se
 * perdía, y si la persona reenviaba el mensaje arriesgaba cargar dos veces
 * una venta.
 *
 * Ahora cada envío lleva su `request_id`, el servidor deja la respuesta en un
 * buzón (v196), y si la conexión se cae se la pide a `/api/eos/resultado`
 * hasta que aparece. El mensaje NUNCA se reenvía: se espera el que ya está en
 * camino.
 */
const ESPERA_RECUPERACION_MS = 150_000;
const INTERVALO_RECUPERACION_MS = 3_000;

function nuevoRequestId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Respaldo para navegadores viejos: UUID v4 con Math.random.
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

const dormir = (ms: number) => new Promise((resolver) => setTimeout(resolver, ms));

async function recuperarRespuesta(requestId: string): Promise<RespuestaEOS | null> {
  const limite = Date.now() + ESPERA_RECUPERACION_MS;

  while (Date.now() < limite) {
    await dormir(INTERVALO_RECUPERACION_MS);
    try {
      const r = await fetch(`/api/eos/resultado?request_id=${encodeURIComponent(requestId)}`, {
        cache: "no-store",
      });
      if (r.status === 401) return null;
      const data = (await r.json().catch(() => null)) as
        | { listo?: boolean; estado_http?: number; cuerpo?: unknown }
        | null;
      if (!data?.listo) continue;

      const resultado = normalizarRespuesta(data.cuerpo);
      const estado = Number(data.estado_http) || 200;
      if (estado < 200 || estado >= 300) throw new Error(resultado.respuesta || "Error en EOS");
      return resultado;
    } catch (error) {
      // Un error de red al preguntar no es el final: se sigue esperando.
      if (!(error instanceof TypeError)) throw error;
    }
  }

  return null;
}

export async function enviarMensajeAEOS(params: EnviarEOSParams): Promise<RespuestaEOS>{
  const requestId = nuevoRequestId();

  let response: Response;
  try {
    response = await enviarAlServidor(params, requestId);
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    // La conexión se cortó: la respuesta puede estar llegando igual.
    const recuperada = await recuperarRespuesta(requestId);
    if (recuperada) return recuperada;
    throw error;
  }

  return await leerRespuesta(response);
}

function enviarAlServidor(params: EnviarEOSParams, requestId: string): Promise<Response>{
  return fetch("/api/eos",{
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({
      request_id:requestId,
      usuario_id:params.usuarioId,
      conversacion_id:params.conversacionId,
      nombre:params.nombre,
      plan:params.plan,
      mensaje:params.mensaje,
      // Los avisos de error no son algo que EOS dijo: no van como contexto.
      historial:params.historial.filter(m=>m.estado!=="error"&&!m.texto.includes("Este es un nuevo chat")).slice(-10),
      nuevo_chat:params.nuevoChat,
      /*
       * Los dos campos, y no uno.
       *
       * `archivos` es el nuevo y es el que el servidor lee. `archivo` con el
       * primero se sigue mandando porque el workflow de n8n arma su payload
       * campo por campo y descarta lo que no nombra: mientras esa parte no se
       * despliegue, sacar `archivo` dejaría a EOS sin ver ninguna imagen.
       *
       * Se saca cuando el nodo 01 del gateway lea `archivos`.
       */
      archivo:(params.archivos??[])[0]??null,
      archivos:params.archivos??[],
      /*
       * La cita, aparte del texto.
       *
       * El fragmento también va adentro de `mensaje` —con "> " adelante— para
       * que quede guardado en la conversación. Este campo es el que le dice al
       * modelo que ese pedazo es SUYO: pegado nada más, lo lee como algo que
       * escribió la persona y vuelve a calcularlo en vez de explicarlo.
       */
      cita:params.cita?.texto ? {texto:params.cita.texto, mensaje_id:params.cita.mensajeId||""} : null,
      origen:"eos-web"
    })
  });
}

async function leerRespuesta(response: Response): Promise<RespuestaEOS>{
  const raw=await response.text();
  if(!raw.trim()) throw new Error("EOS respondió vacío");

  let parsed:unknown=raw;
  let esJson=false;
  try{ parsed=JSON.parse(raw); esJson=true; }catch{}

  /*
   * Un error que NO es JSON no lo escribió EOS: es la página de error de la
   * plataforma (un corte por tiempo, un 502 del proxy). Mostrarla era mostrar
   * HTML o un código interno en medio del chat.
   */
  if(!response.ok && !esJson){
    throw new Error("EOS tardó más de lo esperado en responder. Probá de nuevo en unos segundos.");
  }

  const resultado=normalizarRespuesta(parsed);

  if(!response.ok){
    throw new Error(resultado.respuesta||"Error en EOS");
  }

  return resultado;
}