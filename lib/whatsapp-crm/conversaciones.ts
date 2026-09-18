import { contarClientesEsperando, type EventoDeAtencion, type EnvioReciente } from "./pendientes.ts";

/**
 * De filas sueltas de la base a la lista de conversaciones que se ve en el CRM.
 *
 * Pura: no lee la base ni el reloj. La ruta trae las filas (con la sesión de la
 * persona, así que la RLS decide qué ve) y esto solo las ordena y las agrupa.
 */

export type FilaMensaje = {
  id: string;
  contacto_id: string | null;
  direccion: "entrante" | "saliente";
  telefono: string;
  texto: string | null;
  tipo: string;
  estado: string;
  motivo: string | null;
  origen: string;
  intencion: string | null;
  ocurrio_en: string;
};

export type FilaContacto = { id: string; nombre: string; telefono: string | null };
export type FilaConsentimiento = { contacto_id: string; estado: "otorgado" | "revocado" };

export type MensajeVisible = {
  id: string;
  direccion: "entrante" | "saliente";
  texto: string;
  tipo: string;
  estado: string;
  motivo: string | null;
  origen: string;
  intencion: string | null;
  ocurrio_en: string;
};

export type Conversacion = {
  /** Lo que identifica la conversación: el cliente, o el teléfono si todavía no tiene ficha. */
  clave: string;
  contacto_id: string | null;
  nombre: string;
  telefono: string;
  consentimiento: "otorgado" | "revocado" | "sin_registro";
  /** Pidió una persona o confirmó una compra, y nadie le contestó. */
  esperando: boolean;
  ultimo: MensajeVisible;
  /** Del más viejo al más nuevo, como se lee una conversación. */
  mensajes: MensajeVisible[];
};

/** Cuántos mensajes se muestran por conversación: lo reciente es lo que se contesta. */
const MAX_POR_CONVERSACION = 30;

const visible = (m: FilaMensaje): MensajeVisible => ({
  id: m.id,
  direccion: m.direccion,
  texto: m.texto ?? "",
  tipo: m.tipo,
  estado: m.estado,
  motivo: m.motivo,
  origen: m.origen,
  intencion: m.intencion,
  ocurrio_en: m.ocurrio_en,
});

export function agruparConversaciones(datos: {
  mensajes: FilaMensaje[];
  contactos: FilaContacto[];
  consentimientos: FilaConsentimiento[];
  eventosDeAtencion: EventoDeAtencion[];
  ahora: string;
}): Conversacion[] {
  const contactos = new Map(datos.contactos.map((c) => [c.id, c]));
  const consentimientos = new Map(datos.consentimientos.map((c) => [c.contacto_id, c.estado]));

  // Una conversación por cliente; si el mensaje no tiene ficha, por teléfono.
  const grupos = new Map<string, FilaMensaje[]>();
  for (const m of datos.mensajes) {
    const clave = m.contacto_id ?? `tel:${m.telefono}`;
    const lista = grupos.get(clave) ?? [];
    lista.push(m);
    grupos.set(clave, lista);
  }

  const conversaciones: Conversacion[] = [];

  for (const [clave, filas] of grupos) {
    const ordenadas = [...filas].sort((a, b) => Date.parse(a.ocurrio_en) - Date.parse(b.ocurrio_en));
    const recientes = ordenadas.slice(-MAX_POR_CONVERSACION);
    const ultimo = recientes[recientes.length - 1];

    const contactoId = ultimo.contacto_id;
    const contacto = contactoId ? contactos.get(contactoId) : undefined;

    // Solo lo que efectivamente salió cuenta como haber contestado.
    const envios: EnvioReciente[] = ordenadas
      .filter((m) => m.direccion === "saliente" && ["en_cola", "enviado", "entregado", "leido"].includes(m.estado))
      .map((m) => ({ contacto_id: contactoId, ocurrio_en: m.ocurrio_en }));

    const eventos = contactoId ? datos.eventosDeAtencion.filter((e) => e.contacto_id === contactoId) : [];

    conversaciones.push({
      clave,
      contacto_id: contactoId,
      nombre: contacto?.nombre ?? `+${ultimo.telefono}`,
      telefono: ultimo.telefono,
      consentimiento: (contactoId ? consentimientos.get(contactoId) : undefined) ?? "sin_registro",
      esperando: contarClientesEsperando(eventos, envios, datos.ahora) !== null,
      ultimo: visible(ultimo),
      mensajes: recientes.map(visible),
    });
  }

  // Primero los que esperan; después, lo más reciente.
  return conversaciones.sort(
    (a, b) =>
      Number(b.esperando) - Number(a.esperando) ||
      Date.parse(b.ultimo.ocurrio_en) - Date.parse(a.ultimo.ocurrio_en),
  );
}
