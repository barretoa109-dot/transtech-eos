/**
 * Con qué secreto se valida la firma de un webhook, cuando puede haber varios.
 *
 * ============================================================
 * EL PROBLEMA
 * ============================================================
 *
 * Meta firma cada POST con el secreto de la APP de Meta que lo manda. Hasta ahora
 * había una sola app (la de TransTech) y un solo secreto. Si una empresa conecta su
 * WhatsApp Business con su PROPIA app de Meta, la firma sale con el secreto de esa
 * app y el global no la valida: el canal quedaría mudo.
 *
 * La solución es que cada canal pueda tener su secreto de app (en Vault, v185). Pero
 * el POST llega SIN autenticar, y el secreto que corresponde hay que buscarlo por un
 * dato que viene en el cuerpo (`phone_number_id`). Eso abre una pregunta de
 * seguridad que hay que contestar bien:
 *
 * ============================================================
 * LA REGLA QUE LO HACE SEGURO
 * ============================================================
 *
 * Un POST con varios `phone_number_id` distintos podría estar firmado con el secreto
 * de UNO solo —el del atacante, que tiene su propio canal— y traer adentro mensajes
 * "de" otro canal. Si se validara con el secreto del primero, la firma valdría para
 * todo el paquete y el atacante podría falsificar mensajes en el canal de otra
 * empresa.
 *
 * Por eso: **todos los números del paquete tienen que resolver al MISMO secreto.**
 *
 *   · ningún número tiene secreto propio  → se usa el global de siempre;
 *   · todos lo tienen y es el mismo       → se usa ese;
 *   · cualquier otra mezcla               → se RECHAZA, sin intentar validar.
 *
 * Esto es puro: no lee la base ni el entorno. Quien lo llama trae los secretos.
 */

/** Los `phone_number_id` distintos que trae un POST, sin autenticar. Solo dígitos. */
export function extraerPhoneNumberIds(cuerpoCrudo: string): string[] {
  let payload: unknown;
  try {
    payload = JSON.parse(cuerpoCrudo);
  } catch {
    return [];
  }

  const ids = new Set<string>();
  const entradas = (payload as { entry?: unknown })?.entry;

  if (Array.isArray(entradas)) {
    for (const entrada of entradas) {
      const cambios = (entrada as { changes?: unknown })?.changes;
      if (!Array.isArray(cambios)) continue;

      for (const cambio of cambios) {
        const id = (cambio as { value?: { metadata?: { phone_number_id?: unknown } } })?.value?.metadata?.phone_number_id;
        // Solo dígitos y con un largo razonable: es lo que se usa para consultar la base.
        if (typeof id === "string" && /^[0-9]{5,30}$/.test(id)) ids.add(id);
      }
    }
  }

  return [...ids];
}

export type Secreto = { ok: true; secreto: string | null } | { ok: false };

/**
 * `secretos` tiene, por cada `phone_number_id`, el secreto de app de SU canal, o
 * `null` si ese número no tiene (o no es de ningún canal de empresa).
 */
export function secretoParaPayload(ids: string[], secretos: Map<string, string | null>): Secreto {
  if (ids.length === 0) return { ok: true, secreto: null };

  const propios = ids.map((id) => secretos.get(id) ?? null);

  if (propios.every((s) => s === null)) return { ok: true, secreto: null };

  const primero = propios[0];
  if (primero !== null && propios.every((s) => s === primero)) return { ok: true, secreto: primero };

  return { ok: false };
}
