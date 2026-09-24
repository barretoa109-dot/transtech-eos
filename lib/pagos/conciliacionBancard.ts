import {
  getBancardKeys,
  llamarBancard,
  tokenConsultaConfirmacion,
} from "../bancard.ts";

/*
 * Qué pasó de verdad con un cobro de Bancard cuando no lo sabemos.
 *
 * Hay tres formas de quedarse sin saberlo, y las tres terminaban mal:
 *
 * 1. El `charge` con tarjeta guardada se corta (timeout de 30 s, un 504 del
 *    balanceador, una respuesta que no es JSON). Bancard pudo haber cobrado.
 *    Antes eso se marcaba `rechazado` —estado terminal— o quedaba `pendiente`
 *    sin que nadie lo mirara, y al día siguiente el cron de renovaciones, que
 *    solo mira pagos `pagado`, cobraba OTRA VEZ. Resultado posible: dos cobros
 *    en la tarjeta y ningún plan acreditado.
 * 2. La notificación de Bancard llega, pero las tres verificaciones que hace
 *    `/api/pagos/bancard/confirmacion` fallan. El cobro queda `pendiente`.
 * 3. La notificación no llega nunca.
 *
 * En los tres casos el cliente pagó y sigue en Free hasta que alguien revise
 * a mano. Este módulo es el "alguien": le pregunta a Bancard por el canal
 * autenticado (get_single_buy_confirmation) y cierra la solicitud con la
 * respuesta, igual que haría el webhook.
 *
 * Lo que NO hace es adivinar: si Bancard no da una respuesta definitiva, la
 * solicitud sigue pendiente y se vuelve a preguntar en la próxima pasada.
 */

export type Veredicto = "aprobado" | "rechazado" | "desconocido";

export type ConsultaBancard = { ok: boolean; data: unknown };

type Confirmacion = {
  response?: unknown;
  response_code?: unknown;
  response_description?: unknown;
  authorization_number?: unknown;
  ticket_number?: unknown;
};

function confirmacionDe(data: unknown): Confirmacion | null {
  if (!data || typeof data !== "object") return null;
  const c = (data as { confirmation?: unknown }).confirmation;
  return c && typeof c === "object" ? (c as Confirmacion) : null;
}

/** Traduce la respuesta de get_single_buy_confirmation. Sin adivinar. */
export function interpretarConfirmacion(consulta: ConsultaBancard): Veredicto {
  if (!consulta.ok) return "desconocido";

  const c = confirmacionDe(consulta.data);
  if (!c || typeof c.response !== "string") return "desconocido";

  if (c.response === "S") {
    return String(c.response_code) === "00" ? "aprobado" : "rechazado";
  }

  return c.response === "N" ? "rechazado" : "desconocido";
}

/** El detalle que se guarda en la solicitud, igual que lo guarda el webhook. */
export function detalleDeConfirmacion(consulta: ConsultaBancard, origen: string) {
  const c = confirmacionDe(consulta.data) ?? {};
  return {
    origen,
    response: c.response ?? null,
    response_code: c.response_code ?? null,
    response_description: c.response_description ?? null,
    authorization_number: c.authorization_number ?? null,
    ticket_number: c.ticket_number ?? null,
  };
}

/**
 * ¿Una respuesta del `charge` sin `response` significa "no se cobró", o
 * "no sabemos"? Un 4xx con mensajes de Bancard es un rechazo de la API: el
 * pedido no se procesó. Todo lo demás —5xx, cuerpo que no es JSON, red— es
 * un resultado desconocido y no se puede cerrar como rechazo.
 */
export function chargeSinRespuestaEsIncierto(status: number, data: unknown): boolean {
  if (status >= 500 || status === 0) return true;
  const mensajes = (data as { messages?: unknown } | null)?.messages;
  return !Array.isArray(mensajes) || mensajes.length === 0;
}

/** Le pregunta a Bancard. Nunca lanza: un error es "no sabemos". */
export async function consultarCobroBancard(shopProcessId: string | number): Promise<ConsultaBancard> {
  try {
    const { publicKey, privateKey } = getBancardKeys();
    const respuesta = await llamarBancard("/vpos/api/0.3/single_buy/confirmations", {
      public_key: publicKey,
      operation: {
        token: tokenConsultaConfirmacion(privateKey, shopProcessId),
        shop_process_id: shopProcessId,
      },
    });
    return { ok: respuesta.ok, data: respuesta.data };
  } catch (error) {
    console.error("Bancard: no se pudo consultar el cobro", shopProcessId, error);
    return { ok: false, data: null };
  }
}

/* eslint-disable @typescript-eslint/no-explicit-any -- el cliente admin viene sin tipos, como en el resto de Bancard */
type Admin = any;

/**
 * Marca una solicitud como "cobro con resultado incierto". El cron de
 * renovaciones y el checkout la miran para no volver a cobrar encima.
 */
