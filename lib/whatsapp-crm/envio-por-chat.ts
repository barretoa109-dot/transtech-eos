import type { ClienteSinTipos } from "../supabase/sin-tipos.ts";
import { enviarPorCanal } from "./enviar.ts";
import type { Fetcher } from "./meta.ts";

/**
 * "Sí, escribile": el chat le manda un WhatsApp a un cliente por el canal de la empresa.
 *
 * ============================================================
 * CÓMO SE REPARTE EL TRABAJO
 * ============================================================
 *
 * El ejecutor de la base (`ENVIAR_WHATSAPP_CLIENTE`, v186) VALIDA: que el cliente exista y
 * sea uno solo, que haya texto, canal activo, teléfono y que no haya pedido la baja. Si
 * algo de eso falla, la persona lo ve como cualquier otra acción del chat.
 *
 * Este archivo hace el ENVÍO, con el mismo `enviarPorCanal` que usa la pantalla: la
 * política de WhatsApp (ventana de 24 horas, plantillas, tope diario) es una sola, no una
 * copia para el chat. Lo que esa política bloquea vuelve acá con su motivo y se le cuenta
 * a la persona tal cual: EOS nunca dice "le escribí" si el mensaje no salió.
 *
 * ============================================================
 * IDEMPOTENCIA
 * ============================================================
 *
 * La clave es el id de la orden. El reintento de n8n, o un segundo llamado al mismo
 * comando, encuentra el mensaje ya registrado y devuelve `ya_enviado` sin volver a mandar.
 */

export type EstadoEnvioChat =
  | "enviado"
  | "ya_enviado"
  | "bloqueado"
  | "pendiente_aprobacion"
  | "fallido"
  | "invalido"
  // El servidor no pudo ni intentarlo: no hay forma de afirmar que salió.
  | "pendiente";

export type EnvioDeChat = {
  estado: EstadoEnvioChat;
  motivo?: string;
  mensaje_id?: string | null;
  reintentable?: boolean;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function enviarDesdeElChat(
  admin: ClienteSinTipos,
  entrada: { usuarioId: string; commandId: string; resultado: Record<string, unknown>; ahora?: string },
  fetcher?: Fetcher,
): Promise<EnvioDeChat> {
  const { resultado } = entrada;
  const contactoId = resultado.contacto_id;
  const canalId = resultado.canal_id;
  const texto = resultado.mensaje;

  if (typeof contactoId !== "string" || !UUID.test(contactoId) || typeof canalId !== "string" || !UUID.test(canalId) || typeof texto !== "string" || texto.trim() === "") {
    return { estado: "invalido", motivo: "Faltaban datos para enviar el mensaje." };
  }

  try {
    const r = await enviarPorCanal(
      admin,
      {
        usuarioId: entrada.usuarioId,
        canalId,
        contactoId,
        contenido: { tipo: "texto", texto },
        // Lo redactó EOS (cuenta para el tope de mensajes automáticos)…
        origen: "eos_autonomo",
        // …pero la persona vio el texto y dijo que sí: por eso el verbo existe.
        autorizacion: "aprobada",
        clave: `cmd:${entrada.commandId}`,
        ahora: entrada.ahora,
      },
      fetcher,
    );

    if (r.ok) {
      return { estado: r.via === "ya_enviado" ? "ya_enviado" : "enviado", mensaje_id: r.mensajeId };
    }

    return {
      estado: r.estado,
      motivo: r.motivo,
      mensaje_id: r.mensajeId ?? null,
      ...(r.reintentable ? { reintentable: true } : {}),
    };
  } catch (error) {
    // El detalle al log; a la persona, que no se pudo confirmar.
    console.error("Chat → WhatsApp: el envío falló de forma inesperada:", error);
    return { estado: "pendiente", motivo: "No pude confirmar que el mensaje saliera." };
  }
}

/** Termina con punto, sin duplicarlo. */
function conPunto(texto: string): string {
  const t = texto.trim();
  return /[.!?…]$/.test(t) ? t : `${t}.`;
}

/**
 * Lo que EOS le dice a la persona. La misma lógica vive en el nodo `05 INT Respuesta` del
 * worker de n8n (`fraseDeEnvioWhatsapp`); una prueba compara las dos con los mismos casos.
 */
export function fraseDelEnvio(nombre: string, envio: EnvioDeChat | null | undefined): string {
  const a = nombre.trim() || "el cliente";
  const motivo = envio?.motivo ? conPunto(envio.motivo) : "";

  switch (envio?.estado) {
    case "enviado":
      return `Listo, le escribí a ${a} por WhatsApp.`;
    case "ya_enviado":
      return `Ese mensaje a ${a} ya estaba enviado; no lo repetí.`;
    case "bloqueado":
      return `No le escribí a ${a}. ${motivo || "La política de WhatsApp no lo permite ahora."}`;
    case "pendiente_aprobacion":
      return `Dejé el mensaje para ${a} esperando tu aprobación en CRM > WhatsApp. ${motivo}`.trim();
    case "fallido":
      return `No pude mandarle el mensaje a ${a}. ${motivo || "Falló el envío."}${envio.reintentable ? " Probá de nuevo en un rato." : ""}`.trim();
    case "invalido":
      return `No pude mandarle el mensaje a ${a}. ${motivo || "Faltaban datos."}`.trim();
    default:
      // Sin estado o `pendiente`: NO se afirma nada.
      return `No pude confirmar que el mensaje a ${a} saliera. Mirá en CRM > WhatsApp antes de reenviarlo, para no duplicarlo.`;
  }
}
