import { NextResponse } from "next/server";
import { CODIGOS_DE_NEGOCIO, errorDeAccion, errorDeLaBase } from "@/lib/eos/errores-accion";

import { adminSinTipos } from "@/lib/supabase/sin-tipos";
import { autorizadoComoWorker } from "@/lib/seguridad/worker-bearer";
import { paraRegistro } from "@/lib/seguridad/registro";
import { enviarDesdeElChat } from "@/lib/whatsapp-crm/envio-por-chat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function noStoreHeaders() {
  return {
    "Cache-Control": "private, no-store, max-age=0",
    Vary: "Authorization",
  };
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}



function respond(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: noStoreHeaders() });
}

/**
 * Cerrar la orden cuando la regla de negocio dijo que no.
 *
 * ============================================================
 * POR QUÉ LA AUDITORÍA DECÍA "TIMEOUT" Y NO EL MOTIVO
 * ============================================================
 *
 * `eos_execute_internal_effect_v64` levanta una excepción cuando no puede
 * resolver el producto, cuando falta el módulo o cuando la venta viene sin
 * ítems. La excepción tira abajo TODO lo que la función hizo —incluido el
 * `estado = 'ejecutando'` que había escrito— y nadie la cierra.
 *
 * La orden queda abierta hasta que, quince minutos después, un barrido la
 * marca `ACTION_TIMEOUT: la ejecución no confirmó un resultado`.
 *
 * Eso fue exactamente lo que se vio el 9 de septiembre de 2026 en las órdenes
 * de una usuaria: cuatro REGISTRAR_VENTA en error, las cuatro con
 * ACTION_TIMEOUT, ninguna con el motivo real —que era que el producto no
 * estaba en el catálogo—. La única traza durable del incidente decía otra
 * cosa que lo que había pasado, y mandaba a buscar un problema de red.
 *
 * Cerrar acá no cambia lo que ve el usuario: el 422 con su explicación sale
 * igual y sale antes. Cambia lo que queda escrito, que es de dónde sale el
 * diagnóstico la próxima vez.
 */
async function cerrarConMotivo(
  admin: ReturnType<typeof adminSinTipos>,
  commandId: string,
  codigo: string,
  mensaje: string,
) {
  const { error } = await admin.rpc("eos_finalize_action_command_v66", {
    p_command_id: commandId,
    p_estado: "error",
    p_resultado: {},
    p_error_code: codigo.slice(0, 80),
    p_error_message: mensaje.slice(0, 500),
  });

  if (error) {
    // No se corta la respuesta por esto: la persona ya tiene su motivo y la
    // orden, en el peor caso, la cierra el barrido de siempre.
    console.error("Worker effect executor: no se pudo cerrar la orden fallida:", error);
  }
}

