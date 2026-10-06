/**
 * Cómo se ve la barra de estado de la app nativa según el tema del teléfono.
 * Pura y probada, como `./plataforma`: el componente solo la aplica.
 *
 * Los valores son los de `@capacitor/status-bar`: `DARK` es texto oscuro
 * (para fondos claros) y `LIGHT` es texto claro (para fondos oscuros).
 */

export type EstiloDeBarra = "DARK" | "LIGHT";

export type BarraDeEstado = {
  estilo: EstiloDeBarra;
  /** Color de fondo de la barra en Android. iOS ignora este valor. */
  fondo: string;
};

/** Los mismos colores que `app/globals.css` para cada tema. */
const CLARO: BarraDeEstado = { estilo: "DARK", fondo: "#ffffff" };
const OSCURO: BarraDeEstado = { estilo: "LIGHT", fondo: "#0a0a0a" };

export function barraPara(oscuro: boolean): BarraDeEstado {
  return oscuro ? OSCURO : CLARO;
}
