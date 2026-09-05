import { timingSafeEqual } from "crypto";

/**
 * "¿Este llamado viene del Worker?" — una sola vez, para todos.
 *
 * ============================================================
 * ESTABA ESCRITA CUATRO VECES
 * ============================================================
 *
 * La misma función vivía copiada en `lib/worker-gate-handler.ts`, en
 * `app/api/internal/worker-authorize/v1/route.ts` y en
 * `app/api/internal/action-effects/v1/route.ts`, y las rutas nuevas de la
 * etapa 3 iban a sumar una quinta.
 *
 * Se comprobó que las tres eran idénticas —normalizando espacios y
 * comentarios, carácter por carácter— antes de unificarlas: dos
 * implementaciones que se parecen no son lo mismo que dos implementaciones
 * iguales, y fusionar las primeras habría cambiado el comportamiento de alguna
 * sin que nadie lo notara.
 *
 * Que sean varias copias importa porque esto decide quién puede ejecutar
 * acciones con efecto durable. Cuatro lugares son cuatro oportunidades de que
 * uno diga que sí mientras los otros dicen que no, y la que se equivoque de
 * más deja una puerta abierta.
 *
 * ============================================================
 * POR QUÉ UN MÓDULO PROPIO Y NO EL DEL GATE
 * ============================================================
 *
 * La función ya estaba exportada desde `worker-gate-handler.ts`, pero ese
 * módulo trae la tabla de riesgo, el cliente de Supabase y el handler entero.
 * Importarlo desde cinco rutas para usar veinte líneas arrastra todo eso a
 * cada una. Acá no hay más dependencia que `crypto`.
 *
 * ============================================================
 * LOS TRES RESULTADOS SON TRES, NO DOS
 * ============================================================
 *
 * `unavailable` no es un caso de "no autorizado": significa que el servidor no
 * tiene configurado el secreto, y por eso quien llama responde 503 y no 401.
 * Confundirlos manda a buscar el problema al lado equivocado — a revisar el
 * token de quien llama cuando lo que falta es una variable de entorno.
 */

export type Autorizacion = {
  ok: boolean;
  /** El servidor no tiene `EOS_WORKER_GATE_SECRET`. No es culpa de quien llama. */
  unavailable: boolean;
};

export function autorizadoComoWorker(request: Request): Autorizacion {
  const expected = process.env.EOS_WORKER_GATE_SECRET;
  if (!expected) return { ok: false, unavailable: true };

  const header = request.headers.get("authorization") || "";
  const supplied = header.startsWith("Bearer ") ? header.slice(7) : "";

  if (!supplied) return { ok: false, unavailable: false };

  const expectedBuffer = Buffer.from(expected);
  const suppliedBuffer = Buffer.from(supplied);

  /*
   * La comparación de largo va antes y por fuera de `timingSafeEqual`, que
   * lanza si los buffers no miden lo mismo. Filtra por largo —que sí se puede
   * medir desde afuera— pero el contenido se compara en tiempo constante, que
   * es lo que evita adivinar el secreto carácter por carácter.
   */
  if (expectedBuffer.length !== suppliedBuffer.length) {
    return { ok: false, unavailable: false };
  }

  return { ok: timingSafeEqual(expectedBuffer, suppliedBuffer), unavailable: false };
}
