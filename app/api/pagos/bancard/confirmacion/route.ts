import { after } from "next/server";
import { NextResponse } from "next/server";
import {
  describirErrorBancard,
  getBancardKeys,
  llamarBancard,
  tokenConsultaConfirmacion,
} from "@/lib/bancard";
import { adminSinTipos } from "@/lib/supabase/sin-tipos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
 * Endpoint público que Bancard invoca para confirmar una transacción.
 *
 * No confía en el cuerpo recibido. El token que Bancard envía en la
 * notificación NO se corresponde con la fórmula documentada
 * (md5(private_key + shop_process_id + "confirm" + amount + currency)):
 * se verificó contra transacciones reales y nunca coincide, así que
 * validarlo daría falsos rechazos.
 *
 * En vez de eso, la notificación se trata sólo como un aviso de "revisá
 * esta transacción", y el estado real se le pregunta a Bancard por un
 * canal autenticado con nuestras claves (get_single_buy_confirmation).
 * Eso es más fuerte que validar una firma en el request: un tercero que
 * conozca la URL no puede falsear la respuesta de Bancard.
 */

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

    if (!shopProcessId) {
      return NextResponse.json({ status: "error" }, { status: 400 });
    }

    const admin = adminSinTipos();

    // La transacción tiene que corresponder a un cobro que iniciamos.
    const { data: solicitud } = await admin
      .from("solicitudes_pago")
      .select("id,estado,monto")
      .eq("proveedor", "bancard")
      .eq("referencia_externa", shopProcessId)
      .maybeSingle();

    if (!solicitud) {
      console.error(
        "Bancard: confirmación de una solicitud inexistente:",
        shopProcessId,
      );

      // Reintentar no cambiaría nada; se responde 200 para no dejarla colgada.
      return respuestaOk();
    }

    if (solicitud.estado === "pagado" || solicitud.estado === "rechazado") {
      return respuestaOk();
    }

    /*
     * La verificación va DESPUÉS de responder. Consultar a Bancard por
     * esta misma transacción mientras Bancard espera nuestra respuesta
     * la deja bloqueada y ambas partes se traban (se reprodujo: la
     * consulta expiraba, y la misma llamada hecha después tarda 350 ms).
     */
    after(async () => {
      const { publicKey, privateKey } = getBancardKeys();

      // Se le da un instante a Bancard para cerrar la transacción.
      await new Promise((r) => setTimeout(r, 1500));

      for (let intento = 1; intento <= 3; intento += 1) {
        const consulta = await llamarBancard(
          "/vpos/api/0.3/single_buy/confirmations",
          {
            public_key: publicKey,
            operation: {
              token: tokenConsultaConfirmacion(privateKey, shopProcessId),
              shop_process_id: shopProcessId,
            },
          },
        );

        if (!consulta.ok) {
          const { key, detalle } = describirErrorBancard(consulta.data);

          console.error(
            `Bancard: verificación fallida (intento ${intento}) de`,
            shopProcessId,
            key,
            detalle,
          );

          await new Promise((r) => setTimeout(r, 2000));
          continue;
        }

        const verificada = consulta.data?.confirmation || {};

        const aprobado =
          verificada.response === "S" &&
          String(verificada.response_code) === "00";

        const { error } = await admin.rpc("eos_bancard_confirmar_cobro_v51", {
          p_shop_process_id: shopProcessId,
          p_aprobado: aprobado,
          p_detalle: {
            origen: "webhook_bancard_verificado",
            response: verificada.response ?? null,
            response_code: verificada.response_code ?? null,
            response_description: verificada.response_description ?? null,
            authorization_number: verificada.authorization_number ?? null,
            ticket_number: verificada.ticket_number ?? null,
          },
        });

        if (error) {
          console.error("Bancard: error confirmando desde webhook:", error);
        }

        return;
      }

      console.error(
        "Bancard: no se pudo verificar la transacción tras 3 intentos:",
        shopProcessId,
      );
    });

    return respuestaOk();
  } catch (error) {
    console.error("Bancard: error inesperado en confirmación:", error);

    return NextResponse.json({ status: "error" }, { status: 500 });
  }
}
