import type { ClienteSinTipos } from "../supabase/sin-tipos.ts";

/**
 * ¿Esta persona puede ser la responsable de un cliente de esta empresa?
 *
 * Sí si es quien está usando el CRM, o si es miembro de la MISMA empresa. Se consulta con el
 * cliente de servicio porque la política de la tabla de miembros solo deja ver la fila propia;
 * por eso el filtro por empresa está escrito a mano, y es la única frontera.
 *
 * Sin empresa resuelta, solo vale uno mismo: jamás se asigna un cliente a alguien de afuera.
 */
export async function responsableValido(
  admin: ClienteSinTipos,
  empresaId: string | null,
  responsableId: string,
  usuarioId: string,
): Promise<boolean> {
  if (responsableId === usuarioId) return true;
  if (!empresaId) return false;

  const { data, error } = await admin
    .from("eos_empresa_miembros")
    .select("usuario_id")
    .eq("empresa_id", empresaId)
    .eq("usuario_id", responsableId)
    .maybeSingle();

  if (error) {
    console.error("CRM: no se pudo verificar al responsable:", error);
    return false;
  }

  return data !== null;
}
