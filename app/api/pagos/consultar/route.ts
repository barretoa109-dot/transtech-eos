import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase-admin";
import {
  getPagoparKeys,
  PAGOPAR_API,
  tokenConsulta,
} from "@/lib/pagopar";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ConsultarBody = {
  hash?: string;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ConsultarBody;
    const hashPedido = String(body.hash || "").trim();

    if (!hashPedido) {
      return NextResponse.json(
        { error: "Falta el hash del pedido." },
        { status: 400 },
      );
    }

    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { error: "Debés iniciar sesión para consultar el pago." },
        { status: 401 },
      );
    }

    const admin: any = createAdminClient();

    const {
      data: solicitud,
      error: solicitudError,
    } = await admin
      .from("solicitudes_pago")
      .select(
        `
          id,
          usuario_id,
          plan_codigo,
          periodicidad,
          moneda,
          monto,
          estado,
          referencia_externa,
          pagado_at,
          created_at
        `,
      )
      .eq("referencia_externa", hashPedido)
      .eq("usuario_id", user.id)
      .maybeSingle();

    if (solicitudError) {
      console.error(
        "Error consultando solicitud:",
        solicitudError,
      );

      return NextResponse.json(
        { error: "No pudimos consultar tu pedido." },
        { status: 500 },
      );
    }

    if (!solicitud) {
      return NextResponse.json(
        { error: "No encontramos este pedido en tu cuenta." },
        { status: 404 },
      );
    }

    const { publicKey, privateKey } = getPagoparKeys();

    const respuesta = await fetch(
      `${PAGOPAR_API}/pedidos/1.1/traer`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          hash_pedido: hashPedido,
          token: tokenConsulta(privateKey),
          token_publico: publicKey,
        }),
        cache: "no-store",
      },
    );

    const resultadoPagopar = await respuesta
      .json()
      .catch(() => null);

    if (!respuesta.ok) {
      console.error(
        "PagoPar respondió con error:",
        respuesta.status,
        resultadoPagopar,
      );

      return NextResponse.json(
        {
          error:
            "PagoPar no pudo devolver el estado del pedido.",
        },
        { status: 502 },
      );
    }

    const detalle =
      Array.isArray(resultadoPagopar?.resultado)
        ? resultadoPagopar.resultado[0] || null
        : null;

    return NextResponse.json({
      ok: resultadoPagopar?.respuesta === true,
      solicitud,
      pagopar: detalle,
      respuesta_pagopar: resultadoPagopar,
    });
  } catch (error) {
    console.error(
      "Error en /api/pagos/consultar:",
      error,
    );

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "No se pudo consultar el pago.",
      },
      { status: 500 },
    );
  }
}