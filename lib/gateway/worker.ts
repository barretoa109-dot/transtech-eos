/**
 * Etapa 2: llamar al Background Worker.
 *
 * Puerto del nodo `07 GW Ejecutar Worker Gobernado`. El Worker en sí NO se
 * mueve —eso es la etapa 3— así que esto sigue pegándole a los webhooks de
 * n8n; lo único que cambia es quién los llama.
 *
 * ============================================================
 * DESDE ACÁ NO SE PUEDE VOLVER A n8n
 * ============================================================
 *
 * Esta es la diferencia grande con la etapa 1, y hay que decirla entera.
 *
 * En la etapa 1, cualquier problema se resolvía dejando que respondiera n8n:
 * la conversación pura no deja rastro, así que rehacerla no cuesta nada. Acá
 * no: apenas se manda el primer job, puede haber una venta cargada. Si a mitad
 * de camino se delegara en n8n, n8n llamaría de nuevo a OpenAI y volvería a
 * mandar los mismos jobs.
 *
 * El Worker Gate sabe reconocer un comando repetido por su huella y no lo
 * ejecuta dos veces —para eso existe `normalizarDatos` en `jobs.ts`— pero eso
 * es una red, no un permiso. La regla es más simple y no depende de que la red
 * funcione:
 *
 *   **Una vez que se mandó el primer job, este camino termina el trabajo y
 *   reporta lo que pasó. No delega.**
 *
 * Un job que falla se informa como error en la respuesta, que es lo mismo que
 * hace n8n hoy. La persona ve "no pude completar automáticamente: X" y sabe
 * que tiene que mirar. Es peor prometer que se reintentó.
 *
 * ============================================================
 * LOS JOBS VAN DE A UNO Y EN ORDEN
 * ============================================================
 *
 * n8n los manda en serie y acá también. En paralelo sería más rápido, pero dos
 * jobs del mismo mensaje pueden tocar lo mismo —vender un producto y ajustar
 * su stock— y el orden en que el modelo los pidió es el orden en que la
 * persona los dijo.
 */

import type { Job } from "./jobs.ts";
import type { ResultadoWorker } from "./resultados.ts";

/** El mismo que usa n8n en el nodo 07. */
export const TIMEOUT_WORKER_MS = 120_000;

export type Config = { base: string; secreto: string };

/**
 * Las dos variables que hacen falta en Vercel para la etapa 2.
 *
 * Devuelve `null` cuando falta alguna, y quien llama tiene que leerlo como
 * "esto todavía no está configurado: que lo haga n8n". Es la única
 * comprobación que se puede hacer ANTES de mandar nada.
 */
export function configDelWorker(): Config | null {
  const base = (process.env.EOS_N8N_BASE_URL ?? "").trim().replace(/\/$/, "");
  const secreto = (process.env.EOS_WORKER_GATE_SECRET ?? "").trim();
  if (!base || !secreto) return null;
  return { base, secreto };
}

/** Un job, un resultado. Los errores se devuelven, no se lanzan. */
export async function ejecutarJob(job: Job, config: Config): Promise<ResultadoWorker> {
  const controlador = new AbortController();
  const reloj = setTimeout(() => controlador.abort(), TIMEOUT_WORKER_MS);

  try {
    const respuesta = await fetch(`${config.base}/webhook/${job.worker_path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.secreto}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(job),
      signal: controlador.signal,
      cache: "no-store",
    });

    if (!respuesta.ok) {
      /*
       * El cuerpo NO se registra: puede traer de vuelta el mensaje de la
       * persona, y el log de Vercel no se borra cuando alguien pide que se
       * borren sus datos. Misma regla que el resto de la ruta.
       */
      console.error("Gateway TS: el worker respondió", respuesta.status, "para", job.accion.tipo);
      return {
        ok: false,
        accion: job.accion.tipo,
        error: `El worker respondió ${respuesta.status}.`,
      };
    }

    const cuerpo: unknown = await respuesta.json().catch(() => null);

    if (cuerpo === null) {
      // Un 200 con un cuerpo ilegible es el peor caso: el efecto puede haber
      // ocurrido. Se reporta como error para que la persona lo revise, y NO
      // se reintenta.
      return {
        ok: false,
        accion: job.accion.tipo,
        error: "El worker respondió algo que no se pudo leer.",
      };
    }

    // n8n a veces devuelve el resultado envuelto en una lista de un elemento.
    const plano = Array.isArray(cuerpo) ? cuerpo[0] : cuerpo;
    return plano && typeof plano === "object" ? (plano as ResultadoWorker) : { ok: true };
  } catch (error) {
    const corto = error instanceof Error && error.name === "AbortError";
    console.error("Gateway TS: no se pudo llamar al worker:", corto ? "timeout" : "error de red");
    return {
      ok: false,
      accion: job.accion.tipo,
      error: corto ? "El worker tardó demasiado." : "No se pudo contactar al worker.",
    };
  } finally {
    clearTimeout(reloj);
  }
}

/**
 * Todos los jobs, en orden, hasta terminar.
 *
 * No corta ante el primer error: si la persona pidió dos cosas y la primera
 * falla, la segunda igual se intenta. Cortar dejaría la mitad hecha sin decir
 * cuál mitad.
 */
export async function ejecutarJobs(jobs: Job[], config: Config): Promise<ResultadoWorker[]> {
  const resultados: ResultadoWorker[] = [];
  for (const job of jobs) {
    resultados.push(await ejecutarJob(job, config));
  }
  return resultados;
}
