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

export async function enviarMensajeAEOS(params: EnviarEOSParams): Promise<RespuestaEOS>{
  const response=await fetch("/api/eos",{
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({
      usuario_id:params.usuarioId,
      conversacion_id:params.conversacionId,
      nombre:params.nombre,
      plan:params.plan,
      mensaje:params.mensaje,
      historial:params.historial.filter(m=>!m.texto.includes("Este es un nuevo chat")).slice(-10),
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

  const raw=await response.text();
  if(!raw.trim()) throw new Error("EOS respondió vacío");

  let parsed:unknown=raw;
  try{ parsed=JSON.parse(raw);}catch{}
  const resultado=normalizarRespuesta(parsed);

  if(!response.ok){
    throw new Error(resultado.respuesta||"Error en EOS");
  }

  return resultado;
}