/**
 * Cuando la IA no responde, el mensaje queda en espera y no se pierde.
 *
 * Tarea encargado-08 del tablero de lanzamiento. Antes, si OpenAI se caía, la
 * persona esperaba hasta 110 s y recibía "probá nuevamente": si no lo volvía
 * a escribir, la venta que había dictado no quedaba en ningún lado.
 *
 * El recorrido ahora:
 *
 *  1. El gateway en TypeScript reconoce la caída (`esCaidaDeIA`) ANTES de
 *     ejecutar ninguna acción: el modelo es lo primero que se llama. Por eso
 *     reintentar es seguro, no hay nada a medio hacer.
 *  2. `procesarMensajeEOS` guarda el mensaje en eos_mensajes_en_espera_v214
 *     (v214), libera el cupo y contesta al instante con `TEXTO_EN_ESPERA`.
 *  3. `reintentarEnEspera` corre cada 5 minutos (colgado del chequeo de salud
 *     que ya llama n8n con el secreto). Vuelve a procesar el mensaje con su
 *     historial, y la respuesta llega por el mismo canal: WhatsApp o el chat.
 *  4. Si en una hora no salió, se le dice a la persona que lo vuelva a mandar.
 *
 * Solo texto: una foto o un audio no se guardan (el adjunto puede vencer antes
 * del reintento), y siguen el camino de siempre.
 */

import type { adminSinTipos } from "../supabase/sin-tipos.ts";
import { HISTORIAL_MAXIMO, enOrdenDeTurno, historialDeLaSesion } from "./historial.ts";

export const TABLA = "eos_mensajes_en_espera_v214";

/** Lo que ve la persona apenas escribe. Está en AVISOS_DE_FALLA: no vuelve como historial. */
export const TEXTO_EN_ESPERA =
  "Recibí tu mensaje, pero ahora mismo no lo puedo procesar. No se perdió: lo anoto en cuanto pueda y te aviso por acá.";

/** Cada cuánto se reintenta y cuántas veces, antes de pedirle que lo reenvíe. */
export const MINUTOS_ENTRE_INTENTOS = 5;
export const MAX_INTENTOS = 12;
const POR_TANDA = 10;

/** Un fallo de OpenAI que vale la pena esperar: se va a arreglar solo. */
export function esCaidaDeIA(falla: { motivo: "timeout" | "http" | "red"; status?: number }): boolean {
  if (falla.motivo === "timeout" || falla.motivo === "red") return true;
  const status = falla.status ?? 0;
  // 401/400 no se arreglan esperando: son nuestros, y n8n es el camino.
  return status === 429 || status >= 500;
}

export function puedeEsperar(entrada: { mensaje: string; archivos: ReadonlyArray<unknown>; reintentoDe?: string }): boolean {
  return entrada.mensaje.trim() !== "" && entrada.archivos.length === 0 && !entrada.reintentoDe;
}

/*
 * El cliente de servicio sin tipos (`adminSinTipos`): las tablas de acá no
 * están en los tipos generados. Las pruebas lo imitan sin levantar una base.
 */
export type ClienteEnEspera = ReturnType<typeof adminSinTipos>;

export type FilaEnEspera = {
  id: string;
  usuario_id: string;
  conversacion_id: string | null;
  origen: string;
  mensaje: string;
  app_nativa: boolean;
  estado: string;
  intentos: number;
  created_at: string;
};

export async function ponerEnEspera(
  admin: ClienteEnEspera,
  fila: { usuarioId: string; conversacionId: string; origen: string; mensaje: string; appNativa: boolean; motivo: string },
): Promise<boolean> {
  try {
    const { data, error } = await admin
      .from(TABLA)
      .insert({
        usuario_id: fila.usuarioId,
        conversacion_id: fila.conversacionId || null,
        origen: fila.origen,
        mensaje: fila.mensaje.slice(0, 4000),
        app_nativa: fila.appNativa,
        motivo: fila.motivo.slice(0, 160),
      })
      .select("id")
      .single();
    if (error || !data) {
      console.error("En espera: no se pudo guardar el mensaje:", error?.message ?? "sin fila");
      return false;
    }
    return true;
  } catch (error) {
    console.error("En espera: no se pudo guardar el mensaje:", error);
    return false;
  }
}

