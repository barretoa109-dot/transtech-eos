import { NextResponse } from "next/server";

import { adminSinTipos } from "@/lib/supabase/sin-tipos";
import { autorizadoComoWorker } from "@/lib/worker-gate-handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Tomar un comando para trabajarlo, con lease y fencing token.
 *
 * ============================================================
 * ESTA RUTA FALTABA, Y POR ESO NO SALÍA NINGÚN ARCHIVO
 * ============================================================
 *
 * La rama FILE del Background Worker —la que arma planillas— empieza pidiendo
 * el claim acá antes de generar nada. La ruta nunca existió en este
 * repositorio, así que la llamada moría y la rama no podía completarse por
 * ningún camino: pedir una planilla por chat no producía archivo.
 *
 * Lo que sí existía era todo lo difícil. `eos_claim_action_command_v65` está en
 * la base desde la v65, con lease, reintentos contados y token de fencing, y
 * pasó por cinco migraciones de endurecimiento (v67 a v71). Lo único que
 * faltaba era la puerta HTTP para llamarla.
 *
 * ============================================================
 * POR QUÉ UN CLAIM Y NO EJECUTAR DIRECTO
 * ============================================================
 *
 * Generar un archivo puede tardar y puede reintentarse. El lease dice "yo me
 * hago cargo de este comando durante N segundos"; el `lease_token` que
 * devuelve es la prueba que hay que presentar después para cerrarlo. Sin eso,
 * dos intentos simultáneos —uno que se colgó y su reintento— podrían cerrar el
 * mismo comando con resultados distintos, y el que llegara segundo pisaría al
 * primero.
 *
 * Toda esa lógica vive en la función de Postgres, que la resuelve con `for
 * update`. Acá no se decide nada: se autentica, se pasa el pedido y se
 * traduce el error.
 */

const LEASE_POR_DEFECTO = 300;

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

/**
 * Los errores de la función se traducen a códigos que quien llama pueda
 * distinguir.
 *
 * Un 404 y un 409 se atienden distinto: el primero es "esto no existe" y el
 * segundo es "existe pero alguien más lo tiene". Devolver 500 para los dos
 * haría que un reintento legítimo parezca una falla del sistema.
 */
function mapearError(error: unknown) {
  const mensaje =
    error && typeof error === "object" && "message" in error
      ? String((error as { message?: unknown }).message || "")
      : "";

  if (mensaje.includes("EOS_COMMAND_ID_REQUIRED")) {
    return respond({ ok: false, code: "EOS_COMMAND_ID_REQUIRED", error: "Falta el comando." }, 400);
  }
  if (mensaje.includes("EOS_COMMAND_NOT_FOUND")) {
    return respond({ ok: false, code: "EOS_COMMAND_NOT_FOUND", error: "La orden no existe." }, 404);
  }
  if (mensaje.includes("EOS_COMMAND_NOT_AUTHORIZED")) {
    // No pasó por la puerta de autonomía. Nunca se toma un comando que nadie
    // autorizó, por más que exista la fila.
    return respond(
      { ok: false, code: "EOS_COMMAND_NOT_AUTHORIZED", error: "La orden no fue autorizada." },
      409,
    );
  }
  if (mensaje.includes("EOS_COMMAND_LEASE_ACTIVE")) {
    return respond(
      { ok: false, code: "EOS_COMMAND_LEASE_ACTIVE", error: "Otro intento tiene la orden." },
      409,
    );
  }
  if (mensaje.includes("EOS_COMMAND_MAX_ATTEMPTS")) {
    return respond(
      { ok: false, code: "EOS_COMMAND_MAX_ATTEMPTS", error: "La orden agotó sus intentos." },
      409,
    );
  }
  return null;
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

    const body = await request.json().catch(() => null);
    const commandId = (body as Record<string, unknown> | null)?.command_id;

    if (!isUuid(commandId)) {
      return respond({ ok: false, error: "command_id inválido." }, 400);
    }

    /*
     * El lease se recorta acá y también en la función (30 a 900). Se hace en
     * los dos lados a propósito: la base es la que manda, y este recorte
     * evita mandarle un número absurdo desde una llamada equivocada.
     */
    const pedido = Number((body as Record<string, unknown>).lease_seconds ?? LEASE_POR_DEFECTO);
    const leaseSeconds = Number.isFinite(pedido)
      ? Math.max(30, Math.min(900, Math.trunc(pedido)))
      : LEASE_POR_DEFECTO;

    const { data, error } = await adminSinTipos().rpc("eos_claim_action_command_v65", {
      p_command_id: commandId,
      p_lease_seconds: leaseSeconds,
    });

    if (error) {
      const mapeado = mapearError(error);
      if (mapeado) return mapeado;

      console.error("Action claims: error de RPC:", error);
      return respond({ ok: false, error: "No fue posible tomar la orden." }, 500);
    }

    // La función devuelve un jsonb ya armado, con `ok`, `claimed`,
    // `lease_token` y `attempt_count`. Se pasa tal cual: reescribirlo acá
    // sería inventar una segunda versión de la verdad.
    const claim = data && typeof data === "object" && !Array.isArray(data) ? data : null;

    if (!claim) {
      console.error("Action claims: la función devolvió algo que no es un objeto.");
      return respond({ ok: false, error: "El claim devolvió una respuesta inválida." }, 500);
    }

    return respond(claim as Record<string, unknown>);
  } catch (error) {
    console.error("Action claims: error inesperado:", error);
    return respond({ ok: false, error: "No fue posible tomar la orden." }, 500);
  }
}
