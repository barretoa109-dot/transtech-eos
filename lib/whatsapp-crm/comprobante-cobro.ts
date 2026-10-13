import { randomUUID } from "node:crypto";

import type { ClienteSinTipos } from "../supabase/sin-tipos.ts";
import { descargarBytes } from "../whatsapp/descargar-bytes.ts";
import { enviarTextoConId } from "../whatsapp/enviar.ts";
import { textoDeAprobaciones, type AprobacionPendiente } from "../whatsapp/aprobacion.ts";
import { configDelWorker, ejecutarJob } from "../gateway/worker.ts";
import type { Job } from "../gateway/jobs.ts";
import { comprobanteIaHabilitada, leerComprobante } from "./comprobante.ts";

/**
 * Un comprobante de transferencia que llegó al WhatsApp del negocio, de
 * imagen a propuesta de cobro.
 *
 * ============================================================
 * EL CAMINO, EN UNA FRASE
 * ============================================================
 *
 * Foto del cliente → se lee el monto → se busca a qué venta pendiente
 * corresponde → si hay UNA sola candidata clara, se arma un REGISTRAR_COBRO
 * y se manda por el mismo camino de siempre (`ejecutarJob`) → el Worker Gate
 * decide, como con cualquier otra acción. Si pide aprobación —lo normal para
 * plata entrando de un comprobante que nadie verificó—, se le avisa al dueño
 * por SU WhatsApp con el mecanismo que ya existe (PR #223): "sí"/"no".
 *
 * ============================================================
 * POR QUÉ NO SE INVENTA OTRO MECANISMO DE APROBACIÓN
 * ============================================================
 *
 * Ya hay uno, probado, con auditoría y vencimiento
 * (`eos_action_approvals_v12` + `resolverAprobacion`). Un mecanismo nuevo acá
 * sería una segunda puerta con sus propios agujeros. Esto solo CREA el
 * comando y lo manda por la puerta de siempre; quien decide si hace falta
 * aprobar sigue siendo el Worker Gate, no esta función.
 *
 * ============================================================
 * CUÁNDO NO SE PROPONE NADA
 * ============================================================
 *
 * - `EOS_COMPROBANTE_IA` apagada: la foto se registra como siempre, sin leer.
 * - La imagen no parece un comprobante: no se inventa un monto.
 * - El cliente no tiene ninguna venta pendiente, o tiene MÁS DE UNA: no se
 *   elige una al azar (mismo criterio que el resto del sistema: con algo
 *   dicho que no matchea una sola cosa, no se cae a "la más reciente"). Se
 *   le avisa igual al dueño, con lo que se leyó, para que decida a mano.
 * - El dueño no tiene un WhatsApp propio vinculado a EOS, o nunca le escribió
 *   (sin `conversacion_id` no hay dónde anclar el "sí" de después): se deja
 *   sin avisar por WhatsApp; la aprobación igual queda visible en
 *   /eos/autonomy si el comando llegó a crearse.
 */

export type ContextoComprobante = {
  usuarioId: string;
  contactoId: string;
  nombreContacto: string;
  mediaId: string;
  mimeType: string;
  /** Para sumar el costo de leer la imagen al consumo del dueño del canal. */
  alCosto?: (usd: number) => void;
};

/** Las ventas pendientes de un contacto, de sólo lectura (v245). */
async function ventasPendientes(
  admin: ClienteSinTipos,
  usuarioId: string,
  contactoId: string,
): Promise<{ venta_id: string; total: number; saldo: number; moneda: string; fecha: string }[]> {
  const { data, error } = await admin.rpc("eos_erp_ventas_pendientes_v245", {
    p_usuario_id: usuarioId,
    p_contacto_id: contactoId,
  });
  if (error) {
    console.error("Comprobante: no se pudieron leer las ventas pendientes:", error);
    return [];
  }
  return (data ?? []) as { venta_id: string; total: number; saldo: number; moneda: string; fecha: string }[];
}

/** El teléfono y la conversación del DUEÑO (no del cliente), para avisarle. */
async function datosDelDueno(
  admin: ClienteSinTipos,
  usuarioId: string,
): Promise<{ telefono: string; conversacionId: string } | null> {
  const { data } = await admin
    .from("eos_whatsapp_vinculos_v162")
    .select("telefono, conversacion_id")
    .eq("usuario_id", usuarioId)
    .maybeSingle();

  const telefono = (data as { telefono?: string | null } | null)?.telefono;
  const conversacionId = (data as { conversacion_id?: string | null } | null)?.conversacion_id;
  if (!telefono || !conversacionId) return null;
  return { telefono, conversacionId };
}

