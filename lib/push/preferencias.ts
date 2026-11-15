/**
 * Qué notificaciones quiere recibir cada persona en la app, una por una.
 *
 * Todo vive en `eos_followup_preferences` (v260). Este archivo es la única
 * definición de qué interruptores hay, qué columna gobierna cada uno y qué
 * pasa cuando no hay fila: la pantalla, la API y los envíos leen de acá, para
 * que no pueda pasar que la pantalla diga "apagado" y el envío salga igual.
 *
 * SIN DATO ES "SÍ". Una cuenta sin fila, o una base que todavía no tiene la
 * columna, recibe todo: es el valor con el que arranca todo el mundo
 * (decisión del dueño, 2026-11-10).
 */

export const CLAVES_DE_NOTIFICACION = ["manana", "mediodia", "noche", "agenda", "riesgos"] as const;
export type ClaveDeNotificacion = (typeof CLAVES_DE_NOTIFICACION)[number];

export type PreferenciasDeNotificacion = Record<ClaveDeNotificacion, boolean>;

/** La fila tal como viene de la base. Cualquier columna puede faltar. */
export type FilaDePreferencias = {
  avisos_motivacionales_push?: boolean | null;
  push_manana?: boolean | null;
  push_mediodia?: boolean | null;
  push_noche?: boolean | null;
  avisos_agenda?: boolean | null;
  avisos_riesgo_push?: boolean | null;
} | null | undefined;

const COLUMNA_DE_FRANJA = {
  manana: "push_manana",
  mediodia: "push_mediodia",
  noche: "push_noche",
} as const;

const FRANJAS = ["manana", "mediodia", "noche"] as const;

export function esClaveDeNotificacion(valor: unknown): valor is ClaveDeNotificacion {
  return typeof valor === "string" && (CLAVES_DE_NOTIFICACION as readonly string[]).includes(valor);
}

/**
 * Lo que la persona recibe hoy, interruptor por interruptor.
 *
 * `avisos_motivacionales_push` es el interruptor viejo, el de "todo o nada":
 * en `false` apaga las tres franjas, diga lo que diga cada una. Así quien lo
 * apagó antes de que existiera esta pantalla sigue sin recibir nada.
 */
export function leerPreferencias(fila: FilaDePreferencias): PreferenciasDeNotificacion {
  const general = fila?.avisos_motivacionales_push !== false;

  return {
    manana: general && fila?.push_manana !== false,
    mediodia: general && fila?.push_mediodia !== false,
    noche: general && fila?.push_noche !== false,
    agenda: fila?.avisos_agenda !== false,
    riesgos: fila?.avisos_riesgo_push !== false,
  };
}

/**
 * Las columnas que hay que escribir para dejar UN interruptor en `valor`.
 *
 * El caso delicado es encender una franja cuando el interruptor viejo estaba
 * apagado: hay que volver a encender el general (si no, la franja nunca sale)
 * y, en el mismo movimiento, dejar escritas en `false` las otras dos. Sin eso,
 * tocar "mañana" le encendería de rebote el mediodía y la noche a alguien que
 * había pedido no recibir ninguna.
 */
export function cambioDePreferencia(
  fila: FilaDePreferencias,
  clave: ClaveDeNotificacion,
  valor: boolean,
): Record<string, boolean> {
  if (clave === "agenda") return { avisos_agenda: valor };
  if (clave === "riesgos") return { avisos_riesgo_push: valor };

  const actual = leerPreferencias(fila);
  const cambio: Record<string, boolean> = {};
  for (const franja of FRANJAS) {
    cambio[COLUMNA_DE_FRANJA[franja]] = franja === clave ? valor : actual[franja];
  }
  // Con alguna franja encendida el general tiene que estar encendido; con las
  // tres apagadas da igual, y se deja en `true` para que cada franja diga la verdad.
  cambio.avisos_motivacionales_push = true;
  return cambio;
}
