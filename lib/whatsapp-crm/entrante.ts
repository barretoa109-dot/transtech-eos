import type { ClienteSinTipos } from "../supabase/sin-tipos.ts";
import { clasificarIntencion, type Intencion } from "./intencion.ts";
import { refinarIntencion } from "./intencion-ia.ts";

/**
 * Lo que Meta manda cuando le escribe un cliente al WhatsApp de una empresa.
 *
 * ============================================================
 * POR QUÉ ESTO VA ANTES DEL CAMINO DE "USUARIO DE EOS"
 * ============================================================
 *
 * Todos los números de la plataforma le pegan a la MISMA URL de webhook. El
 * camino original (`app/api/whatsapp/webhook/route.ts`) supone que quien
 * escribe es una persona hablándole a EOS: si no encuentra su teléfono
 * vinculado, lo trata como alguien que quiere crear una cuenta.
 *
 * Para un número de empresa eso es exactamente lo que NO tiene que pasar: un
 * cliente preguntando por un precio no es un usuario nuevo de EOS. Por eso el
 * webhook mira primero `metadata.phone_number_id` y, si es de un canal
 * registrado, entrega TODO el cambio acá y no sigue.
 */

export type ValorWebhook = {
  metadata?: { phone_number_id?: string };
  contacts?: { wa_id?: string; profile?: { name?: string } }[];
  messages?: MensajeCliente[];
  statuses?: EstadoMeta[];
};

export type MensajeCliente = {
  id?: string;
  from?: string;
  timestamp?: string;
  type?: string;
  text?: { body?: string };
  image?: { caption?: string };
  document?: { caption?: string; filename?: string };
  audio?: Record<string, unknown>;
  button?: { text?: string };
  interactive?: {
    button_reply?: { title?: string };
    list_reply?: { title?: string };
  };
};

export type EstadoMeta = {
  id?: string;
  status?: string;
  errors?: { code?: number; title?: string; message?: string }[];
};

export type EntranteListo =
  | {
      clase: "mensaje";
      wa_message_id: string;
      telefono: string;
      texto: string;
      tipo: "texto" | "imagen" | "documento" | "audio" | "otro";
      nombre_perfil: string;
      ocurrio_en: string;
      intencion: string;
    }
  | {
      clase: "estado";
      wa_message_id: string;
      estado: "enviado" | "entregado" | "leido" | "fallido";
      motivo: string;
    };

const TIPOS: Record<string, "texto" | "imagen" | "documento" | "audio"> = {
  text: "texto",
  image: "imagen",
  document: "documento",
  audio: "audio",
};

/** El texto que se lee de un mensaje: cuerpo, pie de foto o el botón que tocó. */
function textoDe(m: MensajeCliente): string {
  return (
    m.text?.body ??
    m.image?.caption ??
    m.document?.caption ??
    m.button?.text ??
    m.interactive?.button_reply?.title ??
    m.interactive?.list_reply?.title ??
    ""
  ).trim();
}

/** El instante del mensaje. Meta manda segundos Unix; sin eso, se usa `ahora`. */
function instanteDe(m: MensajeCliente, ahora: string): string {
  const segundos = Number(m.timestamp);
  if (Number.isFinite(segundos) && segundos > 0) return new Date(segundos * 1000).toISOString();
  return ahora;
}

const ESTADOS: Record<string, "enviado" | "entregado" | "leido" | "fallido"> = {
  sent: "enviado",
  delivered: "entregado",
  read: "leido",
  failed: "fallido",
};

/**
 * Del payload de Meta a lo que hay que registrar. Pura: no lee la base ni el reloj.
 *
 * Lo que no sirve se descarta en silencio —un mensaje sin id no se puede
 * deduplicar, uno sin remitente no se puede asociar a nadie—: registrar algo a
 * medias es peor que no registrarlo, y Meta no reintenta por esto.
 */
export function prepararEntrantes(valor: ValorWebhook, ahora: string): EntranteListo[] {
  const nombres = new Map(
    (valor.contacts ?? [])
      .filter((c): c is { wa_id: string; profile?: { name?: string } } => Boolean(c.wa_id))
      .map((c) => [c.wa_id, c.profile?.name?.trim() ?? ""]),
  );

  const listos: EntranteListo[] = [];

  for (const m of valor.messages ?? []) {
    const id = String(m.id ?? "").trim();
    const desde = String(m.from ?? "").replace(/\D/g, "");
    if (!id || !desde) continue;

    const texto = textoDe(m);

    listos.push({
      clase: "mensaje",
      wa_message_id: id,
      telefono: desde,
      texto,
      tipo: TIPOS[m.type ?? ""] ?? "otro",
      nombre_perfil: nombres.get(desde) ?? "",
      ocurrio_en: instanteDe(m, ahora),
      intencion: clasificarIntencion(texto),
    });
  }

  for (const s of valor.statuses ?? []) {
    const id = String(s.id ?? "").trim();
    const estado = ESTADOS[s.status ?? ""];
    if (!id || !estado) continue;

    const error = s.errors?.[0];
    listos.push({
      clase: "estado",
      wa_message_id: id,
      estado,
      motivo: estado === "fallido" ? (error?.title ?? error?.message ?? "WhatsApp no pudo entregar el mensaje.") : "",
    });
  }

  return listos;
}