/** Las aprobaciones pendientes del dueño, igual consulta que usa el webhook de EOS. */
async function pendientesDeAprobacion(admin: ClienteSinTipos, usuarioId: string): Promise<AprobacionPendiente[]> {
  const { data, error } = await admin
    .from("eos_action_approvals_v12")
    .select("id,accion,payload_snapshot,expires_at")
    .eq("usuario_id", usuarioId)
    .eq("status", "pending")
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) {
    console.error("Comprobante: no se pudieron leer las aprobaciones pendientes:", error);
    return [];
  }
  return (data ?? []) as AprobacionPendiente[];
}

/** Le avisa al dueño por SU WhatsApp, y deja la marca para que su "sí" la encuentre. */
async function avisarAlDueno(admin: ClienteSinTipos, usuarioId: string, texto: string): Promise<void> {
  const datos = await datosDelDueno(admin, usuarioId);
  if (!datos) {
    console.error("Comprobante: el dueño no tiene WhatsApp vinculado; la aprobación queda solo en /eos/autonomy.");
    return;
  }

  const { ok } = await enviarTextoConId(datos.telefono, texto);
  if (!ok) {
    console.error("Comprobante: no se pudo avisar al dueño por WhatsApp.");
    return;
  }

  // La misma fila que guardarTurno usa para la mitad "eos": sin la mitad
  // "usuario" porque esto no responde ningún mensaje del dueño, lo inicia.
  const { error } = await admin.from("mensajes").insert([
    {
      conversacion_id: datos.conversacionId,
      usuario_id: usuarioId,
      rol: "eos",
      texto,
      origen: "whatsapp",
      metadata: {},
    },
  ]);
  if (error) console.error("Comprobante: el aviso se mandó pero no se guardó en el historial:", error);
}

/**
 * Procesa UN comprobante ya leído. No lanza: un comprobante que no se puede
 * procesar queda como una foto más en el CRM, no tira el webhook.
 */
export async function procesarComprobante(admin: ClienteSinTipos, ctx: ContextoComprobante): Promise<void> {
  if (!comprobanteIaHabilitada()) return;

  try {
    const bajado = await descargarBytes(ctx.mediaId, ctx.mimeType);
    if (!bajado) return;

    const dataUrl = `data:${bajado.tipo};base64,${bajado.bytes.toString("base64")}`;
    const leido = await leerComprobante(dataUrl, { alCosto: ctx.alCosto });
    if (!leido) return;

    const pendientes = await ventasPendientes(admin, ctx.usuarioId, ctx.contactoId);
    const monto = new Intl.NumberFormat("es-PY").format(leido.monto);

    if (pendientes.length !== 1) {
      const motivo =
        pendientes.length === 0
          ? "no le encontré ninguna venta pendiente"
          : `tiene ${pendientes.length} ventas pendientes y no sé a cuál corresponde`;
      await avisarAlDueno(
        admin,
        ctx.usuarioId,
        `${ctx.nombreContacto} mandó un comprobante de ₲ ${monto}, pero ${motivo}. Decime vos a cuál aplicarlo, o cargalo desde Negocio > Ventas.`,
      );
      return;
    }

    const config = configDelWorker();
    const requestId = randomUUID();
    const job: Job = {
      request_id: requestId,
      usuario_id: ctx.usuarioId,
      usuario_id_original: ctx.usuarioId,
      usuario_key: ctx.usuarioId,
      conversacion_id: randomUUID(),
      nombre: ctx.nombreContacto,
      plan: "pro",
      origen: "whatsapp-crm-comprobante",
      mensaje: `Comprobante recibido por WhatsApp de ${ctx.nombreContacto}: ₲ ${monto}.`,
      respuesta_gateway: "",
      accion: {
        tipo: "REGISTRAR_COBRO",
        datos: { cliente: ctx.nombreContacto, monto: leido.monto, fecha: leido.fecha ?? undefined },
      },
      action_index: 0,
      action_count: 1,
      worker_path: "eos-worker-rc1-internal",
      sin_acciones: false,
      historial: [],
      metadata: { plan: "pro", origen: "whatsapp-crm-comprobante", tiene_archivo: true },
      received_at: new Date().toISOString(),
    };

    const resultado = (await ejecutarJob(job, config)) as {
      executed?: boolean;
      decision?: string;
      command_id?: string;
    };

    if (resultado.executed) {
      await avisarAlDueno(
        admin,
        ctx.usuarioId,
        `Cobré ₲ ${monto} de ${ctx.nombreContacto}, según el comprobante que mandó por WhatsApp.`,
      );
      return;
    }

    if (resultado.decision === "approval" || resultado.decision === "approval_ready") {
      const texto = textoDeAprobaciones(await pendientesDeAprobacion(admin, ctx.usuarioId));
      if (texto) await avisarAlDueno(admin, ctx.usuarioId, texto);
      return;
    }

    // Bloqueada, vencida, o lo que sea: no se inventa un aviso. Queda en el
    // log del worker, igual que cualquier otra acción que no se pudo armar.
  } catch (error) {
    console.error("Comprobante: no se pudo procesar:", error);
  }
}
