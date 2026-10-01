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

import { esCaidaDeIA } from "../eos/en-espera.ts";
import { EntradaInvalida, prepararEntrada } from "./entrada.ts";
import { armarPrompt, type Prompt } from "./prompt.ts";
import { SIN_INTERPRETAR, SIN_RESPUESTA, prepararRespuesta, type RespuestaGateway } from "./respuesta.ts";
import { AccionNoPermitida, armarJobs } from "./jobs.ts";
import { juntarResultados, type Final } from "./resultados.ts";
import { configDelWorker, ejecutarJobs, workerEnProceso } from "./worker.ts";
import { pidioBusqueda, resolverBusqueda, type DepsBusqueda } from "./con-busqueda.ts";
import { ESFUERZO, MODELO, MODELO_PRINCIPAL, PROMPT_SISTEMA } from "./sistema.ts";

/**
 * Los modelos a los que se les manda `ESFUERZO`: los dos que se midieron con
 * él (batería del 30/09/2026, esfuerzo low). Un modelo puesto a mano por
 * `EOS_MODELO_PRINCIPAL` o `EOS_MODELO_SIMPLE` puede no aceptar el valor.
 */
const CON_ESFUERZO = new Set([MODELO, MODELO_PRINCIPAL]);

const OPENAI_URL = "https://api.openai.com/v1/responses";

/**
 * Cuánto se espera a OpenAI antes de delegar en n8n.
 *
 * Era 60 s. Con esa espera, un turno que terminaba delegando sumaba los 60 s
 * más lo que tarda n8n, y el celular corta la conexión mucho antes: el
 * 24/09/2026 el chat mostró "no pude conectarme" en medio de una
 * conversación. Con la etapa 1 sola, lo que parece una acción ni llega acá
 * (`atiendeTypeScript`) y la conversación pura contesta en 2-4 s medidos. Con
 * la etapa 2, los turnos de negocio sí llegan: el modelo tardó 6,8 s de
 * mediana y 11,2 s en la respuesta más larga medida (docs/latencia-del-chat.md).
 * 20 s sigue sobrando, y si se pasa, n8n todavía tiene tiempo.
 */
export const TIMEOUT_MS = 20_000;

/** La bandera de la etapa 1. Sin ella, este archivo no se usa para nada. */
export function gatewayEnTypeScript(): boolean {
  return process.env.EOS_GATEWAY_TS === "1" && Boolean(process.env.OPENAI_API_KEY);
}

/**
 * Los mensajes con adjunto, aparte y APAGADOS por defecto.
 *
 * El 22 de septiembre de 2026 una foto de WhatsApp tuvo a la etapa 1 colgada
 * los 60 s enteros de `TIMEOUT_MS` contra OpenAI antes de delegar en n8n
 * (docs/admision-reserva-race-2026-09-22.md): la imagen de WhatsApp viaja a
 * resolución completa (`lib/whatsapp/media.ts` no la achica) y la persona
 * esperó un minuto para después recibir la respuesta de n8n igual.
 *
 * La etapa 1 existe para la conversación PURA, que es donde se mide la
 * latencia ganada. Con un adjunto, n8n es el camino que ya funcionaba: ir
 * directo ahí no le quita nada a nadie. Se prende con
 * `EOS_GATEWAY_TS_IMAGENES=1` el día que la imagen llegue achicada y se mida.
 */
export function adjuntosEnTypeScript(): boolean {
  return process.env.EOS_GATEWAY_TS_IMAGENES === "1";
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
  if (!gatewayEnTypeScript() || process.env.EOS_GATEWAY_TS_ACCIONES !== "1") return false;

  /*
   * Con la etapa 3 prendida no se sale a la red, así que `EOS_N8N_BASE_URL`
   * deja de hacer falta. Lo que NO deja de hacer falta es el secreto: sin él
   * no se puede autorizar, y sin autorizar no se ejecuta nada.
   */
  if (workerEnProceso()) return Boolean((process.env.EOS_WORKER_GATE_SECRET ?? "").trim());

  return configDelWorker() !== null;
}