/** Lo que devuelve `procesarMensajeEOS`, reducido a lo que importa acá. */
export type Procesado = { status: number; body: Record<string, unknown> };

export type Dependencias = {
  procesar: (usuarioId: string, entrada: {
    mensaje: string;
    conversacionId: string;
    historial: { rol: string; texto: string }[];
    origen: string;
    appNativa: boolean;
    requestId: string;
    reintentoDe: string;
  }) => Promise<Procesado>;
  /** Manda el texto a la persona por su canal. Devuelve si salió. */
  entregar: (fila: FilaEnEspera, texto: string) => Promise<boolean>;
  /** Un UUID estable para (fila, intento): si el reintento se corta y vuelve, el cupo lo reconoce. */
  idDelIntento: (semilla: string) => string;
  ahora?: () => Date;
};

export type ResumenReintentos = { procesados: number; siguen: number; vencidos: number };

/** "de las 14:32", en la hora de Paraguay. */
export function horaDe(iso: string): string {
  return new Intl.DateTimeFormat("es-PY", {
    timeZone: "America/Asuncion",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

function cita(mensaje: string): string {
  const corto = mensaje.replace(/\s+/g, " ").trim();
  return corto.length > 60 ? `${corto.slice(0, 57)}…` : corto;
}

export function textoDeEntrega(fila: Pick<FilaEnEspera, "mensaje" | "created_at">, respuesta: string): string {
  return `Ya pude procesar tu mensaje de las ${horaDe(fila.created_at)} («${cita(fila.mensaje)}»):\n\n${respuesta}`;
}

export function textoDeVencido(fila: Pick<FilaEnEspera, "mensaje" | "created_at">): string {
  return `No pude procesar tu mensaje de las ${horaDe(fila.created_at)} («${cita(fila.mensaje)}»). No quedó anotado: mandámelo de nuevo cuando puedas.`;
}

/**
 * Una tanda de reintentos. Nunca lanza: corre colgada de otra ruta y un error
 * acá no puede tumbarla. Toma cada fila con un `update ... where estado = X`
 * para que dos corridas simultáneas no procesen el mismo mensaje dos veces.
 */
export async function reintentarEnEspera(admin: ClienteEnEspera, deps: Dependencias): Promise<ResumenReintentos> {
  const resumen: ResumenReintentos = { procesados: 0, siguen: 0, vencidos: 0 };
  const ahora = deps.ahora ?? (() => new Date());

  let filas: FilaEnEspera[] = [];
  try {
    const { data, error } = await admin
      .from(TABLA)
      .select("id, usuario_id, conversacion_id, origen, mensaje, app_nativa, estado, intentos, created_at")
      .in("estado", ["esperando", "procesando"])
      .lte("proximo_intento_at", ahora().toISOString())
      .order("created_at", { ascending: true })
      .limit(POR_TANDA);
    if (error) throw new Error(error.message);
    filas = data ?? [];
  } catch (error) {
    console.error("En espera: no se pudieron leer los pendientes:", error);
    return resumen;
  }

  for (const fila of filas) {
    try {
      const resultado = await reintentarUna(admin, deps, fila, ahora);
      resumen[resultado] += 1;
    } catch (error) {
      console.error("En espera: falló el reintento de", fila.id, error);
      resumen.siguen += 1;
    }
  }

  return resumen;
}

async function reintentarUna(
  admin: ClienteEnEspera,
  deps: Dependencias,
  fila: FilaEnEspera,
  ahora: () => Date,
): Promise<keyof ResumenReintentos> {
  const intento = fila.intentos + 1;
  const minutos = (n: number) => new Date(ahora().getTime() + n * 60_000).toISOString();

  // Tomar la fila. Si otra corrida la tomó primero, no hay fila que devolver.
  const tomada = await admin
    .from(TABLA)
    .update({ estado: "procesando", intentos: intento, proximo_intento_at: minutos(10), updated_at: ahora().toISOString() })
    .eq("id", fila.id)
    .eq("estado", fila.estado)
    .select("id");
  if (tomada.error || !tomada.data || tomada.data.length === 0) return "siguen";

  const historial = fila.conversacion_id ? await historialPrevio(admin, fila) : [];

  const resultado = await deps.procesar(fila.usuario_id, {
    mensaje: fila.mensaje,
    conversacionId: fila.conversacion_id ?? "",
    historial,
    origen: fila.origen,
    appNativa: fila.app_nativa,
    requestId: deps.idDelIntento(`en-espera:${fila.id}:${intento}`),
    reintentoDe: fila.id,
  });

  const respuesta = typeof resultado.body.respuesta === "string" ? resultado.body.respuesta : "";
  // El aviso de espera viaja con 200 (un 202 la web lo lee como "en proceso"):
  // no es una respuesta. Un reintento no lo devuelve nunca, pero por las dudas.
  const salio = resultado.status === 200 && respuesta !== "" && resultado.body.code !== "EOS_EN_ESPERA";

  // 409: ese mismo intento ya se había procesado (una corrida anterior se
  // cortó después de procesar): no se vuelve a mandar nada.
  if (salio || resultado.status === 409) {
    if (salio) await deps.entregar(fila, textoDeEntrega(fila, respuesta));
    await cerrar(admin, fila.id, "procesado", ahora);
    return "procesados";
  }

  if (intento >= MAX_INTENTOS) {
    await deps.entregar(fila, textoDeVencido(fila));
    await cerrar(admin, fila.id, "vencido", ahora);
    return "vencidos";
  }

  await admin
    .from(TABLA)
    .update({
      estado: "esperando",
      motivo: String(resultado.body.code ?? `status_${resultado.status}`).slice(0, 160),
      proximo_intento_at: minutos(MINUTOS_ENTRE_INTENTOS),
      updated_at: ahora().toISOString(),
    })
    .eq("id", fila.id)
    .eq("estado", "procesando");
  return "siguen";
}

async function cerrar(admin: ClienteEnEspera, id: string, estado: "procesado" | "vencido", ahora: () => Date) {
  const cuando = ahora().toISOString();
  await admin
    .from(TABLA)
    .update({ estado, procesado_at: cuando, updated_at: cuando })
    .eq("id", id)
    .eq("estado", "procesando");
}

/**
 * La conversación ANTES del mensaje en espera. Lo que vino después (el mismo
 * mensaje guardado por la web o por WhatsApp, y el aviso de espera) no es
 * contexto: el modelo lo leería como si ya lo hubiera contestado.
 */
async function historialPrevio(admin: ClienteEnEspera, fila: FilaEnEspera): Promise<{ rol: string; texto: string }[]> {
  try {
    const { data } = await admin
      .from("mensajes")
      .select("rol, texto, created_at")
      .eq("conversacion_id", fila.conversacion_id as string)
      .eq("usuario_id", fila.usuario_id)
      // mensajes.created_at es timestamp sin zona, en UTC.
      .lt("created_at", new Date(fila.created_at).toISOString().replace("Z", ""))
      .order("created_at", { ascending: false })
      .limit(HISTORIAL_MAXIMO);
    // La sesión se mide desde el mensaje en espera, no desde el reintento.
    const filas = enOrdenDeTurno((data ?? []) as Array<{ rol: string; texto: string; created_at: string }>);
    return historialDeLaSesion(filas, new Date(fila.created_at).getTime()).map(({ rol, texto }) => ({ rol, texto }));
  } catch {
    return [];
  }
}
