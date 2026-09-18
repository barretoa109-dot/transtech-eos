/**
 * Clientes de WhatsApp que esperan una respuesta del dueño.
 *
 * ============================================================
 * QUÉ CUENTA COMO "ESPERANDO"
 * ============================================================
 *
 * Un cliente espera cuando el canal registró un `requiere_atencion_humana` —
 * pidió hablar con una persona, o confirmó una compra que falta autorizar— y
 * desde entonces la empresa no le escribió nada.
 *
 * "Le escribió" es un envío que efectivamente salió (en cola, enviado,
 * entregado o leído). Un mensaje BLOQUEADO por la política del canal no cuenta:
 * el cliente sigue esperando aunque EOS lo haya intentado, y un panel que se
 * queda tranquilo por un intento fallido es justo el error que esto evita.
 *
 * Es la única señal del CRM que se lee como "decisión": bloquea algo que EOS no
 * puede hacer solo (registrar la venta, seguir la conversación) hasta que la
 * persona intervenga. Ver la regla de `lib/eos/atencion.ts`.
 */

export type EventoDeAtencion = { contacto_id: string | null; creado_en: string };
export type EnvioReciente = { contacto_id: string | null; ocurrio_en: string };

export type ClientesEsperando = { cantidad: number; masHoras: number };

export function contarClientesEsperando(
  eventos: EventoDeAtencion[],
  envios: EnvioReciente[],
  ahora: string,
): ClientesEsperando | null {
  const t = Date.parse(ahora);
  if (!Number.isFinite(t)) return null;

  // El evento más viejo sin contestar de cada cliente: es el que marca cuánto lleva esperando.
  const espera = new Map<string, number>();

  for (const ev of eventos) {
    if (!ev.contacto_id) continue;
    const cuando = Date.parse(ev.creado_en);
    if (!Number.isFinite(cuando)) continue;

    const contestado = envios.some(
      (s) => s.contacto_id === ev.contacto_id && Date.parse(s.ocurrio_en) >= cuando,
    );
    if (contestado) continue;

    const previo = espera.get(ev.contacto_id);
    if (previo === undefined || cuando < previo) espera.set(ev.contacto_id, cuando);
  }

  if (espera.size === 0) return null;

  const masViejo = Math.min(...espera.values());
  return { cantidad: espera.size, masHoras: Math.max(0, Math.round((t - masViejo) / 3_600_000)) };
}
