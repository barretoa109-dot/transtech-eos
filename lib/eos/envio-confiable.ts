/**
 * Que un mensaje al chat llegue aunque la conexión del teléfono se corte.
 *
 * ============================================================
 * LO QUE PASÓ (27 de septiembre de 2026, 20:54, usando EOS de verdad)
 * ============================================================
 *
 * Un mensaje con dos capturas terminó en "Ahora mismo no pude conectarme
 * correctamente". En la base no quedó NADA de ese pedido: ni reserva de cupo,
 * ni lectura de las imágenes, ni respuesta en el buzón (v196). El servidor
 * nunca lo recibió: la conexión se cortó mientras subía. El buzón de la v196
 * no alcanzaba, porque esperaba una respuesta que nadie estaba escribiendo, y
 * a los 150 segundos se rendía. "Regenerar", un minuto después, anduvo.
 *
 * ============================================================
 * QUÉ HACE AHORA
 * ============================================================
 *
 * Si el envío muere por la red, se le pregunta al servidor si lo recibió
 * (`/api/eos/resultado` dice `recibido`):
 *
 * - Lo recibió → se espera la respuesta en el buzón, como antes.
 * - No lo recibió → se REENVÍA solo, con el mismo `request_id`.
 *
 * Reenviar no puede cargar dos veces una venta: el servidor anota cada
 * `request_id` apenas lo recibe, y a uno repetido le contesta lo que ya tiene
 * (o "sigo trabajando") en vez de procesarlo otra vez.
 *
 * Este archivo no conoce `fetch` ni el navegador: recibe las funciones de
 * afuera, así la lógica se prueba entera con `node --test`.
 */

export const MAX_ENVIOS = 4;

/** Entre una consulta al buzón y la siguiente. */
export const INTERVALO_CONSULTA_MS = 2_000;

/**
 * Cuántas veces seguidas el servidor tiene que decir "no lo recibí" antes de
 * reenviar. Anotar la llegada le lleva al servidor menos de un segundo; tres
 * consultas son seis, con margen para una red lenta.
 */
export const CONSULTAS_ANTES_DE_REENVIAR = 3;

/**
 * Lo máximo que se espera en total. Cubre una respuesta completa del servidor
 * (`maxDuration = 300` en `/api/eos`) más el margen del reenvío.
 */
export const ESPERA_TOTAL_MS = 330_000;

/** Antes de cada reenvío, cada vez un poco más: no se martilla una red caída. */
export const PAUSAS_REENVIO_MS = [0, 1_500, 4_000, 8_000];

export type RespuestaCruda = { estado: number; texto: string };

export type ConsultaBuzon = {
  listo: boolean;
  recibido: boolean;
  estado_http?: number;
  cuerpo?: unknown;
};

export type Llegada =
  | { origen: "directo"; estado: number; texto: string }
  | { origen: "buzon"; estado: number; cuerpo: unknown };

export type Dependencias = {
  /** Manda el pedido y lee el cuerpo entero. Un corte de red tira `TypeError`. */
  enviar: () => Promise<RespuestaCruda>;
  /** `null` = la sesión venció: no hay a quién preguntarle. */
  consultar: () => Promise<ConsultaBuzon | null>;
  dormir: (ms: number) => Promise<void>;
  ahora: () => number;
  /** En el celular, una pestaña en segundo plano no tiene red: se espera a que vuelva. */
  esperarVisible?: () => Promise<void>;
};

/**
 * Un fallo de red del propio `fetch`. El navegador SIEMPRE tira `TypeError`
 * ("Load failed" en Safari, "Failed to fetch" en Chrome); los errores que arma
 * la app a propósito nunca lo son.
 */
function esCorteDeRed(error: unknown): boolean {
  return error instanceof TypeError;
}

/**
 * Una respuesta que no escribió EOS sino la plataforma (502, 503, 504 en HTML):
 * el pedido pudo no haber llegado a la función. Se trata como un corte.
 */
function esRespuestaDePlataforma(r: RespuestaCruda): boolean {
  if (r.estado < 500) return false;
  try {
    JSON.parse(r.texto);
    return false;
  } catch {
    return true;
  }
}

/** El servidor ya tiene este pedido y lo está trabajando (reenvío de uno en curso). */
function esEnProceso(r: RespuestaCruda): boolean {
  if (r.estado === 202) return true;
  if (r.estado !== 409) return false;
  try {
    return (JSON.parse(r.texto) as { code?: string })?.code === "EOS_MESSAGE_REQUEST_IN_PROGRESS";
  } catch {
    return false;
  }
}

type Espera = { tipo: "listo"; llegada: Llegada } | { tipo: "no-recibido" } | { tipo: "agotado" };

async function esperarEnBuzon(dep: Dependencias, limite: number, recibidoDeAntemano: boolean): Promise<Espera> {
  let noRecibidoSeguidas = 0;
  let recibido = recibidoDeAntemano;

  while (dep.ahora() < limite) {
    await dep.dormir(INTERVALO_CONSULTA_MS);

    let consulta: ConsultaBuzon | null;
    try {
      consulta = await dep.consultar();
    } catch (error) {
      // Sin red tampoco para preguntar: no se sabe nada, se sigue esperando.
      if (esCorteDeRed(error)) continue;
      throw error;
    }

    if (consulta === null) return { tipo: "agotado" };

    if (consulta.listo) {
      return {
        tipo: "listo",
        llegada: { origen: "buzon", estado: Number(consulta.estado_http) || 200, cuerpo: consulta.cuerpo },
      };
    }

    if (consulta.recibido) {
      recibido = true;
      noRecibidoSeguidas = 0;
      continue;
    }

    if (recibido) continue;

    noRecibidoSeguidas += 1;
    if (noRecibidoSeguidas >= CONSULTAS_ANTES_DE_REENVIAR) return { tipo: "no-recibido" };
  }

  return { tipo: "agotado" };
}

/**
 * Manda el pedido hasta que llegue, o hasta que se agote la espera.
 *
 * Devuelve `null` solo si de verdad no hubo forma: sin red durante minutos, o
 * la sesión vencida. Nunca manda dos veces algo que el servidor ya tiene.
 */
export async function enviarHastaQueLlegue(dep: Dependencias): Promise<Llegada | null> {
  const limite = dep.ahora() + ESPERA_TOTAL_MS;

  for (let envio = 0; envio < MAX_ENVIOS && dep.ahora() < limite; envio += 1) {
    const pausa = PAUSAS_REENVIO_MS[Math.min(envio, PAUSAS_REENVIO_MS.length - 1)];
    if (pausa > 0) await dep.dormir(pausa);
    if (dep.esperarVisible) await dep.esperarVisible();

    let recibido = false;
    try {
      const r = await dep.enviar();
      if (esEnProceso(r)) {
        recibido = true;
      } else if (!esRespuestaDePlataforma(r)) {
        return { origen: "directo", estado: r.estado, texto: r.texto };
      }
    } catch (error) {
      if (!esCorteDeRed(error)) throw error;
    }

    const espera = await esperarEnBuzon(dep, limite, recibido);
    if (espera.tipo === "listo") return espera.llegada;
    if (espera.tipo === "agotado") return null;
    // "no-recibido": vuelta al for, se reenvía.
  }

  return null;
}
