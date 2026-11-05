import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { adminSinTipos } from "@/lib/supabase/sin-tipos";
import { exigirModulo } from "@/lib/modulos/acceso";
import { registrarAuditoria } from "@/lib/auditoria/registrar";
import { POST as comprasPOST } from "@/app/api/erp/compras/route";

export const dynamic = "force-dynamic";

/**
 * Facturas de proveedores leídas de un adjunto de correo (Pilar 3 del
 * documento de visión del 04/11), pendientes de confirmar como compra.
 *
 * Confirmar no reimplementa el registro de una compra: arma el mismo cuerpo
 * que ya acepta `POST /api/erp/compras` y llama a ese handler directo, con
 * el mismo criterio que ya usa `procesar-mensaje.ts` para documentos — así
 * hay un solo lugar donde "registrar una compra" significa algo.
 */
export async function GET() {
  const puerta = await exigirModulo("erp");
  if (puerta.respuesta) return puerta.respuesta;

  const supabase = await createClient();

  const { data, error } = await supabase
    .from("eos_facturas_recibidas")
    .select(
      "id,proveedor_ruc,proveedor_nombre,numero_documento,fecha,moneda,total,iva_tasa,empresa_id,creado_en",
    )
    .eq("estado", "pendiente")
    .order("creado_en", { ascending: false })
    .limit(20);

  if (error) {
    console.error("No se pudieron leer las facturas de proveedores:", error);
    return NextResponse.json({ error: "No disponible." }, { status: 503, headers: noStore() });
  }

  return NextResponse.json({ facturas: data ?? [] }, { headers: noStore() });
}

/** `{ id, accion: "confirmar" | "descartar" }`. */
export async function POST(request: Request) {
  const puerta = await exigirModulo("erp");
  if (puerta.respuesta) return puerta.respuesta;

  let body: { id?: unknown; accion?: unknown };
  try {
    body = (await request.json()) as { id?: unknown; accion?: unknown };
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido." }, { status: 400, headers: noStore() });
  }

  const id = typeof body.id === "string" ? body.id : "";
  const accion = body.accion === "confirmar" || body.accion === "descartar" ? body.accion : null;

  if (!id || !accion) {
    return NextResponse.json({ error: "Faltan datos." }, { status: 400, headers: noStore() });
  }

  const admin = adminSinTipos();

  const { data: fila, error: errorLectura } = await admin
    .from("eos_facturas_recibidas")
    .select("id,usuario_id,empresa_id,proveedor_ruc,proveedor_nombre,numero_documento,fecha,moneda,total,iva_tasa,estado")
    .eq("id", id)
    .eq("usuario_id", puerta.usuarioId)
    .maybeSingle();

  if (errorLectura) {
    console.error("No se pudo leer la factura:", errorLectura);
    return NextResponse.json({ error: "No disponible." }, { status: 503, headers: noStore() });
  }

  type Fila = {
    id: string;
    usuario_id: string;
    empresa_id: string | null;
    proveedor_ruc: string | null;
    proveedor_nombre: string | null;
    numero_documento: string | null;
    fecha: string | null;
    moneda: "PYG" | "USD";
    total: number;
    iva_tasa: 0 | 5 | 10;
    estado: string;
  };

  const factura = fila as Fila | null;

  if (!factura || factura.estado !== "pendiente") {
    // Ya resuelta (otra pestaña, doble toque) o no es suya: no hay nada que hacer.
    return NextResponse.json({ ok: true }, { headers: noStore() });
  }

  if (accion === "descartar") {
    await admin
      .from("eos_facturas_recibidas")
      .update({ estado: "descartada", resuelto_en: new Date().toISOString() })
      .eq("id", id)
      .eq("usuario_id", puerta.usuarioId);

    await registrarAuditoria(admin, {
      usuarioId: puerta.usuarioId,
      evento: "factura_proveedor_descartada",
      origen: "panel",
      resumen: `Se descartó la factura leída de ${factura.proveedor_nombre ?? "un proveedor"}: no correspondía.`,
      referencia: id,
    });

    return NextResponse.json({ ok: true }, { headers: noStore() });
  }

  // confirmar
  if (!factura.empresa_id) {
    return NextResponse.json(
      { error: "Esta cuenta todavía no tiene una empresa resuelta: no se puede registrar la compra." },
      { status: 400, headers: noStore() },
    );
  }

  const descripcion = [factura.numero_documento, factura.proveedor_nombre].filter(Boolean).join(" — ") ||
    "Factura de proveedor";

  // Sin cookie propia a propósito: `createClient()` adentro de `/api/erp/compras`
  // lee la sesión del contexto ambiente de Next (`next/headers`), no de este
  // objeto `Request` sintético — mismo patrón que `analizarArchivoSincrono` en
  // `procesar-mensaje.ts` para `/api/documents/ingest`.
  const comprasRequest = new Request("http://eos.internal/api/erp/compras", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      items: [{ producto_id: null, descripcion, cantidad: 1, precio_unitario: factura.total, iva: factura.iva_tasa }],
      fecha: factura.fecha,
      moneda: factura.moneda,
      condicion: "contado",
      pagada: true,
      numero_comprobante: factura.numero_documento,
      notas: factura.proveedor_ruc ? `RUC proveedor: ${factura.proveedor_ruc}` : null,
    }),
  });

  const comprasResponse = await comprasPOST(comprasRequest);

  if (!comprasResponse.ok) {
    const detalle = await comprasResponse.json().catch(() => ({ error: "No se pudo registrar la compra." }));
    return NextResponse.json(detalle, { status: comprasResponse.status, headers: noStore() });
  }

  const compra = (await comprasResponse.json()) as { compra_id?: string; id?: string };
  const compraId = compra.compra_id ?? compra.id ?? null;

  await admin
    .from("eos_facturas_recibidas")
    .update({ estado: "confirmada", compra_id: compraId, resuelto_en: new Date().toISOString() })
    .eq("id", id)
    .eq("usuario_id", puerta.usuarioId);

  await registrarAuditoria(admin, {
    usuarioId: puerta.usuarioId,
    empresaId: factura.empresa_id,
    evento: "factura_proveedor_confirmada",
    origen: "panel",
    resumen: `Se confirmó como compra la factura leída de ${factura.proveedor_nombre ?? "un proveedor"}.`,
    referencia: id,
    detalle: { compra_id: compraId },
  });

  return NextResponse.json({ ok: true, compra_id: compraId }, { headers: noStore() });
}

function noStore() {
  return { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" };
}
