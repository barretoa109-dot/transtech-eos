import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { hoyEnParaguay } from "@/lib/fecha";
import { validarDeuda } from "@/lib/finanzas/deudas";

export const dynamic = "force-dynamic";

type Contexto = { params: Promise<{ id: string }> };

const COLUMNAS =
  "id,acreedor,tipo,moneda,saldo_declarado,saldo_declarado_el,cuota_monto,cuota_dia," +
  "cuotas_totales,cuotas_pagadas,tasa_anual,vence_el,estado,preocupa,notas";

function esUuid(valor: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(valor);
}

/**
 * Actualiza una deuda.
 *
 * Se valida el objeto COMPLETO, no el parche: el cliente manda la deuda como
 * quedó y acá se vuelve a comprobar entera. Validar solo los campos que vienen
 * dejaría pasar combinaciones imposibles —por ejemplo borrar el día de la
 * cuota y dejar el monto— que después rompen la proyección.
 *
 * Si el saldo cambió, la fecha del saldo se actualiza sola: un saldo sin fecha
 * es un saldo que no se puede interpretar tres meses después.
 */
export async function PATCH(request: Request, contexto: Contexto) {
  const { id } = await contexto.params;

  if (!esUuid(id)) {
    return NextResponse.json({ error: "Deuda inválida." }, { status: 400, headers: noStore() });
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Sesión no válida." }, { status: 401, headers: noStore() });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido." }, { status: 400, headers: noStore() });
  }

  const { data: actual, error: lecturaError } = await supabase
    .from("eos_finanzas_deudas")
    .select(COLUMNAS)
    .eq("id", id)
    .eq("usuario_id", user.id)
    .maybeSingle();

  if (lecturaError) {
    console.error("No se pudo leer la deuda:", lecturaError);
    return NextResponse.json(
      { error: "No pudimos cargar la deuda." },
      { status: 500, headers: noStore() },
    );
  }

  if (!actual) {
    return NextResponse.json({ error: "Deuda no encontrada." }, { status: 404, headers: noStore() });
  }

  const anterior = actual as unknown as Record<string, unknown>;
  const validada = validarDeuda({ ...anterior, ...body }, hoyEnParaguay());

  if ("error" in validada) {
    return NextResponse.json({ error: validada.error }, { status: 400, headers: noStore() });
  }

  const cambioElSaldo = validada.valor.saldo_declarado !== Number(anterior.saldo_declarado);

  const { data, error } = await supabase
    .from("eos_finanzas_deudas")
    .update({
      ...validada.valor,
      saldo_declarado_el: cambioElSaldo ? hoyEnParaguay() : validada.valor.saldo_declarado_el,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("usuario_id", user.id)
    .select(COLUMNAS)
    .single();

  if (error) {
    console.error("No se pudo actualizar la deuda:", error);
    return NextResponse.json(
      { error: "No pudimos actualizar la deuda." },
      { status: 500, headers: noStore() },
    );
  }

  return NextResponse.json({ deuda: data }, { headers: noStore() });
}

/**
 * Borra una deuda.
 *
 * Borrar y no marcar `saldada` son cosas distintas y las dos existen a
 * propósito: `saldada` es "la terminé de pagar" y queda en la historia;
 * DELETE es "la cargué mal". Solo el segundo caso justifica perder el dato.
 */
export async function DELETE(_request: Request, contexto: Contexto) {
  const { id } = await contexto.params;

  if (!esUuid(id)) {
    return NextResponse.json({ error: "Deuda inválida." }, { status: 400, headers: noStore() });
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Sesión no válida." }, { status: 401, headers: noStore() });
  }

  const { error } = await supabase
    .from("eos_finanzas_deudas")
    .delete()
    .eq("id", id)
    .eq("usuario_id", user.id);

  if (error) {
    console.error("No se pudo borrar la deuda:", error);
    return NextResponse.json(
      { error: "No pudimos borrar la deuda." },
      { status: 500, headers: noStore() },
    );
  }

  return NextResponse.json({ ok: true }, { headers: noStore() });
}

function noStore() {
  return { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" };
}
