import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase-admin";
import { createClient } from "@/lib/supabase/server";
import { exigirModulo } from "@/lib/modulos/acceso";
import { generarCdc, numeroFormateado } from "@/lib/facturacion/cdc";
import { armarComprobante } from "@/lib/facturacion/comprobante";
import { guardarDocumento } from "@/lib/documentos/guardar";
import { hoyEnParaguay } from "@/lib/fecha";
import { adminSinTipos } from "@/lib/supabase/sin-tipos";
import { registrarOperacionErp } from "@/lib/auditoria/registrar";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Emitir el documento electrónico de una venta.
 *
 * ============================================================
 * LO QUE ESTO EMITE HOY, Y LO QUE NO
 * ============================================================
 *
 * Hoy produce un documento en estado **borrador**: con su numeración reservada,
 * su CDC calculado y su comprobante imprimible. Eso ya sirve —es el papel que
 * el cliente se lleva— pero **todavía no es una factura electrónica ante la
 * SET**, y la respuesta lo dice con todas las letras.
 *
 * Para que lo sea faltan dos pasos que no dependen del software: firmarlo con
 * el certificado digital del contribuyente y enviarlo a SIFEN. Ver el
 * comentario de cabecera de la migración v68.
 *
 * Llamar "factura" a un borrador metería al usuario en un problema con la SET,
 * que es bastante peor que no tener el módulo. Por eso el estado viaja en la
 * respuesta y el comprobante sale rotulado.
 */

