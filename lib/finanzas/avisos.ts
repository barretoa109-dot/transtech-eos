import type { Riesgo } from "./riesgo.ts";

/**
 * Cuándo vale la pena molestar al usuario con un aviso de riesgo.
 *
 * El detector encuentra el MISMO problema todos los días hasta que llega la
 * fecha: si el 24 ve que el 28 va a faltar plata, el 25, el 26 y el 27 lo va a
 * volver a ver. Mandar ese aviso cinco veces es exactamente lo que entrena a
 * la gente a ignorar las notificaciones — y una alerta ignorada es peor que
 * ninguna, porque deja la sensación de estar cubierto.
 *
 * La función es pura y vive separada del envío para poder probar la regla sin
 * mandar nada.
 */

export type AvisoPrevio = {
  fecha_riesgo: string;
  faltante: number;
};

/**
 * Se vuelve a avisar solo si el problema cambió de identidad o empeoró de
 * verdad.
 *
 * El umbral es el DOBLE, no un porcentaje chico: que falten 200.000 más de lo
 * que ya se avisó no es una noticia nueva para el usuario, es la misma noticia
 * con otro número. Que falte el doble sí cambia lo que puede hacer al
 * respecto.
 */
const EMPEORO = 2;

export function convieneAvisar(riesgo: Riesgo, previo: AvisoPrevio | null): boolean {
  if (!previo) return true;

  // Otra fecha es otro problema: el anterior se resolvió o pasó.
  if (previo.fecha_riesgo !== riesgo.fecha) return true;

  return riesgo.faltante >= previo.faltante * EMPEORO;
}

/**
 * Título del push.
 *
 * Fijo y sin cifras, por la misma razón por la que el asunto del briefing es
 * fijo: la notificación se ve en la pantalla bloqueada, delante de quien esté
 * al lado. El monto va en el cuerpo, que exige desbloquear.
 */
export const TITULO_AVISO = "EOS · algo que conviene mirar";
