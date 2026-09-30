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

import { ejecutarEnProceso } from "./ejecutar.ts";
import type { Job } from "./jobs.ts";
import { adminSinTipos } from "../supabase/sin-tipos.ts";
import type { ResultadoWorker } from "./resultados.ts";

/** El mismo que usa n8n en el nodo 07. */
export const TIMEOUT_WORKER_MS = 120_000;

export type Config = { base: string; secreto: string };

/**
 * La bandera de la etapa 3: ejecutar el Worker adentro de Vercel.
 *
 * Es la tercera y la más delicada, y por eso tiene su propio interruptor.
 * `docs/salida-de-n8n.md` pide no prenderla hasta que las etapas 1 y 2 lleven
 * SEMANAS estables: esta es la que ejecuta acciones ya aprobadas, y si algo se
 * rompe acá se rompe DESPUÉS de que la persona autorizó, que es el peor
 * momento posible para fallar.
 *
 * Con la etapa 3 apagada, `EOS_N8N_BASE_URL` sigue haciendo falta. Con la
 * etapa 3 prendida deja de hacer falta: ya no se sale a la red.
 */
export function workerEnProceso(): boolean {
  return process.env.EOS_GATEWAY_TS_WORKER === "1";
}

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
export async function ejecutarJob(job: Job, config: Config | null): Promise<ResultadoWorker> {
  /*
   * Etapa 3. Adentro del proceso no hay red que cruzar, así que tampoco hay
   * timeout ni reintento que administrar: `ejecutarEnProceso` devuelve un
   * resultado pase lo que pase, con la misma forma que devolvería n8n.
   */
  if (workerEnProceso()) {
    try {
      return await ejecutarEnProceso(job);
    } catch (error) {
      // Una excepción acá NO se traduce en delegar: el efecto pudo haber
      // ocurrido. Se reporta, igual que un fallo del worker remoto.
      console.error("Gateway TS: el worker en proceso lanzó:", error);
      return {
        ok: false,
        accion: job.accion.tipo,
        request_id: job.request_id,
        error: "No se pudo completar la acción.",
      };
    }
  }

  if (config === null) {
    // No debería llegar acá: quien llama comprueba la configuración antes de
    // armar nada. El guard existe porque el costo de equivocarse es mandar un
    // job a una URL vacía.
    return {
      ok: false,
      accion: job.accion.tipo,
      request_id: job.request_id,
      error: "El worker no está configurado.",
    };
  }

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

/** Las que reemplazan una anulación: si la anulación falla, no van solas. */
const REEMPLAZO: Record<string, string> = {
  ANULAR_VENTA: "REGISTRAR_VENTA",
  ANULAR_COMPRA: "REGISTRAR_COMPRA",
};

export const REEMPLAZO_SIN_ANULAR =
  "No registré la nueva porque no pude anular la anterior: habría quedado repetida. " +
  "Decime el monto o el día de la que hay que anular y la reemplazo.";

function fallo(r: ResultadoWorker): boolean {
  return Boolean(r && (r.ok === false || r.error || r.estado === "error"));
}

/**
 * Las que dejan plata o mercadería anotada: repetirlas por error duplica.
 * Quedan afuera las que son idempotentes por naturaleza (poner un costo,
 * ajustar el stock a un número, agendar a alguien que ya existe).
 */
export const DUPLICABLES = new Set([
  "REGISTRAR_VENTA",
  "REGISTRAR_COMPRA",
  "REGISTRAR_COMPRA_TARJETA",
  "REGISTRAR_MOVIMIENTO_PERSONAL",
  "REGISTRAR_COBRO",
  "REGISTRAR_PAGO_COMPRA",
  "REGISTRAR_PAGO_DEUDA",
  "REGISTRAR_TRANSFERENCIA",
]);

/** Cuánto hacia atrás se mira para reconocer que algo ya se anotó. */
export const VENTANA_REPETIDO_MS = 10 * 60_000;

function canonico(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonico);
  if (typeof v === "string") return v.trim().toLowerCase();
  if (!v || typeof v !== "object") return v;
  return Object.keys(v as Record<string, unknown>)
    .filter((k) => k !== "repetir")
    .sort()
    .reduce<Record<string, unknown>>((acc, k) => {
      acc[k] = canonico((v as Record<string, unknown>)[k]);
      return acc;
    }, {});
}

/**
 * Qué hace que dos acciones sean "la misma". Casi siempre, los datos enteros.
 * La compra con tarjeta, sin el nombre de la tarjeta: el modelo la nombra
 * "Green" en un mensaje y "Green ****7450" en el siguiente, y es la misma.
 */