export async function POST(request: Request) {
  const puerta = await exigirModulo("facturacion");
  if (puerta.respuesta) return puerta.respuesta;

  let cuerpo: Record<string, unknown>;
  try {
    cuerpo = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido." }, { status: 400, headers: noStore() });
  }

  const ventaId = String(cuerpo.venta_id ?? "").trim();

  if (!/^[0-9a-f-]{36}$/i.test(ventaId)) {
    return NextResponse.json(
      { error: "Falta la venta que se quiere facturar." },
      { status: 400, headers: noStore() },
    );
  }

  const supabase = await createClient();

  const [configRes, ventaRes] = await Promise.all([
    supabase
      .from("eos_fe_config")
      .select("*")
      .eq("usuario_id", puerta.usuarioId)
      .maybeSingle(),
    supabase
      .from("eos_erp_ventas")
      .select(
        "id,fecha,moneda,subtotal,iva_total,total,condicion,estado," +
          "contacto:eos_crm_contactos(nombre,ruc,ruc_dv,direccion,email)," +
          "items:eos_erp_venta_items(descripcion,cantidad,precio_unitario,iva,total,orden)",
      )
      .eq("id", ventaId)
      .eq("usuario_id", puerta.usuarioId)
      .maybeSingle(),
  ]);

  if (!configRes.data) {
    return NextResponse.json(
      { error: "Antes de facturar tenés que cargar tus datos de emisor.", falta: "config" },
      { status: 409, headers: noStore() },
    );
  }

  if (!ventaRes.data) {
    return NextResponse.json({ error: "Venta no encontrada." }, { status: 404, headers: noStore() });
  }

  const config = configRes.data as unknown as Record<string, unknown>;
  const venta = ventaRes.data as unknown as Record<string, unknown>;

  if (venta.estado === "anulada") {
    return NextResponse.json(
      { error: "No se puede facturar una venta anulada." },
      { status: 409, headers: noStore() },
    );
  }

  const admin = createAdminClient();

  // Ya facturada: se devuelve la que hay en vez de emitir otra. Dos documentos
  // para la misma venta son dos números de factura gastados y un problema para
  // explicarle a la SET.
  const { data: existente } = await admin
    .from("eos_fe_documentos")
    .select("id,cdc,establecimiento,punto_expedicion,numero,estado")
    .eq("usuario_id", puerta.usuarioId)
    .eq("venta_id", ventaId)
    .not("estado", "eq", "cancelado")
    .maybeSingle();

  if (existente) {
    const doc = existente as unknown as Record<string, unknown>;

    return NextResponse.json(
      {
        ya_estaba: true,
        documento_id: doc.id,
        cdc: doc.cdc,
        numero: numeroFormateado(
          String(doc.establecimiento),
          String(doc.punto_expedicion),
          Number(doc.numero),
        ),
        estado: doc.estado,
      },
      { headers: noStore() },
    );
  }

  const establecimiento = String(config.establecimiento ?? "001");
  const punto = String(config.punto_expedicion ?? "001");

  /*
   * El número sale de la secuencia, no de un `max() + 1`.
   *
   * Un número de factura no se puede repetir NUNCA. `max(numero) + 1` sobre los
   * documentos es la forma clásica de emitir dos veces el mismo número cuando
   * entran dos ventas al mismo tiempo; la secuencia se incrementa dentro de una
   * sola sentencia y no tiene esa ventana.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- el cliente tipado no conoce esta función
  const { data: numero, error: numeroError } = await (admin as any).rpc("eos_fe_siguiente_numero", {
    p_usuario_id: puerta.usuarioId,
    p_tipo_documento: 1,
    p_establecimiento: establecimiento,
    p_punto: punto,
  });

  if (numeroError || !numero) {
    console.error("FE: no se pudo reservar el número:", numeroError);
    return NextResponse.json(
      { error: "No pudimos reservar el número de la factura." },
      { status: 503, headers: noStore() },
    );
  }

  const fechaEmision = hoyEnParaguay();

  let cdc: ReturnType<typeof generarCdc>;
  try {
    cdc = generarCdc({
      tipoDocumento: 1,
      ruc: String(config.ruc ?? ""),
      rucDv: Number(config.ruc_dv ?? 0),
      establecimiento,
      puntoExpedicion: punto,
      numero: Number(numero),
      tipoContribuyente: config.tipo_contribuyente === 2 ? 2 : 1,
      fechaEmision,
    });
  } catch (error) {
    console.error("FE: no se pudo generar el CDC:", error);
    return NextResponse.json(
      { error: "Tus datos de emisor no permiten generar el código de control. Revisá el RUC." },
      { status: 409, headers: noStore() },
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- el cliente tipado no conoce las tablas nuevas
  const { data: documento, error: docError } = await (admin as any)
    .from("eos_fe_documentos")
    .insert({
      usuario_id: puerta.usuarioId,
      venta_id: ventaId,
      tipo_documento: 1,
      establecimiento,
      punto_expedicion: punto,
      numero: Number(numero),
      cdc: cdc.valor,
      estado: "borrador",
      total: Number(venta.total ?? 0),
      moneda: String(venta.moneda ?? "PYG"),
    })
    .select("id")
    .single();

  if (docError) {
    console.error("FE: no se pudo guardar el documento:", docError);
    return NextResponse.json(
      { error: "No pudimos registrar el documento." },
      { status: 503, headers: noStore() },
    );
  }

  /*
   * El comprobante imprimible sale por el mismo camino que cualquier otro
   * documento de EOS (`lib/documentos`), así que se puede bajar en PDF, Word o
   * Excel sin escribir un renderizador nuevo — y el día que mejore el
   * renderizador, mejoran también los comprobantes ya emitidos.
   */
  const comprobante = armarComprobante({
    config,
    venta,
    cdc: cdc.valor,
    numero: numeroFormateado(establecimiento, punto, Number(numero)),
    fechaEmision,
    esBorrador: true,
  });

  const guardado = await guardarDocumento(admin, {
    usuarioId: puerta.usuarioId,
    documento: comprobante,
    formato: "pdf",
  });

  /*
   * Emitir quema un número correlativo, y eso no se puede devolver.
   *
   * De todas las operaciones del ERP es la única con consecuencia hacia
   * AFUERA: el día que este comprobante se firme y se envíe a la SET, la
   * numeración tiene que ser continua y explicable. Un hueco sin registro es
   * exactamente lo que no se le puede explicar a un fiscalizador.
   */
  await registrarOperacionErp(adminSinTipos(), {
    usuarioId: puerta.usuarioId,
    evento: "comprobante_emitido",
    origen: "panel",
    resumen: `Comprobante ${numeroFormateado(establecimiento, punto, Number(numero))} emitido como borrador`,
    referencia: String((documento as Record<string, unknown>).id ?? ""),
    resultado: "ok",
    despues: {
      numero: numeroFormateado(establecimiento, punto, Number(numero)),
      cdc: cdc.valor,
      estado: "borrador",
    },
    extra: { venta_id: String(ventaId ?? "") },
  });

  return NextResponse.json(
    {
      ya_estaba: false,
      documento_id: (documento as Record<string, unknown>).id,
      cdc: cdc.valor,
      numero: numeroFormateado(establecimiento, punto, Number(numero)),
      estado: "borrador",
      /*
       * Esto no es una formalidad legal: es lo que le impide a la interfaz
       * escribir "factura emitida" sobre algo que la SET todavía no vio.
       */
      advertencia:
        "Este documento tiene número y código de control, pero todavía no fue firmado ni enviado a SIFEN. No reemplaza a una factura electrónica aprobada.",
      comprobante_url: guardado?.url ?? null,
    },
    { status: 201, headers: noStore() },
  );
}

function noStore() {
  return { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" };
}
