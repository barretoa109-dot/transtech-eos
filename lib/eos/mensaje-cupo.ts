/**
 * El texto que recibe la persona cuando el mensaje no se puede procesar por
 * su cupo o su suscripción.
 *
 * En la web invita a ver los planes. En la app nativa no: Apple no deja que
 * una app invite a comprar por fuera de su sistema (guía 3.1.3) y Google Play
 * tampoco. Ahí solo se explica qué pasó y cuándo se renueva.
 */
export type SituacionCupo = "limite" | "en_proceso" | "ya_procesado" | "suscripcion";

export function mensajeDeCupo(
  situacion: SituacionCupo,
  opciones: { planGratis: boolean; appNativa: boolean },
): string {
  const { planGratis, appNativa } = opciones;

  switch (situacion) {
    case "limite":
      if (planGratis) {
        return appNativa
          ? "Llegaste a tus 5 mensajes gratuitos de hoy. Tu cupo se renueva mañana según la hora de Paraguay."
          : "Llegaste a tus 5 mensajes gratuitos de hoy. Tu cupo se renueva mañana según la hora de Paraguay. Si querés seguir ahora, podés elegir un plan en Planes.";
      }
      return appNativa
        ? "Llegaste al límite de mensajes de tu plan actual."
        : "Llegaste al límite de mensajes de tu plan actual. Podés revisar tus opciones en Planes.";
    case "en_proceso":
      return "Este mensaje ya se está procesando. Esperá la respuesta antes de volver a enviarlo.";
    case "ya_procesado":
      return "Este mensaje ya fue procesado. Para continuar, enviá un mensaje nuevo.";
    case "suscripcion":
      return appNativa
        ? "Tu suscripción no permite enviar mensajes en este momento."
        : "Tu suscripción no permite enviar mensajes en este momento. Revisá tu plan para continuar.";
  }
}

/**
 * El plan con el que se atiende un mensaje: el que devolvió la reserva de
 * cupo, que es la base decidiendo (v228: cuenta un tramo de conversaciones
 * pago aunque `usuarios.plan` diga free). Si la respuesta no trae un plan
 * legible, queda el que calculó el servidor con el perfil.
 */
export function planDelCupo(planDeLaReserva: unknown, planDelPerfil: string): string {
  if (typeof planDeLaReserva !== "string") return planDelPerfil;
  const plan = planDeLaReserva.trim().toLowerCase();
  return /^[a-z_]{2,40}$/.test(plan) ? plan : planDelPerfil;
}
