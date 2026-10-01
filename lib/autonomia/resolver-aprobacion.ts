/**
 * Aprobar o rechazar una acción que quedó esperando, desde cualquier canal.
 *
 * Hasta el 01/10/2026 esto vivía solo en la ruta del panel
 * (`app/api/autonomy/approvals/[id]`). WhatsApp necesita EXACTAMENTE lo mismo
 * —marcar la decisión una sola vez, revalidar con el Worker Gate, consumir la
 * aprobación y ejecutar el efecto—, así que se sacó acá para que los dos
 * canales no puedan diferir. La ruta del panel conserva sus respuestas.
 *
 * Garantías, en orden:
 *   1. La aprobación es de ESA persona (`usuario_id` en cada consulta).
 *   2. Vencida no se aprueba ni se rechaza.
 *   3. `pending → approved|rejected` se hace con `.eq("status", "pending")`:
 *      dos "sí" a la vez, o un reenvío del canal, no la aprueban dos veces.
 *   4. Se asienta la autorización ANTES de ejecutar: si la ejecución falla,
 *      la autorización igual ocurrió y queda probada.
 *   5. Ejecutar pasa por el Worker Gate, que consume la aprobación de forma
 *      atómica: una aprobación no ejecuta dos efectos.
 */

export type Decision = "approved" | "rejected";

export type FilaAprobacion = {
  id: string;
  usuario_id: string;
  request_id: string;
  accion: string;
  status: string;
  reason?: string | null;
  risk_tier?: number | null;
  risk_points?: number | null;
  effective_level?: number | null;
  payload_snapshot: unknown;
  expires_at: string;
  decided_at?: string | null;
  command_id?: string | null;
};

export const COLUMNAS_APROBACION =
  "id,usuario_id,request_id,accion,status,reason,risk_tier,risk_points,effective_level,payload_snapshot,expires_at,decided_at,command_id";

export type EntradaAuditoria = {
  usuarioId: string;
  evento: "accion_autorizada" | "accion_rechazada";
  origen: "panel" | "chat";
  resumen: string;
  referencia: string;
  detalle: Record<string, unknown>;
};

/** Lo mínimo del cliente de Supabase que hace falta (y que las pruebas simulan). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ClienteAprobaciones = { from: (tabla: string) => any };

export type Dependencias = {
  cliente: ClienteAprobaciones;
  auditar: (entrada: EntradaAuditoria) => Promise<unknown>;
  fetch?: typeof fetch;
  env?: Record<string, string | undefined>;
  ahora?: () => number;
};

export type ResultadoAprobacion =
  | { tipo: "no_encontrada" }
  | { tipo: "error_lectura" }
  | { tipo: "vencida"; approval: FilaAprobacion }
  | { tipo: "ya_resuelta"; approval: FilaAprobacion }
  | { tipo: "rechazada"; approval: Record<string, unknown> }
  | { tipo: "error_decision"; decision: Decision }
  | { tipo: "sin_ejecutor"; approval: FilaAprobacion }
  | { tipo: "no_revalidada"; approval: FilaAprobacion; authorization: unknown }
  | { tipo: "no_ejecutada"; approval: FilaAprobacion; authorization: unknown; execution: unknown }
  | { tipo: "ejecutada"; approval: FilaAprobacion; authorization: unknown; execution: unknown };

export function esUuid(valor: unknown): valor is string {
  return (
    typeof valor === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(valor)
  );
}

/** La app en sí: nunca una URL de preview vieja (antes era el respaldo de la ruta del panel). */
export function baseDeLaApp(env: Record<string, string | undefined>): string {
  return (env.EOS_APP_BASE_URL || env.NEXT_PUBLIC_SITE_URL || "https://www.transtech.com.py").replace(/\/$/, "");
}

async function json(respuesta: Response): Promise<Record<string, unknown> | null> {
  return (await respuesta.json().catch(() => null)) as Record<string, unknown> | null;
}