export async function marcarCobroIncierto(admin: Admin, solicitudId: string, motivo: string) {
  const { data } = await admin
    .from("solicitudes_pago")
    .select("metadata")
    .eq("id", solicitudId)
    .maybeSingle();

  const { error } = await admin
    .from("solicitudes_pago")
    .update({
      metadata: {
        ...((data?.metadata as Record<string, unknown> | null) ?? {}),
        cobro_incierto: true,
        cobro_incierto_motivo: motivo,
        cobro_incierto_at: new Date().toISOString(),
      },
    })
    .eq("id", solicitudId)
    .eq("estado", "pendiente");

  if (error) console.error("Bancard: no se pudo marcar el cobro incierto", solicitudId, error);
}

/** ¿Tiene este usuario un cobro que pudo haber salido y todavía no sabemos? */
export async function tieneCobroIncierto(admin: Admin, usuarioId: string, ahora = new Date()) {
  const { data, error } = await admin
    .from("solicitudes_pago")
    .select("id")
    .eq("usuario_id", usuarioId)
    .eq("proveedor", "bancard")
    .eq("estado", "pendiente")
    .eq("metadata->>cobro_incierto", "true")
    .gte("created_at", new Date(ahora.getTime() - 7 * 86_400_000).toISOString())
    .limit(1);

  // Si no se puede saber, se asume que sí: cobrar dos veces es peor que
  // demorar un día una renovación.
  if (error) return true;
  return (data ?? []).length > 0;
}

export type ResumenConciliacion = {
  revisadas: number;
  aprobadas: number;
  rechazadas: number;
  sin_respuesta: number;
  errores: number;
};

type Dependencias = {
  consultar?: (shopProcessId: string) => Promise<ConsultaBancard>;
  alAprobar?: (fila: { usuario_id: string; plan_codigo: string; id: string }, confirmado: any) => Promise<void>;
  ahora?: Date;
  /** No se toca lo que tiene menos de esto: el webhook todavía puede llegar. */
  minutosDeGracia?: number;
  limite?: number;
  /** Conciliar solo esta solicitud (la que está mirando el usuario). */
  referencia?: string;
};

/**
 * Cierra los cobros de Bancard que quedaron pendientes: pregunta a Bancard
 * uno por uno y confirma con la misma RPC que usa el webhook, que es
 * idempotente (si el webhook llega después, no acredita dos veces).
 */
export async function conciliarPendientesBancard(
  admin: Admin,
  {
    consultar = consultarCobroBancard,
    alAprobar,
    ahora = new Date(),
    minutosDeGracia = 10,
    limite = 50,
    referencia,
  }: Dependencias = {},
): Promise<ResumenConciliacion> {
  const resumen: ResumenConciliacion = { revisadas: 0, aprobadas: 0, rechazadas: 0, sin_respuesta: 0, errores: 0 };

  let consulta = admin
    .from("solicitudes_pago")
    .select("id,usuario_id,plan_codigo,referencia_externa")
    .eq("proveedor", "bancard")
    .eq("estado", "pendiente")
    .not("referencia_externa", "is", null)
    .lte("created_at", new Date(ahora.getTime() - minutosDeGracia * 60_000).toISOString())
    .gte("created_at", new Date(ahora.getTime() - 7 * 86_400_000).toISOString());

  if (referencia) consulta = consulta.eq("referencia_externa", referencia);

  const { data: pendientes, error } = await consulta
    .order("created_at", { ascending: true })
    .limit(limite);

  if (error) {
    console.error("Bancard: no se pudieron listar los cobros pendientes:", error);
    resumen.errores += 1;
    return resumen;
  }

  for (const fila of (pendientes ?? []) as Array<{
    id: string;
    usuario_id: string;
    plan_codigo: string;
    referencia_externa: string;
  }>) {
    resumen.revisadas += 1;

    try {
      const respuesta = await consultar(String(fila.referencia_externa));
      const veredicto = interpretarConfirmacion(respuesta);

      if (veredicto === "desconocido") {
        resumen.sin_respuesta += 1;
        continue;
      }

      const { data: confirmado, error: errorConfirmar } = await admin.rpc(
        "eos_bancard_confirmar_cobro_v51",
        {
          p_shop_process_id: String(fila.referencia_externa),
          p_aprobado: veredicto === "aprobado",
          p_detalle: detalleDeConfirmacion(respuesta, "conciliacion_bancard"),
        },
      );

      if (errorConfirmar) {
        console.error("Bancard: la conciliación no pudo confirmar", fila.referencia_externa, errorConfirmar);
        resumen.errores += 1;
        continue;
      }

      if (veredicto === "aprobado") {
        resumen.aprobadas += 1;
        if (confirmado?.idempotent === false && alAprobar) {
          await alAprobar(fila, confirmado).catch((e) =>
            console.error("Bancard: conciliado, pero falló el aviso al usuario", fila.id, e),
          );
        }
      } else {
        resumen.rechazadas += 1;
      }
    } catch (e) {
      console.error("Bancard: error conciliando", fila.referencia_externa, e);
      resumen.errores += 1;
    }
  }

  return resumen;
}
