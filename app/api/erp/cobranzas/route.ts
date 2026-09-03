import { NextResponse } from "next/server";

import { exigirModulo } from "@/lib/modulos/acceso";
import { adminSinTipos } from "@/lib/supabase/sin-tipos";
import { registrarOperacionErp } from "@/lib/auditoria/registrar";
import { formatearMonto } from "@/lib/finanzas/formato";

export const dynamic = "force-dynamic";

/**
 * Registrar un cobro o un pago parcial contra un documento.
 *
 * Es lo que faltaba para que "crédito" signifique algo más que "todavía no
 * cobrado": un cliente que abona la mitad ya no obliga a elegir entre decir
 * que pagó todo o que no pagó nada.
 *
 * La aritmética y el candado están en la base (`eos_erp_registrar_cobranza_v107`):
 * bloquea la cabecera, comprueba el saldo y crea el movimiento financiero en la
 * MISMA transacción. Sin eso, dos cobros simultáneos podrían pasar los dos el
 * control y dejar el documento sobrecobrado.
 */

const ERRORES: Record<string, { estado: number; mensaje: string }> = {
  EOS_DOCUMENTO_NO_EXISTE: { estado: 404, mensaje: "No encontramos ese documento." },
  EOS_DOCUMENTO_ANULADO: { estado: 409, mensaje: "Ese documento está anulado." },
  EOS_DOCUMENTO_SIN_SALDO: { estado: 409, mensaje: "Ese documento ya está saldado." },
  EOS_COBRANZA_EXCEDE_SALDO: {
    estado: 409,
    mensaje: "El monto es mayor que el saldo pendiente. Cobrá el saldo o menos.",
  },
  EOS_COBRANZA_MONTO_INVALIDO: { estado: 400, mensaje: "El monto tiene que ser mayor a cero." },
  EOS_COBRANZA_DOCUMENTO_INVALIDO: { estado: 400, mensaje: "Indicá una venta o una compra, no las dos." },
  EOS_COBRANZA_NO_EXISTE: { estado: 404, mensaje: "No encontramos ese cobro." },
};

function traducir(mensaje: string): { estado: number; mensaje: string } {
  for (const [clave, salida] of Object.entries(ERRORES)) {
    if (mensaje.includes(clave)) return salida;
  }
  return { estado: 503, mensaje: "No pudimos registrar el cobro." };
}

export async function POST(request: Request) {
  const puerta = await exigirModulo("erp");
  if (puerta.respuesta) return puerta.respuesta;

  let cuerpo: Record<string, unknown>;
  try {
    cuerpo = await request.json();
  } catch {
    return NextResponse.json({ error: "Datos inválidos." }, { status: 400, headers: noStore() });
  }

  const ventaId = typeof cuerpo.venta_id === "string" ? cuerpo.venta_id : null;
  const compraId = typeof cuerpo.compra_id === "string" ? cuerpo.compra_id : null;
  const monto = Number(cuerpo.monto);
  const fecha = typeof cuerpo.fecha === "string" ? cuerpo.fecha : null;
  const nota = typeof cuerpo.nota === "string" ? cuerpo.nota.trim().slice(0, 300) : null;

  if ((ventaId === null) === (compraId === null)) {
    return NextResponse.json(
      { error: "Indicá una venta o una compra, no las dos." },
      { status: 400, headers: noStore() },
    );
  }

  // Se valida acá además de en la base: un NaN que llega hasta el RPC produce
  // un error de Postgres, y un error de Postgres no es un mensaje que alguien
  // pueda leer.
  if (!Number.isFinite(monto) || monto <= 0) {
    return NextResponse.json(
      { error: "El monto tiene que ser un número mayor a cero." },
      { status: 400, headers: noStore() },
    );
  }

  const admin = adminSinTipos();
  const { data, error } = await admin.rpc("eos_erp_registrar_cobranza_v107", {
    p_usuario_id: puerta.usuarioId,
    p_venta_id: ventaId,
    p_compra_id: compraId,
    p_monto: monto,
    p_fecha: fecha,
    p_nota: nota,
  });

  if (error) {
    const { estado, mensaje } = traducir(error.message ?? "");
    if (estado === 503) console.error("ERP: falló el registro de cobranza:", error);
    return NextResponse.json({ error: mensaje }, { status: estado, headers: noStore() });
  }

  const esVenta = ventaId !== null;

  // La auditoría dice qué quedó registrado, con su monto y su saldo: "cobro
  // registrado" a secas no permite reconstruir nada después.
  await registrarOperacionErp(admin, {
    usuarioId: puerta.usuarioId,
    evento: esVenta ? "venta_cobrada" : "compra_pagada",
    origen: "panel",
    resumen: `${esVenta ? "Cobro" : "Pago"} de ${formatearMonto(monto, "PYG")}${
      data?.saldado ? " (saldado)" : " (parcial)"
    }`,
    referencia: String(ventaId ?? compraId),
    resultado: "ok",
    extra: {
      cobranza_id: data?.cobranza_id ?? null,
      saldo_anterior: data?.saldo_anterior ?? null,
      saldo_actual: data?.saldo_actual ?? null,
    },
  });

  return NextResponse.json(data, { headers: noStore() });
}

/** Revertir un cobro mal cargado. Borra también su movimiento financiero. */
export async function DELETE(request: Request) {
  const puerta = await exigirModulo("erp");
  if (puerta.respuesta) return puerta.respuesta;

  const { searchParams } = new URL(request.url);
  const id = (searchParams.get("id") ?? "").trim();

  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: "No encontramos ese cobro." }, { status: 404, headers: noStore() });
  }

  const admin = adminSinTipos();
  const { data, error } = await admin.rpc("eos_erp_revertir_cobranza_v107", {
    p_usuario_id: puerta.usuarioId,
    p_cobranza_id: id,
  });

  if (error) {
    const { estado, mensaje } = traducir(error.message ?? "");
    if (estado === 503) console.error("ERP: falló la reversión de cobranza:", error);
    return NextResponse.json({ error: mensaje }, { status: estado, headers: noStore() });
  }

  await registrarOperacionErp(admin, {
    usuarioId: puerta.usuarioId,
    evento: "venta_anulada",
    origen: "panel",
    resumen: "Cobro revertido",
    referencia: id,
    resultado: "ok",
  });

  return NextResponse.json(data, { headers: noStore() });
}

function noStore() {
  return { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" };
}
