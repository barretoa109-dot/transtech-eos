import { hablaDeLaMaquina } from "./memoria-contexto.ts";

/**
 * Qué aprendizajes ve la persona en su pantalla.
 *
 * El motor de aprendizaje saca sus conclusiones de la bitácora de acciones, así
 * que casi todo lo que produce habla del sistema y no del negocio ("mantener
 * CREAR_TAREA como ruta preferente", "validar la referencia de conversación
 * antes de guardar memoria"). Al 19 de septiembre de 2026, 152 de los 179
 * aprendizajes de cuentas reales eran de la categoría `ejecucion`. Mostrarlos
 * como "lo que EOS aprendió de vos" es falso y la primera pantalla que abre
 * quien quiere ver si EOS lo conoce.
 *
 * Es el mismo criterio que ya se usa para decidir qué entra al prompt
 * (`memoria-contexto.ts`); acá se aplica también a lo que se muestra, para que
 * la pantalla y el modelo hablen de lo mismo. Nada se borra: los aprendizajes
 * del sistema siguen en la base para quien mantiene EOS.
 */
export const CATEGORIA_DEL_SISTEMA = "ejecucion";

type Aprendizaje = {
  categoria?: string | null;
  patron?: string | null;
  recomendacion?: string | null;
};

export function esAprendizajeDelNegocio(a: Aprendizaje): boolean {
  if ((a.categoria ?? "").trim().toLowerCase() === CATEGORIA_DEL_SISTEMA) return false;

  return !hablaDeLaMaquina(`${a.patron ?? ""} ${a.recomendacion ?? ""}`);
}
