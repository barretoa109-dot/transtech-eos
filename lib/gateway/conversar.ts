/**
 * Etapa 1 de la salida de n8n: la conversación pura, con red.
 *
 * ============================================================
 * QUÉ SE MUEVE Y QUÉ NO
 * ============================================================
 *
 * Se mueve el camino `01 → 03 → OpenAI → 05 → 06.5 → 06.6`: unos 11 KB de
 * JavaScript determinístico que hoy corren en Railway. **No** se mueve el nodo
 * 06 (`Preparar Jobs Worker`, 11,2 KB), que es el que decide y arma las
 * acciones. Por eso, cuando el modelo pide una acción, esto se aparta y
 * responde n8n como siempre.
 *
 * ============================================================
 * POR QUÉ ES SEGURO
 * ============================================================
 *
 * La rama de conversación pura NO tiene ningún efecto durable: el job
 * `RESPONDER` que fabricaba el gateway solo pegaba un ping y devolvía
 * `executed:false`. Si esto falla, se cae a n8n y no se perdió nada. Todos los
 * caminos de error de acá devuelven `null`, que quien llama tiene que leer
 * como "usá n8n".
 *
 * ============================================================
 * EL COSTO QUE ESTO TIENE, DICHO
 * ============================================================
 *
 * Cuando el modelo pide una acción, la llamada a OpenAI que hicimos acá se
 * tira y n8n vuelve a llamar. Ese mensaje sale el doble.
 *
 * Se acepta a sabiendas: es la minoría del tráfico, y la alternativa —portar
 * también el nodo 06 en el mismo paso— convertiría una etapa reversible en un
 * cambio grande sobre el camino crítico del producto. Cuando la etapa 2 mueva
 * el nodo 06, el doble cobro desaparece.
 *
 * Mientras tanto conviene medirlo: `metadata.gateway` dice qué camino atendió
 * cada mensaje, y los tokens ya viajan en la respuesta.
 */

import { EntradaInvalida, prepararEntrada } from "./entrada.ts";
import { armarPrompt } from "./prompt.ts";
import { prepararRespuesta, type RespuestaGateway } from "./respuesta.ts";
import { AccionNoPermitida, armarJobs } from "./jobs.ts";
import { juntarResultados, type Final } from "./resultados.ts";
import { configDelWorker, ejecutarJobs } from "./worker.ts";
import { MODELO, PROMPT_SISTEMA } from "./sistema.ts";

const OPENAI_URL = "https://api.openai.com/v1/responses";

/** Más corto que el de n8n (90 s): si tarda tanto, mejor que conteste n8n. */
export const TIMEOUT_MS = 60_000;

/** La bandera de la etapa 1. Sin ella, este archivo no se usa para nada. */
export function gatewayEnTypeScript(): boolean {
  return process.env.EOS_GATEWAY_TS === "1" && Boolean(process.env.OPENAI_API_KEY);
}

/**
 * La bandera de la etapa 2, aparte de la 1 a propósito.
 *
 * La etapa 1 no deja rastro: prenderla y apagarla no cuesta nada. La etapa 2
 * ejecuta acciones con efecto durable. Que sean dos banderas permite tener la
 * conversación pura andando en Vercel durante semanas —que es lo que el
 * documento recomienda— sin haber movido todavía nada que escriba.
 *
 * Necesita además `EOS_N8N_BASE_URL` y `EOS_WORKER_GATE_SECRET`, porque el
 * Worker sigue viviendo en n8n hasta la etapa 3.
 */
export function accionesEnTypeScript(): boolean {
  return (
    gatewayEnTypeScript() &&
    process.env.EOS_GATEWAY_TS_ACCIONES === "1" &&
    configDelWorker() !== null
  );
}

export type Resultado =
  | { estado: "respondido"; cuerpo: RespuestaGateway }
  /** Terminó también las acciones: el cuerpo ya trae lo que hizo el worker. */
  | { estado: "completado"; cuerpo: Final }
  /** Hay acciones y la etapa 2 está apagada: las arma n8n. */
  | { estado: "delegar"; motivo: string };