function mapRpcError(error: unknown) {
  const message =
    error && typeof error === "object" && "message" in error
      ? String((error as { message?: unknown }).message || "")
      : "";

  /*
   * Las reglas de negocio primero: no encontré el producto, no encontré el
   * contacto, falta el módulo. Son seis, y hasta el 7 de septiembre de 2026
   * las seis caían al 500 genérico de más abajo — que es la razón por la que
   * el chat decía "no pude completar la acción" sin decir nunca por qué.
   * Ver `lib/eos/errores-accion.ts`.
   */
  const negocio = errorDeAccion(message);

  if (negocio) {
    return respond(
      { ok: false, code: negocio.codigo, error: negocio.mensaje },
      negocio.estado,
    );
  }

  if (message.includes("EOS_INTERNAL_EFFECT_COMMAND_NOT_FOUND")) {
    return respond(
      {
        ok: false,
        code: "EOS_INTERNAL_EFFECT_COMMAND_NOT_FOUND",
        error: "La orden no existe.",
      },
      404,
    );
  }

  if (message.includes("EOS_INTERNAL_EFFECT_NOT_AUTHORIZED")) {
    return respond(
      {
        ok: false,
        code: "EOS_INTERNAL_EFFECT_NOT_AUTHORIZED",
        error: "La orden no fue autorizada por Worker Gate.",
      },
      403,
    );
  }

  if (message.includes("EOS_INTERNAL_EFFECT_UNSUPPORTED_ACTION")) {
    return respond(
      {
        ok: false,
        code: "EOS_INTERNAL_EFFECT_UNSUPPORTED_ACTION",
        error: "La acción no pertenece al ejecutor interno.",
      },
      400,
    );
  }

  if (message.includes("EOS_ACTION_AUTONOMY_DISABLED")) {
    return respond(
      {
        ok: false,
        code: "EOS_ACTION_AUTONOMY_DISABLED",
        error: "La autonomía está desactivada para este usuario.",
      },
      409,
    );
  }

  if (message.includes("EOS_ACTION_RULE_DISABLED")) {
    return respond(
      {
        ok: false,
        code: "EOS_ACTION_RULE_DISABLED",
        error: "La regla de autonomía está desactivada para esta acción.",
      },
      409,
    );
  }

  if (message.includes("EOS_ACTION_CONTEXT_STALE")) {
    return respond(
      {
        ok: false,
        code: "EOS_ACTION_CONTEXT_STALE",
        error: "El Contexto Maestro debe actualizarse antes de ejecutar esta acción.",
      },
      409,
    );
  }

  if (
    message.includes("EOS_INTERNAL_EFFECT_COMMAND_NOT_EXECUTABLE") ||
    message.includes("EOS_INTERNAL_EFFECT_GOAL_FAILED") ||
    message.includes("EOS_INTERNAL_EFFECT_GOAL_ID_MISSING")
  ) {
    const code = message.includes("EOS_INTERNAL_EFFECT_COMMAND_NOT_EXECUTABLE")
      ? "EOS_INTERNAL_EFFECT_COMMAND_NOT_EXECUTABLE"
      : message.includes("EOS_INTERNAL_EFFECT_GOAL_FAILED")
        ? "EOS_INTERNAL_EFFECT_GOAL_FAILED"
        : "EOS_INTERNAL_EFFECT_GOAL_ID_MISSING";

    return respond(
      {
        ok: false,
        code,
        error: "La orden no pudo ejecutarse de forma segura.",
      },
      409,
    );
  }

  /*
   * Lo que rompe una regla de la BASE, no una del negocio.
   *
   * Una clave foránea que no existe, un `check` que no se cumple, un único
   * duplicado. Hasta hoy los tres caían al 500 genérico —"No fue posible
   * ejecutar el efecto interno."— sin código y sin motivo, y desde afuera eran
   * indistinguibles de que el servidor se hubiera caído.
   *
   * Costó veinte minutos de diagnóstico encontrar que una prueba fallaba por
   * un `conversacion_id` que no existía. Para una persona usando el chat,
   * habría sido imposible.
   *
   * Lo que cambia NO es que se le muestre el detalle de la base: eso puede
   * traer datos de otra fila y no le dice nada a nadie. Lo que cambia es la
   * única distinción que sí le sirve: **esto no es culpa de lo que escribiste**.
   * Con eso, en vez de reformular la frase diez veces, sabe que hay que
   * avisar. El detalle queda en el log, que es donde se puede leer entero.
   */
  const sqlstate =
    error && typeof error === "object" && "code" in error
      ? String((error as { code?: unknown }).code || "")
      : "";

  const deLaBase = errorDeLaBase(sqlstate);

  if (deLaBase) {
    // El detalle entero al log, que es donde se puede leer sin riesgo.
    console.error("Worker effect executor: la base rechazó la orden", {
      sqlstate,
      detalle: paraRegistro(error),
    });

    return respond(
      { ok: false, code: deLaBase.codigo, error: deLaBase.mensaje },
      deLaBase.estado,
    );
  }

  return null;
}