export async function resolverAprobacion(
  datos: { usuarioId: string; id: string; decision: Decision; origen: "panel" | "chat"; canal?: string; detalle?: Record<string, unknown> },
  deps: Dependencias,
): Promise<ResultadoAprobacion> {
  const { usuarioId, id, decision, origen } = datos;
  const env = deps.env ?? process.env;
  const hacerFetch = deps.fetch ?? fetch;
  const ahora = deps.ahora ?? Date.now;
  const extra = { ...(datos.canal ? { canal: datos.canal } : {}), ...(datos.detalle ?? {}) };

  const { data: current, error: currentError } = await deps.cliente
    .from("eos_action_approvals_v12")
    .select(COLUMNAS_APROBACION)
    .eq("id", id)
    .eq("usuario_id", usuarioId)
    .maybeSingle();

  if (currentError) return { tipo: "error_lectura" };
  if (!current) return { tipo: "no_encontrada" };

  const fila = current as FilaAprobacion;
  if (new Date(fila.expires_at).getTime() <= ahora()) return { tipo: "vencida", approval: fila };

  if (decision === "rejected") {
    if (fila.status !== "pending") return { tipo: "ya_resuelta", approval: fila };

    const { data: rejected, error } = await deps.cliente
      .from("eos_action_approvals_v12")
      .update({ status: "rejected" })
      .eq("id", id)
      .eq("usuario_id", usuarioId)
      .eq("status", "pending")
      .select("id,request_id,accion,status,decided_at")
      .single();

    if (error || !rejected) return { tipo: "error_decision", decision };

    await deps.auditar({
      usuarioId,
      evento: "accion_rechazada",
      origen,
      resumen: `Rechazaste la acción ${fila.accion} que EOS había propuesto.`,
      referencia: id,
      detalle: { accion: fila.accion, riesgo: fila.risk_tier, ...extra },
    });

    return { tipo: "rechazada", approval: rejected as Record<string, unknown> };
  }

  let approval = fila;

  if (fila.status === "pending") {
    const { data: approved, error } = await deps.cliente
      .from("eos_action_approvals_v12")
      .update({ status: "approved" })
      .eq("id", id)
      .eq("usuario_id", usuarioId)
      .eq("status", "pending")
      .select(COLUMNAS_APROBACION)
      .single();

    if (error || !approved) return { tipo: "error_decision", decision };
    approval = approved as FilaAprobacion;

    await deps.auditar({
      usuarioId,
      evento: "accion_autorizada",
      origen,
      resumen: `Autorizaste la acción ${approval.accion}.`,
      referencia: id,
      detalle: {
        accion: approval.accion,
        riesgo: approval.risk_tier,
        nivel: approval.effective_level,
        request_id: approval.request_id,
        ...extra,
      },
    });
  } else if (fila.status !== "approved") {
    return { tipo: "ya_resuelta", approval: fila };
  }

  const secreto = env.EOS_WORKER_GATE_SECRET;
  if (!secreto) return { tipo: "sin_ejecutor", approval };

  const base = baseDeLaApp(env);
  const cabeceras: Record<string, string> = {
    Authorization: `Bearer ${secreto}`,
    "Content-Type": "application/json",
  };
  if (env.VERCEL_AUTOMATION_BYPASS_SECRET) {
    cabeceras["x-vercel-protection-bypass"] = env.VERCEL_AUTOMATION_BYPASS_SECRET;
  }

  const autorizacion = await hacerFetch(`${base}/api/internal/worker-authorize/v1`, {
    method: "POST",
    headers: cabeceras,
    body: JSON.stringify({
      usuario_id: usuarioId,
      request_id: approval.request_id,
      accion: approval.accion,
      payload: approval.payload_snapshot,
      conversacion_id: null,
      mensaje_id: null,
      origen: origen === "panel" ? "eos-approval-ui" : `eos-approval-${datos.canal ?? "chat"}`,
    }),
    signal: AbortSignal.timeout(20_000),
    cache: "no-store",
  });
  const authorization = await json(autorizacion);

  if (
    !autorizacion.ok ||
    authorization?.ok !== true ||
    authorization?.execute !== true ||
    !esUuid(authorization?.command_id)
  ) {
    return { tipo: "no_revalidada", approval, authorization };
  }

  const efecto = await hacerFetch(`${base}/api/internal/action-effects/v1`, {
    method: "POST",
    headers: cabeceras,
    body: JSON.stringify({ command_id: authorization.command_id }),
    signal: AbortSignal.timeout(20_000),
    cache: "no-store",
  });
  const execution = await json(efecto);

  if (!efecto.ok || execution?.ok !== true) {
    return { tipo: "no_ejecutada", approval, authorization, execution };
  }

  return { tipo: "ejecutada", approval, authorization, execution };
}
