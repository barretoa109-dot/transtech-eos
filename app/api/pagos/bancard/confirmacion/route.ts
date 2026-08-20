import { timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { getBancardKeys, tokenConfirmacionEsperado } from "@/lib/bancard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
 * Endpoint público que Bancard invoca para confirmar una transacción
 * (single_buy_confirm). Es la única fuente confiable del resultado final
 * de un pago, así que se procesa incluso si el charge ya se confirmó en
 * línea: la RPC de confirmación es idempotente.
 *
 * Al ser público, la autenticidad se valida recalculando el token que
 * Bancard firma con nuestra clave privada. Sin esa verificación,
 * cualquiera que conozca la URL podría activar planes gratis.
 */

function comparacionSegura(a: string, b: string) {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);

  if (bufferA.length !== bufferB.length) return false;

  return timingSafeEqual(bufferA, bufferB);
}

function respuestaOk() {
  // Bancard espera exactamente {"status":"success"} con HTTP 200.
  return NextResponse.json({ status: "success" });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as any;
    const operacion = body?.operation;

    if (!operacion || typeof operacion !== "object") {
      return NextResponse.json({ status: "error" }, { status: 400 });
    }

    const shopProcessId = String(operacion.shop_process_id || "").trim();
    const tokenRecibido = String(operacion.token || "").trim();
    const monto = operacion.amount;
    const moneda = String(operacion.currency || "PYG").trim();

    if (!shopProcessId || !tokenRecibido || monto === undefined || monto === null) {
      return NextResponse.json({ status: "error" }, { status: 400 });
    }

    const { privateKey } = getBancardKeys();

    let tokenEsperado: string;

    try {
      tokenEsperado = tokenConfirmacionEsperado(
        privateKey,
        shopProcessId,
        monto,
        moneda,
      );
    } catch {
      return NextResponse.json({ status: "error" }, { status: 400 });
    }

    if (!comparacionSegura(tokenRecibido.toLowerCase(), tokenEsperado)) {
      console.error(
        "Bancard: confirmación con token inválido para shop_process_id",
        shopProcessId,
        JSON.stringify({ esperado: tokenEsperado, operacion }),
      );

      return NextResponse.json({ status: "error" }, { status: 401 });
    }

    const aprobado =
      operacion.response === "S" && String(operacion.response_code) === "00";

    const admin: any = createAdminClient();

    const { error } = await admin.rpc("eos_bancard_confirmar_cobro_v51", {
      p_shop_process_id: shopProcessId,
      p_aprobado: aprobado,
      p_detalle: {
        origen: "webhook_bancard",
        response: operacion.response ?? null,
        response_code: operacion.response_code ?? null,
        response_description: operacion.response_description ?? null,
        authorization_number: operacion.authorization_number ?? null,
        ticket_number: operacion.ticket_number ?? null,
      },
    });

    if (error) {
      const detalle = String(error?.message || "");

      /*
       * Si la solicitud no existe, responder 200 igual: reintentar no va
       * a cambiar nada y Bancard marcaría la confirmación como fallida.
       * Queda el log para investigar.
       */
      if (detalle.includes("EOS_BANCARD_REQUEST_NOT_FOUND")) {
        console.error(
          "Bancard: confirmación de una solicitud inexistente:",
          shopProcessId,
        );

        return respuestaOk();
      }

      console.error("Bancard: error confirmando cobro desde webhook:", error);

      return NextResponse.json({ status: "error" }, { status: 500 });
    }

    return respuestaOk();
  } catch (error) {
    console.error("Bancard: error inesperado en confirmación:", error);

    return NextResponse.json({ status: "error" }, { status: 500 });
  }
}
