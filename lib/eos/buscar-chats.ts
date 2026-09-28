/**
 * Buscar en los chats: por título y por lo que se habló.
 *
 * El buscador de la barra lateral miraba solo el título, y los títulos los
 * pone el sistema ("Estrategia de negocio", "Documento profesional"): buscar
 * "althea" o "Sofía" no encontraba nunca el chat donde se habló de eso. Ahora
 * también busca en el texto de los mensajes y muestra el pedazo donde aparece.
 *
 * Acá están las reglas que se prueban sin base: cómo se compara (sin tildes ni
 * mayúsculas), cómo se arma el patrón para la consulta y qué pedazo se muestra.
 */

/** Desde cuántas letras se busca en los mensajes. Con una sola, todo coincide. */
export const MINIMO_PARA_BUSCAR = 2;

/** Sin tildes ni mayúsculas: "anulación" y "ANULACION" son lo mismo. */
export function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

/**
 * El patrón para `ilike`: lo que escribió la persona, literal.
 *
 * `%` y `_` son comodines en `ilike`; sin escaparlos, buscar "50%" encuentra
 * cualquier cosa que tenga un 50.
 */
export function patronIlike(consulta: string): string {
  const literal = consulta.trim().replace(/[\\%_]/g, (c) => `\\${c}`);
  return `%${literal}%`;
}

/**
 * El pedazo del mensaje donde aparece lo buscado, con algo de contexto a cada
 * lado. `null` si no aparece (la base busca con tildes; acá se confirma sin).
 */
export function fragmento(texto: string, consulta: string, contexto = 40): string | null {
  const plano = texto.replace(/\s+/g, " ").trim();
  const buscado = normalizar(consulta.trim());
  if (!buscado) return null;

  // `normalizar` no cambia el largo de las letras comunes, pero una letra con
  // tilde compuesta sí: se busca sobre el texto normalizado letra por letra.
  const letras = Array.from(plano);
  const normalizadas = letras.map((l) => normalizar(l));
  const unido = normalizadas.join("");
  const posicion = unido.indexOf(buscado);
  if (posicion < 0) return null;

  // De la posición en el texto normalizado a la letra original.
  let acumulado = 0;
  let inicioLetra = 0;
  for (let i = 0; i < normalizadas.length; i += 1) {
    if (acumulado >= posicion) {
      inicioLetra = i;
      break;
    }
    acumulado += normalizadas[i].length;
    inicioLetra = i + 1;
  }

  const desde = Math.max(0, inicioLetra - contexto);
  const hasta = Math.min(letras.length, inicioLetra + Array.from(consulta.trim()).length + contexto);

  return `${desde > 0 ? "…" : ""}${letras.slice(desde, hasta).join("").trim()}${hasta < letras.length ? "…" : ""}`;
}

export type ConversacionBuscable = { id: string; titulo: string | null };

/**
 * Qué conversaciones mostrar: las que coinciden por título y las que tienen un
 * mensaje que coincide, en el orden en que ya estaban (la más nueva arriba).
 */
export function filtrarConversaciones<T extends ConversacionBuscable>(
  conversaciones: T[],
  consulta: string,
  coincidencias: Record<string, string>,
): T[] {
  const buscado = normalizar(consulta.trim());
  if (!buscado) return conversaciones;

  return conversaciones.filter(
    (c) => normalizar(c.titulo || "Nuevo chat").includes(buscado) || c.id in coincidencias,
  );
}
