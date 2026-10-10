/**
 * Talles o variantes del catálogo (v238): crear varias filas de una, ya
 * nombradas como el resolver del chat las espera desde la v156/v157
 * ("Conjunto verde oliva S", "Conjunto verde oliva M").
 *
 * No hay ninguna columna de variante ni ningún cambio al resolver: cada
 * nombre que arma esta función es, para el resto del sistema, un producto
 * cualquiera.
 */

/** Limpia la lista cruda ("S, M, L" o un array ya separado): sin vacíos, sin repetidos, con un largo razonable. */
export function limpiarVariantes(crudo: unknown): string[] {
  const lista = Array.isArray(crudo)
    ? crudo
    : typeof crudo === "string"
      ? crudo.split(",")
      : [];

  return [...new Set(lista.map((v) => String(v ?? "").trim()).filter((v) => v.length > 0 && v.length <= 60))];
}

/** El nombre completo de cada variante: la base más la variante, tal como el resolver del chat ya sabe leer. */
export function nombresDeVariantes(nombreBase: string, crudo: unknown): string[] {
  const base = nombreBase.trim();
  return limpiarVariantes(crudo).map((v) => `${base} ${v}`.trim().slice(0, 200));
}