export type CanalEmpresa = { id: string; usuario_id: string; estado: string };

/** ¿Este número es el WhatsApp de alguna empresa? La única puerta de entrada al canal. */
export async function buscarCanalEmpresa(
  admin: ClienteSinTipos,
  phoneNumberId: string | undefined | null,
): Promise<CanalEmpresa | null> {
  const id = String(phoneNumberId ?? "").trim();
  if (!id) return null;

  const { data, error } = await admin
    .from("eos_wa_canales")
    .select("id, usuario_id, estado")
    .eq("phone_number_id", id)
    .maybeSingle();

  if (error) {
    /*
     * La tabla todavía no existe (42P01 en Postgres, PGRST205 en PostgREST).
     *
     * Pasa si este código se despliega ANTES que la migración v177. En ese caso
     * no hay ningún canal de empresa que atender, y tumbar el webhook con un 500
     * dejaría sin respuesta a TODOS los usuarios de EOS por WhatsApp — el canal
     * principal — para proteger una función que todavía no existe.
     */
    const codigo = String((error as { code?: unknown }).code ?? "");
    if (codigo === "42P01" || codigo === "PGRST205") return null;

    // Cualquier otro error de lectura: NO se puede decir "no es de una empresa",
    // porque el mensaje caería en el camino de usuarios de EOS. Se propaga y
    // Meta reintenta.
    throw new Error(`No se pudo consultar el canal de empresa: ${error.message}`);
  }

  return (data as CanalEmpresa | null) ?? null;
}

export type ResumenEntrante = {
  mensajes: number;
  duplicados: number;
  clientes_nuevos: number;
  bajas: number;
  estados: number;
  errores: number;
};

/**
 * Registra en el CRM lo que llegó a un canal de empresa.
 *
 * Un canal desconectado no registra nada: la empresa lo dio de baja y no hay a
 * quién mostrarle esa conversación. Pausado o pendiente SÍ registra —el
 * historial no se pierde porque el envío esté detenido—.
 */
export async function atenderCanalEmpresa(
  admin: ClienteSinTipos,
  canal: CanalEmpresa,
  valor: ValorWebhook,
  ahora: string = new Date().toISOString(),
  // Se inyecta en las pruebas. En producción, el modelo solo corre si la empresa lo encendió
  // (`EOS_INTENCION_IA=1`); sin eso devuelve lo que dijeron las reglas, sin salir a la red.
  refinar: (texto: string, regla: Intencion) => Promise<Intencion> = refinarIntencion,
): Promise<ResumenEntrante> {
  const resumen: ResumenEntrante = { mensajes: 0, duplicados: 0, clientes_nuevos: 0, bajas: 0, estados: 0, errores: 0 };

  if (canal.estado === "desconectado") return resumen;

  for (const item of prepararEntrantes(valor, ahora)) {
    try {
      if (item.clase === "mensaje") {
        const { data, error } = await admin.rpc("eos_wa_recibir_v177", {
          p_canal_id: canal.id,
          p_wa_message_id: item.wa_message_id,
          p_telefono: item.telefono,
          p_texto: item.texto,
          p_tipo: item.tipo,
          p_nombre_perfil: item.nombre_perfil,
          p_ocurrio_en: item.ocurrio_en,
          p_intencion: await refinar(item.texto, item.intencion as Intencion),
        });

        if (error) throw error;

        const r = (data ?? {}) as { duplicado?: boolean; contacto_nuevo?: boolean; opt_out?: boolean };
        if (r.duplicado) resumen.duplicados += 1;
        else resumen.mensajes += 1;
        if (r.contacto_nuevo) resumen.clientes_nuevos += 1;
        if (r.opt_out) resumen.bajas += 1;
      } else {
        const { error } = await admin.rpc("eos_wa_actualizar_estado_v177", {
          p_canal_id: canal.id,
          p_mensaje_id: null,
          p_wa_message_id: item.wa_message_id,
          p_estado: item.estado,
          p_motivo: item.motivo,
        });

        if (error) throw error;
        resumen.estados += 1;
      }
    } catch (error) {
      // Uno que falla no puede dejar sin registrar a los demás.
      resumen.errores += 1;
      console.error("WhatsApp empresa: no se pudo registrar un evento entrante:", error);
    }
  }

  return resumen;
}
