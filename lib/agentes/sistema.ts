import type { Canal } from "./agentes.ts";

/**
 * La puerta del tope para los avisos automáticos que no son de un agente:
 * el push de las franjas, el correo motivacional y los de la primera semana
 * (v268). Comparten el tope semanal con los agentes.
 *
 * Cierra si no puede preguntar: si la base no contesta, el aviso no sale.
 * Un motivacional de menos no le hace daño a nadie; uno de más rompe la
 * promesa de no saturar.
 *
 * No pasan por acá lo transaccional, las respuestas a algo que la persona
 * escribió, el briefing (opt-in), la agenda ni los avisos de riesgo. Ver la
 * cabecera de la v268.
 */

type Rpc = {
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message?: string } | null }>;
};

/** Cada cuántos días, como mínimo, puede llegar algo motivacional a una persona. */
export const ESPACIADO_MOTIVACIONAL_DIAS = 3;

export type PedidoSistema = {
  usuarioId: string;
  canal: Canal;
  /** "push/manana", "correo/motivacional", "correo/primeros-dias/dia3"… */
  plantilla: string;
  espaciarDias?: number;
};

export type Cupo = {
  /** El id del mensaje autorizado, o null si no hay cupo (o no se pudo preguntar). */
  pedir: (pedido: PedidoSistema) => Promise<string | null>;
  /** Lo que pasó con un mensaje autorizado. Nunca lanza. */
  entregado: (mensajeId: string, ok: boolean, detalle?: string) => Promise<void>;
};

export function cupoDelSistema(admin: Rpc): Cupo {
  return {
    async pedir(pedido) {
      try {
        const { data, error } = await admin.rpc("eos_agentes_autorizar_sistema_v268", {
          p_usuario_id: pedido.usuarioId,
          p_canal: pedido.canal,
          p_plantilla: pedido.plantilla,
          p_espaciar_dias: pedido.espaciarDias ?? 0,
        });
        if (error) {
          console.error("Tope de avisos: no se pudo preguntar, no se manda:", error.message ?? error);
          return null;
        }
        return typeof data === "string" ? data : null;
      } catch (e) {
        console.error("Tope de avisos: no se pudo preguntar, no se manda:", e instanceof Error ? e.message : e);
        return null;
      }
    },

    async entregado(mensajeId, ok, detalle) {
      try {
        const { error } = await admin.rpc("eos_agentes_entrega_sistema_v268", {
          p_mensaje_id: mensajeId,
          p_estado: ok ? "enviado" : "fallado",
          p_detalle: detalle ?? null,
        });
        if (error) console.error("Tope de avisos: no se pudo anotar la entrega:", error.message ?? error);
      } catch (e) {
        console.error("Tope de avisos: no se pudo anotar la entrega:", e instanceof Error ? e.message : e);
      }
    },
  };
}