/**
 * ¿Este turno lo atiende el gateway en TypeScript, o va directo a n8n?
 *
 * Un turno que parece acción (`pareceAccion`: números, plata, negocio,
 * adjuntos) no pasa por la etapa 1 sola: iba a terminar en n8n igual, después
 * de una llamada a OpenAI que se tiraba, y el 24/09/2026 esa espera doble cortó
 * el chat en el celular.
 *
 * Con la etapa 2 prendida esa doble llamada no existe —el gateway arma y manda
 * las acciones él mismo—, así que el turno entra. Antes se lo salteaba igual,
 * y la etapa 2 quedaba sin nada que atender aunque sus variables estuvieran
 * cargadas: las ventas, compras y stock son justo los turnos que parecen acción.
 */
export function atiendeTypeScript(turnoDeAccion: boolean): boolean {
  if (!gatewayEnTypeScript()) return false;
  return !turnoDeAccion || accionesEnTypeScript();
}

/**
 * Qué etapa del gateway en TypeScript está atendiendo de verdad: 0 (todo en
 * n8n), 1 (conversación pura), 2 (también las acciones) o 3 (también el
 * worker). No la bandera que alguien cargó, sino lo que queda con todas las
 * variables que cada etapa necesita.
 *
 * Existe porque ninguna sesión de trabajo ve el entorno de Vercel: el 26/09
 * los documentos daban la etapa 1 por apagada cuando estaba prendida, y la
 * etapa 2 tenía sus variables cargadas sin atender una sola venta. Lo publica
 * `/api/version` y lo muestra `npm run go`.
 */
export function etapaDelGateway(): 0 | 1 | 2 | 3 {
  if (!gatewayEnTypeScript()) return 0;
  if (!accionesEnTypeScript()) return 1;
  return workerEnProceso() ? 3 : 2;
}

export type Resultado =
  | { estado: "respondido"; cuerpo: RespuestaGateway }
  /** Terminó también las acciones: el cuerpo ya trae lo que hizo el worker. */
  | { estado: "completado"; cuerpo: Final }
  /** Hay acciones y la etapa 2 está apagada: las arma n8n. */
  | { estado: "delegar"; motivo: string };

type Llamada = { ok: true; ai: unknown } | { ok: false; motivo: "timeout" | "http" | "red"; status?: number };

