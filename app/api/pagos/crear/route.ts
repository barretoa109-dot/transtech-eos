import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase-admin";
import {
  checkoutURL,
  getPagoparKeys,
  PAGOPAR_API,
  tokenPedido,
} from "@/lib/pagopar";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CrearPagoBody = {
  plan?: string;
  periodicidad?: "mensual" | "anual";
  nombre?: string;
  email?: string;
  telefono?: string;
  documento?: string;
  ruc?: string;
  razon_social?: string;
};

type PlanPago = {
  id: string;
  codigo: string;
  nombre: string | null;
  descripcion: string | null;
  activo: boolean;
  es_publico: boolean;
  precio_mensual_pyg: number | null;
  precio_anual_pyg: number | null;
};

type SolicitudPago = {
  id: string;
  referencia_interna: string;
};

type ResultadoPagopar = {
  respuesta?: boolean;
  resultado?:
    | string
    | Array<{
        data?: string;
        pedido?: unknown;
      }>;
};

const PLANES_PAGOS = new Set(["personal", "pro", "business"]);

function limpiarTexto(valor: unknown, longitudMaxima = 180) {
  return String(valor ?? "").trim().slice(0, longitudMaxima);
}

function fechaMaximaPago() {
  const fecha = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const completar = (numero: number) => String(numero).padStart(2, "0");

  return [
    fecha.getFullYear(),
    "-",
    completar(fecha.getMonth() + 1),
    "-",
    completar(fecha.getDate()),
    " ",
    completar(fecha.getHours()),
    ":",
    completar(fecha.getMinutes()),
    ":",
    completar(fecha.getSeconds()),
  ].join("");
}