export async function POST(request: Request) {
  try {
    const authorization = autorizadoComoWorker(request);

    if (authorization.unavailable) {
      return respond(
        { ok: false, error: "Worker effect executor no configurado." },
        503,
      );
    }

    if (!authorization.ok) {
      return respond({ ok: false, error: "No autorizado." }, 401);
    }

    const body = await request.json().catch(() => null);
    const commandId = body?.command_id;

    if (!isUuid(commandId)) {
      return respond({ ok: false, error: "command_id inválido." }, 400);
    }

    const admin = adminSinTipos();
    const { data, error } = await admin.rpc(
      "eos_execute_internal_effect_v64",
      { p_command_id: commandId },
    );

    if (error) {
      const mapped = mapRpcError(error);

      if (mapped) {
        /*
         * La orden se cierra con SU motivo antes de contestar.
         *
         * Sin esto queda en el aire y a los quince minutos la audita un
         * barrido como ACTION_TIMEOUT — un motivo que no es el que pasó.
         */
        const cuerpoMapeado = (await mapped.clone().json().catch(() => null)) as
          | { code?: unknown; error?: unknown }
          | null;

        /*
         * El reintento de n8n no le tapa el motivo a la persona.
         *
         * El nodo que llama acá reintenta ante cualquier respuesta que no sea
         * 2xx. El primer intento devuelve el 422 con la explicación y cierra la
         * orden en `error`; el segundo la encuentra cerrada y contestaba
         * "la orden no pudo ejecutarse de forma segura", que era lo único que
         * llegaba al chat. Se vio el 18 de septiembre de 2026 al probar
         * ANULAR_COMPRA, y pasaba con todos los verbos.
         *
         * Si la orden ya está cerrada con un motivo de negocio, se lo repite:
         * es la misma respuesta que ya se dio, no una nueva.
         */
        if (cuerpoMapeado?.code === "EOS_INTERNAL_EFFECT_COMMAND_NOT_EXECUTABLE") {
          const { data: cerrada } = await admin
            .from("eos_action_commands")
            .select("estado, error_code, error_message")
            .eq("id", commandId)
            .maybeSingle();

          if (
            cerrada?.estado === "error" &&
            typeof cerrada.error_message === "string" &&
            cerrada.error_message &&
            CODIGOS_DE_NEGOCIO.includes(String(cerrada.error_code))
          ) {
            return respond(
              { ok: false, code: cerrada.error_code, error: cerrada.error_message },
              422,
            );
          }
        }

        await cerrarConMotivo(
          admin,
          commandId,
          String(cuerpoMapeado?.code ?? "EOS_INTERNAL_EFFECT_RECHAZADO"),
          String(cuerpoMapeado?.error ?? "La regla de negocio rechazó la orden."),
        );

        return mapped;
      }

      console.error("Worker effect executor RPC error:", error);
      return respond(
        { ok: false, error: "No fue posible ejecutar el efecto interno." },
        500,
      );
    }

    const effect = Array.isArray(data) ? data[0] || null : data;

    if (!effect || !isUuid(effect.command_id) || !isUuid(effect.effect_id)) {
      // Sin el payload: la fila trae adentro lo que el usuario pidió hacer.
      console.error("Worker effect executor returned an invalid row:", paraRegistro(effect));
      return respond(
        { ok: false, error: "El ejecutor devolvió una respuesta inválida." },
        500,
      );
    }

    let resultado: Record<string, unknown> = effect.resultado ?? {};

    /*
     * Escribirle a un cliente (v186): el ejecutor de la base validó; el ENVÍO es de acá.
     *
     * Se hace también cuando la orden ya estaba completada (`idempotent`): si el primer
     * intento murió entre validar y enviar, este es el que lo termina. No duplica nada
     * porque la clave del envío es el id de la orden y `enviarPorCanal` la respeta.
     *
     * Que el envío salga mal NO cambia el `ok` de la orden —el ejecutor cumplió lo suyo—
     * pero SÍ queda dicho en `resultado.envio`, que es lo que la respuesta le cuenta a la
     * persona. Nunca se afirma un envío que no se confirmó.
     */
    if (effect.accion === "ENVIAR_WHATSAPP_CLIENTE") {
      const { data: orden } = await admin
        .from("eos_action_commands")
        .select("usuario_id")
        .eq("id", effect.command_id)
        .maybeSingle();

      const usuarioId = typeof orden?.usuario_id === "string" ? orden.usuario_id : null;

      const envio = usuarioId
        ? await enviarDesdeElChat(admin, { usuarioId, commandId: effect.command_id, resultado })
        : ({ estado: "pendiente", motivo: "No pude confirmar de quién era la orden." } as const);

      resultado = { ...resultado, envio };
    }

    return respond({
      ok: true,
      command_id: effect.command_id,
      accion: effect.accion,
      effect_type: effect.effect_type,
      effect_id: effect.effect_id,
      idempotent: effect.idempotent === true,
      estado: effect.estado,
      resultado,
    });
  } catch (error) {
    console.error("Worker effect executor unexpected error:", error);
    return respond(
      { ok: false, error: "Error interno del ejecutor de efectos." },
      500,
    );
  }
}