/**
 * Atiende un mensaje de punta a punta cuando no hay acciones de por medio.
 *
 * Devuelve `null` ante cualquier problema —falta la clave, OpenAI falló, el
 * cuerpo vino raro— para que quien llama use n8n. Nunca lanza: una excepción
 * acá dejaría a la persona sin respuesta cuando existe un camino que funciona.
 */
export async function conversar(payload: Record<string, unknown>): Promise<Resultado | null> {
  const clave = process.env.OPENAI_API_KEY;
  if (!clave) return null;

  let entrada;
  try {
    entrada = prepararEntrada(payload);
  } catch (error) {
    // Una entrada inválida no la arregla n8n —va a fallar igual— pero
    // delegarla conserva exactamente el comportamiento de hoy, que es lo único
    // que esta etapa se compromete a no cambiar.
    console.error(
      "Gateway TS: entrada inválida:",
      error instanceof EntradaInvalida ? error.message : "error desconocido",
    );
    return null;
  }

  const { contenido } = armarPrompt(entrada);

  const controlador = new AbortController();
  const reloj = setTimeout(() => controlador.abort(), TIMEOUT_MS);

  let ai: unknown;
  try {
    const respuesta = await fetch(OPENAI_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${clave}`,
      },
      body: JSON.stringify({
        model: MODELO,
        input: [
          { role: "system", content: [{ type: "input_text", text: PROMPT_SISTEMA }] },
          { role: "user", content: contenido },
        ],
      }),
      signal: controlador.signal,
      cache: "no-store",
    });

    if (!respuesta.ok) {
      /*
       * El cuerpo NO se registra: puede traer de vuelta el mensaje que
       * escribió la persona, y el log de Vercel queda guardado, lo ve
       * cualquiera con acceso al panel y no se borra cuando el usuario pide
       * que lo borren. Misma regla que la ruta usa con n8n.
       */
      console.error("Gateway TS: OpenAI respondió", respuesta.status);
      return null;
    }

    ai = await respuesta.json();
  } catch (error) {
    console.error(
      "Gateway TS: no se pudo llamar a OpenAI:",
      error instanceof Error && error.name === "AbortError" ? "timeout" : "error de red",
    );
    return null;
  } finally {
    clearTimeout(reloj);
  }

  const cuerpo = prepararRespuesta(entrada, ai);

  if (!cuerpo.requiere_worker) {
    return { estado: "respondido", cuerpo };
  }

  // ------------------------------------------------------------------
  // Etapa 2: las acciones
  // ------------------------------------------------------------------

  const config = configDelWorker();
  if (!accionesEnTypeScript() || config === null) {
    return { estado: "delegar", motivo: cuerpo.accion };
  }

  let jobs;
  try {
    jobs = armarJobs(entrada, cuerpo);
  } catch (error) {
    // Todavía no se mandó nada: delegar es seguro y es lo correcto. Pasa si
    // alguien agregó una acción a la lista blanca y se olvidó de su ruta.
    console.error(
      "Gateway TS: no se pudieron armar los jobs:",
      error instanceof AccionNoPermitida ? error.message : "error desconocido",
    );
    return { estado: "delegar", motivo: cuerpo.accion };
  }

  /*
   * DESDE ACÁ NO SE VUELVE.
   *
   * Apenas sale el primer job puede haber una venta cargada. Delegar a mitad
   * de camino haría que n8n vuelva a llamar a OpenAI y remande los mismos
   * jobs; el Worker Gate sabe reconocerlos por su huella, pero eso es una red
   * y no un permiso. Lo que falle se informa como error en la respuesta, que
   * es lo mismo que hace n8n hoy.
   */
  const resultados = await ejecutarJobs(jobs, config);

  const final = juntarResultados(
    {
      request_id: entrada.request_id,
      conversacion_id: entrada.conversacion_id,
      respuesta: cuerpo.respuesta,
      documento: cuerpo.documento,
      acciones: cuerpo.acciones,
      accion: cuerpo.accion,
      metadata: cuerpo.metadata,
      tokens_entrada: cuerpo.tokens_entrada,
      tokens_salida: cuerpo.tokens_salida,
    },
    resultados,
  );

  return { estado: "completado", cuerpo: final };
}