/** Una llamada a la Responses API. Nunca lanza. */
async function preguntarAlModelo(clave: string, modelo: string, contenido: Prompt["contenido"]): Promise<Llamada> {
  const controlador = new AbortController();
  const reloj = setTimeout(() => controlador.abort(), TIMEOUT_MS);

  try {
    const respuesta = await fetch(OPENAI_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${clave}`,
      },
      body: JSON.stringify({
        model: modelo,
        // Solo a los medidos con ese esfuerzo: ver `CON_ESFUERZO`.
        ...(CON_ESFUERZO.has(modelo) ? { reasoning: { effort: ESFUERZO } } : {}),
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
      if (modelo === MODELO) console.error("Gateway TS: OpenAI respondió", respuesta.status);
      else console.error("Gateway TS: el modelo simple respondió", respuesta.status);
      return { ok: false, motivo: "http", status: respuesta.status };
    }

    return { ok: true, ai: await respuesta.json() };
  } catch (error) {
    const timeout = error instanceof Error && error.name === "AbortError";
    console.error("Gateway TS: no se pudo llamar a OpenAI:", timeout ? "timeout" : "error de red");
    return { ok: false, motivo: timeout ? "timeout" : "red" };
  } finally {
    clearTimeout(reloj);
  }
}

/**
 * ¿Lo que contestó el modelo barato se le puede mandar a la persona?
 *
 * Solo una respuesta de conversación, sin acciones ni documento, y que no sea
 * uno de los textos de relleno de `prepararRespuesta`. Una acción la decide
 * siempre el modelo completo: si el barato pidió una, la regla se equivocó y
 * el turno se vuelve a preguntar entero (`simple_con_accion` en el log).
 */
export function sirveRespuestaSimple(cuerpo: RespuestaGateway): boolean {
  if (cuerpo.requiere_worker || cuerpo.documento !== null) return false;
  return cuerpo.respuesta !== SIN_INTERPRETAR && cuerpo.respuesta !== SIN_RESPUESTA;
}

/** Qué pasó con el modelo barato en este turno; va a la metadata y al log. */
export type Enrutado =
  | "simple"
  | "volvio_por_accion"
  | "volvio_por_error"
  /** Lo contestó el principal (gpt-6-sol). */
  | "principal"
  /** El principal falló o contestó algo ilegible; lo contestó el completo. */
  | "principal_volvio";

/**
 * Atiende un mensaje de punta a punta cuando no hay acciones de por medio.
 *
 * Devuelve `null` ante cualquier problema —falta la clave, OpenAI falló, el
 * cuerpo vino raro— para que quien llama use n8n. Nunca lanza: una excepción
 * acá dejaría a la persona sin respuesta cuando existe un camino que funciona.
 *
 * Con `modelo`, el turno se le pregunta primero a ese modelo (el barato del
 * paso 4 del enrutamiento, `lib/eos/enrutamiento-modelo.ts`). Si falla o su
 * respuesta no sirve (`sirveRespuestaSimple`), se vuelve a preguntar al de
 * siempre ANTES de hacer nada: con el barato no sale ninguna acción.
 *
 * Con `alFallarIA`, avisa cuando el `null` es porque OpenAI no responde
 * (timeout, red, 429 o 5xx del modelo principal). n8n llama al mismo OpenAI,
 * así que esperar 90 s más ahí no arregla nada: quien llama puede dejar el
 * mensaje en espera (`lib/eos/en-espera.ts`). Pasa siempre antes de ejecutar
 * ninguna acción, porque el modelo es lo primero que se llama.
 */
export async function conversar(
  payload: Record<string, unknown>,
  opciones: {
    modelo?: string | null;
    /**
     * El modelo para un turno completo, elegido por `elegirModelo`
     * (lib/eos/enrutamiento-modelo.ts). Sin él, o igual a `MODELO`, el de
     * siempre. Si falla o contesta algo ilegible, se le pregunta a `MODELO`
     * antes de ejecutar nada.
     */
    principal?: string | null;
    alFallarIA?: (motivo: string) => void;
    /** Búsqueda web (lib/busqueda/servicio.ts). Sin ella, BUSCAR_WEB se contesta con "no pude buscar". */
    buscar?: DepsBusqueda["buscar"];
    /** Se llama justo antes de buscar (la web muestra el estado, WhatsApp manda un aviso). */
    alBuscar?: () => void;
  } = {},
): Promise<Resultado | null> {
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

  if (entrada.tiene_archivo && !adjuntosEnTypeScript()) {
    // Antes de llamar a nadie: sin costo y sin demora. Ver `adjuntosEnTypeScript`.
    return { estado: "delegar", motivo: "adjunto" };
  }

  const { contenido } = armarPrompt(entrada);

  // Cuánto se esperó al modelo y cuánto a las acciones: van a la metadata y de
  // ahí a `turno` en eos_message_usage_v40 (encargado-02 del tablero).
  const antesDelModelo = Date.now();

  const pedido = opciones.modelo?.trim() ?? "";
  const barato = pedido && pedido !== MODELO ? pedido : null;
  let cuerpo: RespuestaGateway | null = null;
  let modelo = MODELO;
  let enrutado: Enrutado | null = null;

  if (barato) {
    const intento = await preguntarAlModelo(clave, barato, contenido);

    // Un timeout ya gastó los 20 s: preguntar otra vez dejaría a la persona
    // esperando el doble. n8n, como cualquier otro timeout de acá.
    if (!intento.ok && intento.motivo === "timeout") return null;

    const propuesta = intento.ok ? prepararRespuesta(entrada, intento.ai) : null;
    if (propuesta && sirveRespuestaSimple(propuesta)) {
      cuerpo = propuesta;
      modelo = barato;
      enrutado = "simple";
    } else {
      // Un nombre de modelo mal escrito cae acá en cada turno simple: cuesta
      // una llamada fallida y rápida, y la persona no se entera.
      enrutado = propuesta ? "volvio_por_accion" : "volvio_por_error";
      console.info("Gateway TS: el modelo simple no alcanzó, vuelve al de siempre:", enrutado);
    }
  }

  /*
   * El principal (gpt-6-sol) para los turnos que no son complejos.
   *
   * Si contesta algo que no se puede leer, el turno se vuelve a preguntar al
   * completo ANTES de armar ninguna acción: un JSON roto no se ejecuta a
   * medias. Un timeout no se reintenta (ya pasaron los 20 s): va a n8n, que
   * usa el completo, como cualquier otro timeout de acá.
   */
  const principal = opciones.principal?.trim() || MODELO;
  if (!cuerpo && principal !== MODELO) {
    const intento = await preguntarAlModelo(clave, principal, contenido);
    if (!intento.ok && intento.motivo === "timeout") return null;

    const propuesta = intento.ok ? prepararRespuesta(entrada, intento.ai) : null;
    if (propuesta && propuesta.respuesta !== SIN_INTERPRETAR && propuesta.respuesta !== SIN_RESPUESTA) {
      cuerpo = propuesta;
      modelo = principal;
      enrutado = enrutado ?? "principal";
    } else {
      enrutado = "principal_volvio";
      console.info("Gateway TS: el modelo principal no contestó algo legible, vuelve al completo.");
    }
  }

  if (!cuerpo) {
    const llamada = await preguntarAlModelo(clave, MODELO, contenido);
    if (!llamada.ok) {
      if (esCaidaDeIA(llamada)) {
        opciones.alFallarIA?.(llamada.status ? `${llamada.motivo}_${llamada.status}` : llamada.motivo);
      }
      return null;
    }
    cuerpo = prepararRespuesta(entrada, llamada.ai);
  }

  /*
   * El modelo que se PIDIÓ, no `openai_model` (que OpenAI devuelve con la
   * fecha de la versión): es lo que decide con qué tarifa se cobra el
   * mensaje (`tarifasDelModelo`).
   */
  cuerpo.metadata.modelo = modelo;
  cuerpo.metadata.modelo_ms = Date.now() - antesDelModelo;
  if (enrutado) cuerpo.metadata.enrutado = enrutado;

  // Buscar en la web, si el modelo lo pidió: una vez, con el mismo modelo
  // para la síntesis, y sin que la síntesis pueda mandar acciones.
  if (pidioBusqueda(cuerpo)) {
    const modeloSintesis = modelo;
    await resolverBusqueda(cuerpo, contenido, {
      buscar: opciones.buscar,
      alBuscar: opciones.alBuscar,
      sintetizar: async (extendido) => {
        const llamada = await preguntarAlModelo(clave, modeloSintesis, extendido);
        return llamada.ok ? prepararRespuesta(entrada, llamada.ai) : null;
      },
    });
  }

  if (!cuerpo.requiere_worker) {
    return { estado: "respondido", cuerpo };
  }

  // ------------------------------------------------------------------
  // Etapa 2: las acciones
  // ------------------------------------------------------------------

  if (!accionesEnTypeScript()) {
    return { estado: "delegar", motivo: cuerpo.accion };
  }

  // Null cuando la etapa 3 está prendida: no hace falta salir a la red.
  const config = workerEnProceso() ? null : configDelWorker();

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
  const antesDelWorker = Date.now();
  const resultados = await ejecutarJobs(jobs, config);
  cuerpo.metadata.worker_ms = Date.now() - antesDelWorker;
  // Autorizar y ejecutar, por acción: van a `turno` (lib/eos/tiempos.ts).
  cuerpo.metadata.acciones_ms = resultados.map((r) => ({
    accion: String(r.accion ?? ""),
    ...((r.ms && typeof r.ms === "object" ? r.ms : {}) as Record<string, unknown>),
  }));

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
      tokens_entrada_cacheados: cuerpo.tokens_entrada_cacheados,
      tokens_salida: cuerpo.tokens_salida,
    },
    resultados,
  );

  return { estado: "completado", cuerpo: final };
}
