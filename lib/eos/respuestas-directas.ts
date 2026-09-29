import type { ClienteSinTipos } from "../supabase/sin-tipos.ts";
import { esPreguntaQueSabes, leerLoQueSe, redactarLoQueSe } from "./que-sabes.ts";
import { esPreguntaQuienMeDebe, responderQuienMeDebe } from "./quien-me-debe.ts";
import { esPreguntaCuantoVendi, responderCuantoVendi } from "./cuanto-vendi.ts";

/**
 * Las preguntas que EOS contesta directo desde la base, sin el modelo.
 *
 * Son lecturas cuyo valor es el número exacto: "¿qué sabés de mi negocio?",
 * "¿quién me debe?". Contestarlas con datos en vez de con el modelo las hace
 * exactas, instantáneas y sin costo de IA, y no hay que darlas de alta en
 * n8n ni en el worker. `procesar-mensaje.ts` las inyecta por el mismo lugar
 * que la respuesta del gateway en TypeScript, así que todo lo que viene
 * después (cupo, historial, limpieza, WhatsApp) corre igual.
 *
 * Cada una reconoce su pregunta con un patrón ANGOSTO: ante la duda, el
 * mensaje va al modelo, que es el camino de siempre. Para sumar una nueva,
 * agregarla a la lista con su test.
 */

export type RespuestaDirecta = {
  /** Va a `metadata.respuesta_directa` y al log. */
  clave: string;
  /** `mensaje` es el original: algunas necesitan saber de qué período le preguntan. */
  responder: (admin: ClienteSinTipos, usuarioId: string, hoy: string, mensaje: string) => Promise<string>;
};

const RESPUESTAS: { es: (mensaje: string) => boolean; respuesta: RespuestaDirecta }[] = [
  {
    es: esPreguntaQueSabes,
    respuesta: {
      clave: "que_sabes",
      responder: async (admin, usuarioId, hoy) => redactarLoQueSe(await leerLoQueSe(admin, usuarioId, hoy)),
    },
  },
  {
    es: esPreguntaQuienMeDebe,
    respuesta: { clave: "quien_me_debe", responder: responderQuienMeDebe },
  },
  {
    es: esPreguntaCuantoVendi,
    respuesta: { clave: "cuanto_vendi", responder: responderCuantoVendi },
  },
];

export function respuestaDirectaPara(mensaje: string): RespuestaDirecta | null {
  return RESPUESTAS.find((r) => r.es(mensaje))?.respuesta ?? null;
}