export async function POST(request: Request) {
  let solicitudId: string | null = null;

  try {
    const body = (await request.json()) as CrearPagoBody;
    const planCodigo = limpiarTexto(body.plan, 40).toLowerCase();
    const periodicidad = body.periodicidad === "anual" ? "anual" : "mensual";

    if (!PLANES_PAGOS.has(planCodigo)) {
      return NextResponse.json(
        {
          error:
            "El plan seleccionado no puede pagarse mediante este checkout.",
        },
        { status: 400 },
      );
    }

    const nombre = limpiarTexto(body.nombre, 120);
    const email = limpiarTexto(body.email, 180).toLowerCase();
    const telefono = limpiarTexto(body.telefono, 40);
    const documento = limpiarTexto(body.documento, 40);
    const ruc = limpiarTexto(body.ruc, 40);
    const razonSocial = limpiarTexto(body.razon_social, 160) || nombre;

    if (!nombre || !email || !telefono || !documento) {
      return NextResponse.json(
        {
          error:
            "Completá nombre, correo, teléfono y número de documento.",
        },
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
        {
          error: "Debés iniciar sesión para continuar con el pago.",
        },
        { status: 401 },
      );
    }

    if (user.email && user.email.toLowerCase() !== email) {
      return NextResponse.json(
        {
          error: "El correo debe coincidir con tu cuenta de TransTech EOS.",
        },
        { status: 400 },
      );
    }

    const admin: any = createAdminClient();

    const { data: planData, error: planError } = await admin
      .from("planes")
      .select(
        `
          id,
          codigo,
          nombre,
          descripcion,
          activo,
          es_publico,
          precio_mensual_pyg,
          precio_anual_pyg
        `,
      )
      .eq("codigo", planCodigo)
      .eq("activo", true)
      .eq("es_publico", true)
      .maybeSingle();

    const plan = planData as PlanPago | null;

    if (planError) {
      console.error("Error consultando plan:", planError);

      return NextResponse.json(
        {
          error: "No pudimos consultar el plan seleccionado.",
        },
        { status: 500 },
      );
    }

    if (!plan) {
      return NextResponse.json(
        {
          error: "No encontramos el plan solicitado.",
        },
        { status: 404 },
      );
    }

    const monto =
      periodicidad === "anual"
        ? Number(plan.precio_anual_pyg)
        : Number(plan.precio_mensual_pyg);

    if (!Number.isFinite(monto) || monto <= 0) {
      return NextResponse.json(
        {
          error: "El plan no tiene un precio válido configurado.",
        },
        { status: 400 },
      );
    }

    const referenciaInterna =
  `EOS${randomUUID().replaceAll("-", "")}`;

    const { data: solicitudData, error: solicitudError } = await admin
      .from("solicitudes_pago")
      .insert({
        usuario_id: user.id,
        plan_codigo: planCodigo,
        periodicidad,
        moneda: "PYG",
        monto,
        proveedor: "pagopar",
        estado: "procesando",
        referencia_interna: referenciaInterna,
        vencimiento_pago: new Date(
          Date.now() + 24 * 60 * 60 * 1000,
        ).toISOString(),
        metadata: {
          comprador: {
            nombre,
            email,
            telefono,
            documento,
            ruc,
            razon_social: razonSocial,
          },
        },
      })
      .select("id, referencia_interna")
      .single();

    const solicitud = solicitudData as SolicitudPago | null;

    if (solicitudError || !solicitud) {
      console.error("Error creando solicitud:", solicitudError);

      return NextResponse.json(
        {
          error: "No pudimos preparar la solicitud de pago.",
        },
        { status: 500 },
      );
    }

    solicitudId = solicitud.id;

    const { publicKey, privateKey } = getPagoparKeys();
    const idPedidoComercio = solicitud.referencia_interna;
    const token = tokenPedido(privateKey, idPedidoComercio, monto);
    const nombrePlan = plan.nombre || `EOS ${planCodigo}`;

    const payloadPagopar = {
      token,
      comprador: {
        ruc: ruc || null,
        email,
        ciudad: 1,
        nombre,
        telefono,
        direccion: "",
        documento,
        coordenadas: "",
        razon_social: razonSocial || null,
        tipo_documento: "CI",
        direccion_referencia: "",
      },
      public_key: publicKey,
      monto_total: monto,
      tipo_pedido: "VENTA-COMERCIO",
      compras_items: [
        {
          ciudad: "1",
          nombre: `${nombrePlan} - ${periodicidad}`,
          cantidad: 1,
          categoria: "909",
          public_key: publicKey,
          url_imagen: "",
          descripcion: `Suscripción ${periodicidad} a ${nombrePlan}`,
          id_producto: plan.id,
          precio_total: monto,
          vendedor_telefono: "",
          vendedor_direccion: "",
          vendedor_direccion_referencia: "",
          vendedor_direccion_coordenadas: "",
        },
      ],
      fecha_maxima_pago: fechaMaximaPago(),
      id_pedido_comercio: idPedidoComercio,
      descripcion_resumen: `${nombrePlan} - ${periodicidad}`,
      forma_pago: 9,
    };

    const respuestaPagopar = await fetch(
      `${PAGOPAR_API}/comercios/2.0/iniciar-transaccion`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payloadPagopar),
        cache: "no-store",
      },
    );

    const resultadoPagopar = (await respuestaPagopar
      .json()
      .catch(() => null)) as ResultadoPagopar | null;

    if (!respuestaPagopar.ok) {
      throw new Error(
        `PagoPar respondió con estado ${respuestaPagopar.status}.`,
      );
    }

    const primerResultado = Array.isArray(resultadoPagopar?.resultado)
      ? resultadoPagopar.resultado[0]
      : null;

    const hashPedido = primerResultado?.data;

    if (resultadoPagopar?.respuesta !== true || !hashPedido) {
      console.error("PagoPar rechazó el pedido:", resultadoPagopar);

      await admin
        .from("solicitudes_pago")
        .update({
          estado: "rechazado",
          metadata: {
            comprador: {
              nombre,
              email,
              telefono,
              documento,
              ruc,
              razon_social: razonSocial,
            },
            pagopar_error: resultadoPagopar,
          },
          updated_at: new Date().toISOString(),
        })
        .eq("id", solicitud.id);

      const mensajePagopar =
        typeof resultadoPagopar?.resultado === "string"
          ? resultadoPagopar.resultado
          : "PagoPar rechazó la creación del pedido.";

      return NextResponse.json(
        { error: mensajePagopar },
        { status: 502 },
      );
    }

    const urlCheckout = checkoutURL(hashPedido);

    const { error: actualizarError } = await admin
      .from("solicitudes_pago")
      .update({
        estado: "pendiente",
        referencia_externa: hashPedido,
        checkout_url: urlCheckout,
        metadata: {
          comprador: {
            nombre,
            email,
            telefono,
            documento,
            ruc,
            razon_social: razonSocial,
          },
          pagopar_pedido: primerResultado?.pedido ?? null,
        },
        updated_at: new Date().toISOString(),
      })
      .eq("id", solicitud.id);

    if (actualizarError) {
      console.error("Pedido creado pero no guardado:", actualizarError);

      return NextResponse.json(
        {
          error:
            "El pedido fue creado, pero no pudimos guardar correctamente su referencia.",
        },
        { status: 500 },
      );
    }

    return NextResponse.json({
      ok: true,
      solicitud_id: solicitud.id,
      hash: hashPedido,
      checkout_url: urlCheckout,
    });
  } catch (error) {
    console.error("Error en /api/pagos/crear:", error);

    if (solicitudId) {
      try {
        const admin: any = createAdminClient();

        await admin
          .from("solicitudes_pago")
          .update({
            estado: "rechazado",
            metadata: {
              error_creacion:
                error instanceof Error
                  ? error.message
                  : "Error desconocido",
            },
            updated_at: new Date().toISOString(),
          })
          .eq("id", solicitudId);
      } catch (errorActualizando) {
        console.error("No se pudo registrar el fallo:", errorActualizando);
      }
    }

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "No se pudo iniciar el pago.",
      },
      { status: 500 },
    );
  }
}