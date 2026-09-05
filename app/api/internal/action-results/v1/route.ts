import { NextResponse } from "next/server";

import { adminSinTipos } from "@/lib/supabase/sin-tipos";
import { autorizadoComoWorker } from "@/lib/worker-gate-handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Cerrar un comando: decir cómo terminó, presentando el lease.
 *
 * ============================================================
 * LA OTRA MITAD DE LO QUE FALTABA
 * ============================================================
 *
 * Es el par de `action-claims/v1`: uno toma la orden, este la cierra. Tampoco
 * existía, así que aunque el claim hubiera funcionado, la rama FILE no tenía
 * dónde dejar el resultado.
 *
 * La función `eos_finalize_action_command_v70` ya estaba en la base, con todo
 * su fencing. Exige tres cosas juntas —`command_id`, `lease_token` y
 * `attempt_count`— y rechaza el cierre si no coinciden con el intento vivo:
 * es lo que impide que un intento viejo que se había colgado vuelva de entre
 * los muertos y pise el resultado del intento bueno.
 *
 * ============================================================
 * CERRAR DOS VECES IGUAL NO ES UN ERROR; CON OTRA COSA, SÍ
 * ============================================================
 *
 * Si el mismo intento cierra dos veces con el MISMO resultado, la función
 * responde `idempotent: true` y no cambia nada: es un reintento de red y no
 * hay nada que arreglar.
 *
 * Si cierra dos veces con resultados DISTINTOS, levanta
 * `EOS_ACTION_TERMINAL_CONFLICT`, y eso sí es grave: significa que el sistema
 * produjo dos verdades para la misma orden. Se devuelve 409 y no se elige una.
 */

/** Los únicos estados con los que se puede cerrar. Los valida también la base. */
const TERMINALES = new Set(["completada", "error", "no_disponible", "cancelada"]);

function noStoreHeaders() {
  return { "Cache-Control": "private, no-store, max-age=0", Vary: "Authorization" };
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  );
}

function respond(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: noStoreHeaders() });
}

function mapearError(error: unknown) {
  const mensaje =
    error && typeof error === "object" && "message" in error
      ? String((error as { message?: unknown }).message || "")
      : "";

  const tabla: [string, number, string][] = [
    ["EOS_ACTION_FINISH_ARGUMENTS_REQUIRED", 400, "Faltan datos para cerrar la orden."],
    ["EOS_ACTION_INVALID_TERMINAL_STATE", 400, "Ese no es un estado con el que se pueda cerrar."],
    ["EOS_ACTION_COMMAND_NOT_FOUND", 404, "La orden no existe."],
    // El intento que quiere cerrar ya no es el vivo: se colgó y otro tomó la
    // posta. Dejarlo cerrar pisaría el resultado bueno.
    ["EOS_ACTION_STALE_ATTEMPT", 409, "Este intento ya no es el vigente."],
    ["EOS_ACTION_COMMAND_NOT_AUTHORIZED", 409, "La orden no fue autorizada."],
    ["EOS_ACTION_COMMAND_NOT_CLAIMED", 409, "La orden no fue tomada antes de cerrarse."],
    ["EOS_ACTION_TERMINAL_CONFLICT", 409, "La orden ya había cerrado con otro resultado."],
    ["EOS_ACTION_COMMAND_NOT_EXECUTABLE", 409, "La orden no está en curso."],
  ];

  for (const [codigo, status, texto] of tabla) {
    if (mensaje.includes(codigo)) return respond({ ok: false, code: codigo, error: texto }, status);
  }
  return null;
}

function objeto(valor: unknown): Record<string, unknown> {
  return valor && typeof valor === "object" && !Array.isArray(valor)
    ? (valor as Record<string, unknown>)
    : {};
}

function textoOpcional(valor: unknown): string | null {
  return typeof valor === "string" && valor.trim() ? valor.trim().slice(0, 500) : null;
}

export async function POST(request: Request) {
  try {
    const autorizacion = autorizadoComoWorker(request);

    if (autorizacion.unavailable) {
      return respond({ ok: false, error: "Worker gate no configurado." }, 503);
    }
    if (!autorizacion.ok) {
      return respond({ ok: false, error: "No autorizado." }, 401);
    }

    const body = objeto(await request.json().catch(() => null));

    const commandId = body.command_id;
    const leaseToken = body.lease_token;
    const intento = Number(body.attempt_count);
    const estado = typeof body.estado === "string" ? body.estado.trim() : "";

    if (!isUuid(commandId)) return respond({ ok: false, error: "command_id inválido." }, 400);
    if (!isUuid(leaseToken)) return respond({ ok: false, error: "lease_token inválido." }, 400);
    if (!Number.isInteger(intento) || intento < 1) {
      return respond({ ok: false, error: "attempt_count inválido." }, 400);
    }
    if (!TERMINALES.has(estado)) {
      return respond({ ok: false, error: "estado terminal inválido." }, 400);
    }

    const { data, error } = await adminSinTipos().rpc("eos_finalize_action_command_v70", {
      p_command_id: commandId,
      p_lease_token: leaseToken,
      p_attempt_count: intento,
      p_estado: estado,
      p_resultado: objeto(body.resultado),
      p_error_code: textoOpcional(body.error_code),
      p_error_message: textoOpcional(body.error_message),
    });

    if (error) {
      const mapeado = mapearError(error);
      if (mapeado) return mapeado;

      console.error("Action results: error de RPC:", error);
      return respond({ ok: false, error: "No fue posible cerrar la orden." }, 500);
    }

    // Devuelve una tabla de una fila.
    const fila = Array.isArray(data) ? data[0] : data;

    if (!fila || !isUuid((fila as Record<string, unknown>).command_id)) {
      console.error("Action results: la función devolvió una fila inválida.");
      return respond({ ok: false, error: "El cierre devolvió una respuesta inválida." }, 500);
    }

    const r = fila as Record<string, unknown>;

    return respond({
      ok: true,
      command_id: r.command_id,
      estado: r.estado,
      idempotent: r.idempotent === true,
      resultado: r.resultado ?? {},
      completed_at: r.completed_at ?? null,
    });
  } catch (error) {
    console.error("Action results: error inesperado:", error);
    return respond({ ok: false, error: "No fue posible cerrar la orden." }, 500);
  }
}
