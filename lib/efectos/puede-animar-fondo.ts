/**
 * ¿Este equipo puede con el fondo 3D (three.js) sin trabarse?
 *
 * Decorativo, así que ante la duda, no. Ver AmbientBackground.tsx para el
 * número que lo motivó.
 */
export type EntornoNavegador = {
  innerWidth: number;
  matchMedia?: (consulta: string) => { matches: boolean };
  navigator: {
    hardwareConcurrency?: number;
    deviceMemory?: number;
    connection?: { saveData?: boolean };
  };
};

export function puedeAnimarFondo(w: EntornoNavegador): boolean {
  const pide = (consulta: string) => Boolean(w.matchMedia?.(consulta).matches);

  if (pide("(prefers-reduced-motion: reduce)")) return false;
  if (w.navigator.connection?.saveData) return false;
  // Teléfonos: pantalla angosta o puntero táctil como principal.
  if (w.innerWidth < 900 || pide("(pointer: coarse)")) return false;
  // Equipos modestos. Si el navegador no informa, se asume que puede.
  if ((w.navigator.hardwareConcurrency ?? 8) <= 4) return false;
  if ((w.navigator.deviceMemory ?? 8) <= 4) return false;

  return true;
}