export function claveDeRepeticion(tipo: string, datos: Record<string, unknown>): string {
  if (tipo === "REGISTRAR_COMPRA_TARJETA") {
    const { tarjeta: _t, ...resto } = datos;
    void _t;
    return JSON.stringify(canonico(resto));
  }
  return JSON.stringify(canonico(datos));
}

export type Anotada = { request_id: string; created_at: string; datos: Record<string, unknown> };

/** Las órdenes completadas hace poco de esta acción, o [] si no se pudieron leer. */
async function anotadasRecientes(usuarioId: string, accion: string, desde: string): Promise<Anotada[]> {
  try {
    const { data, error } = await adminSinTipos()
      .from("eos_action_commands")
      .select("request_id, created_at, payload")
      .eq("usuario_id", usuarioId)
      .eq("accion", accion)
      .eq("estado", "completada")
      .gte("created_at", desde)
      .order("created_at", { ascending: false })
      .limit(20);
    if (error) return [];
    return ((data ?? []) as Array<{ request_id: string; created_at: string; payload?: { datos?: unknown } }>).map((f) => ({
      request_id: f.request_id,
      created_at: f.created_at,
      datos: (f.payload?.datos && typeof f.payload.datos === "object" ? f.payload.datos : {}) as Record<string, unknown>,
    }));
  } catch {
    return [];
  }
}

export function avisoDeRepetido(minutos: number): string {
  const hace = minutos < 1 ? "recién" : minutos === 1 ? "hace un minuto" : `hace ${minutos} minutos`;
  return (
    `Eso ya lo anoté ${hace}, así que no lo cargué de nuevo: habría quedado repetido. ` +
    'Si es otra igual, decime "es otra" y la cargo.'
  );
}

/**
 * Todos los jobs, en orden, hasta terminar.
 *
 * No corta ante el primer error: si la persona pidió dos cosas y la primera
 * falla, la segunda igual se intenta. Cortar dejaría la mitad hecha sin decir
 * cuál mitad.
 *
 * Con dos excepciones, del 29/09/2026:
 *
 *   · Lo mismo anotado otra vez. La persona dijo "no está" (la pantalla de
 *     Tarjetas no se mostraba) y EOS volvió a mandar la misma compra con
 *     tarjeta: cinco veces en diez minutos. Una acción que deja plata anotada
 *     y que es IGUAL a una completada en los últimos diez minutos, desde otro
 *     mensaje, no se repite: se avisa. `repetir: true` en los datos la fuerza
 *     ("es otra igual").
 *
 *   · Una anulación que falla seguida de la venta que la reemplazaba. EOS
 *     intentó corregir una venta anulándola y registrándola de nuevo; la
 *     anulación no encontró la venta y la nueva se registró igual: quedó
 *     duplicada, con el stock en −2. Sin anulación, el reemplazo no va.
 */
export async function ejecutarJobs(
  jobs: Job[],
  config: Config | null,
  ejecutar: (job: Job, config: Config | null) => Promise<ResultadoWorker> = ejecutarJob,
  {
    anotadas = anotadasRecientes,
    ahora = () => Date.now(),
  }: {
    anotadas?: (usuarioId: string, accion: string, desde: string) => Promise<Anotada[]>;
    ahora?: () => number;
  } = {},
): Promise<ResultadoWorker[]> {
  const resultados: ResultadoWorker[] = [];
  const anulacionesFallidas = new Set<string>();

  for (const job of jobs) {
    const tipo = job.accion.tipo;

    if (anulacionesFallidas.has(tipo)) {
      resultados.push({ ok: false, accion: tipo, codigo: "EOS_ACCION_REEMPLAZO_SIN_ANULAR", respuesta: REEMPLAZO_SIN_ANULAR });
      continue;
    }

    const datos = (job.accion.datos ?? {}) as Record<string, unknown>;
    if (DUPLICABLES.has(tipo) && datos.repetir !== true) {
      const clave = claveDeRepeticion(tipo, datos);
      const desde = new Date(ahora() - VENTANA_REPETIDO_MS).toISOString();
      const previa = (await anotadas(job.usuario_id, tipo, desde)).find(
        (a) => a.request_id !== job.request_id && claveDeRepeticion(tipo, a.datos) === clave,
      );
      if (previa) {
        const minutos = Math.max(0, Math.round((ahora() - new Date(previa.created_at).getTime()) / 60_000));
        // No es un error: ya está anotado. Cuenta como repetida, no como hecha de nuevo.
        resultados.push({ ok: true, executed: false, idempotent: true, accion: tipo, respuesta: avisoDeRepetido(minutos) });
        continue;
      }
    }

    const resultado = await ejecutar(job, config);

    if (REEMPLAZO[tipo] && fallo(resultado)) anulacionesFallidas.add(REEMPLAZO[tipo]);

    resultados.push(resultado);
  }

  return resultados;
}
