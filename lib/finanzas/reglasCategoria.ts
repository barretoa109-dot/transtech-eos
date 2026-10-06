import { normalizarDescripcion } from "./recurrencia.ts";
import type { ClienteSinTipos } from "../supabase/sin-tipos.ts";
import { limpiarCategoria, type ReglaCategoria } from "./destinos.ts";

/**
 * Las correcciones de categoría que una persona hizo, guardadas como reglas.
 *
 * Se leen y escriben con el cliente de la sesión, así que la RLS de
 * `eos_reglas_categoria` (migración v234) ya limita todo a la persona que
 * pregunta. Este módulo no abre un camino de administrador.
 *
 * El patrón es el núcleo de la descripción (`normalizarDescripcion`), el mismo
 * que agrupa las series recurrentes. Así "Uber 35000" y "UBER 42000" comparten
 * regla, y "Uber Eats" queda aparte.
 */

/** Lo mínimo que hace falta para aprender de una corrección. */
export function patronDe(descripcion: string | null | undefined): string {
  return normalizarDescripcion(descripcion ?? null);
}

export async function cargarReglas(
  supabase: ClienteSinTipos,
  usuarioId: string,
): Promise<{ reglas: ReglaCategoria[]; error: boolean }> {
  const { data, error } = await supabase
    .from("eos_reglas_categoria")
    .select("patron,categoria")
    .eq("usuario_id", usuarioId)
    .limit(1000);

  if (error) {
    console.error("Finanzas: no se pudieron leer las reglas de categoría:", error);
    return { reglas: [], error: true };
  }

  const reglas = ((data ?? []) as { patron: string; categoria: string }[])
    .filter((r) => r.patron && limpiarCategoria(r.categoria))
    .map((r) => ({ patron: r.patron, categoria: r.categoria }));

  return { reglas, error: false };
}

/**
 * Guarda que esta persona quiere que este concepto vaya a esta categoría.
 *
 * Devuelve `false` si no había un concepto del que aprender (una descripción
 * vacía o sin letras) o si la escritura falló. Quien llama decide si eso
 * importa: la corrección de la fila ya se guardó igual.
 */
export async function aprenderRegla(
  supabase: ClienteSinTipos,
  usuarioId: string,
  descripcion: string | null | undefined,
  categoria: string,
): Promise<boolean> {
  const patron = patronDe(descripcion);
  const limpia = limpiarCategoria(categoria);
  if (!patron || patron.length < 2 || !limpia) return false;

  const { error } = await supabase.from("eos_reglas_categoria").upsert(
    {
      usuario_id: usuarioId,
      patron: patron.slice(0, 120),
      categoria: limpia,
      actualizada_en: new Date().toISOString(),
    },
    { onConflict: "usuario_id,patron" },
  );

  if (error) {
    console.error("Finanzas: no se pudo guardar la regla de categoría:", error);
    return false;
  }
  return true;
}
