import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { hoyEnParaguay } from "@/lib/fecha";
import {
  estaViva,
  porPrioridad,
  proximaCuota,
  totalAdeudado,
  validarDeuda,
  type Deuda,
} from "@/lib/finanzas/deudas";

export const dynamic = "force-dynamic";

/**
 * Las deudas del usuario.
 *
 * A diferencia de los fijos, una deuda NO se reemplaza en bloque: tiene
 * identidad y vida propia. Se declara una vez y después cambia de a poco —se
 * paga una cuota, se renegocia, se salda—. Retipearla entera cada vez perdería
 * la historia y, peor, invitaría a errores en el saldo.
 *
 * La lista vuelve ordenada por PRIORIDAD y no por monto: a alguien que evita
 * mirar sus finanzas hay que hablarle primero de lo que le quita el sueño.
 */

const MAX_DEUDAS = 60;

const COLUMNAS =
  "id,acreedor,tipo,moneda,saldo_declarado,saldo_declarado_el,cuota_monto,cuota_dia," +
  "cuotas_totales,cuotas_pagadas,tasa_anual,vence_el,estado,preocupa,notas";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Sesión no válida." }, { status: 401, headers: noStore() });
  }

  const { data, error } = await supabase
    .from("eos_finanzas_deudas")
    .select(COLUMNAS)
    .eq("usuario_id", user.id);

  if (error) {
    console.error("No se pudieron leer las deudas:", error);
    return NextResponse.json(
      { error: "No pudimos cargar tus deudas." },
      { status: 500, headers: noStore() },
    );
  }

  const deudas = (data ?? []) as unknown as Deuda[];

  /*
   * Un total por moneda, no dos campos fijos.
   *
   * Antes eran `total_adeudado` (guaraníes) y `total_adeudado_usd`, porque el
   * modelo solo admitía esas dos. Una deuda con un proveedor de Ciudad del
   * Este puede estar en reales, y sumarla a los guaraníes daría un total que no
   * existe en ninguna moneda. Los dos campos viejos se mantienen para no
   * romper a quien todavía los lea.
   */
  const vivas = deudas.filter((d) => d.estado !== "saldada");
  const monedas = [...new Set(vivas.map((d) => d.moneda))];

  const totales = monedas
    .map((moneda) => ({
      moneda,
      total: totalAdeudado(deudas, moneda),
      // Lo que sale todos los meses en cuotas: el número que convierte una
      // lista de saldos en algo que se siente.
      cuota_mensual: vivas
        .filter((d) => d.moneda === moneda && estaViva(d))
        .reduce((suma, d) => suma + (d.cuota_monto ?? 0), 0),
    }))
    .sort((a, b) => b.total - a.total);

  return NextResponse.json(
    {
      deudas: porPrioridad(deudas),
      totales,
      total_adeudado: totalAdeudado(deudas),
      total_adeudado_usd: totalAdeudado(deudas, "USD"),
      proxima_cuota: proximaCuota(deudas, hoyEnParaguay()),
    },
    { headers: noStore() },
  );
}

export async function POST(request: Request) {
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

  // El tope no es burocracia: sin él, un cliente con un bucle podría llenar la
  // tabla y volver ilegible el panel del propio usuario.
  const { count, error: conteoError } = await supabase
    .from("eos_finanzas_deudas")
    .select("id", { count: "exact", head: true })
    .eq("usuario_id", user.id);

  if (!conteoError && (count ?? 0) >= MAX_DEUDAS) {
    return NextResponse.json(
      { error: `Ya tenés ${MAX_DEUDAS} deudas cargadas, que es el máximo.` },
      { status: 400, headers: noStore() },
    );
  }

  const validada = validarDeuda(body, hoyEnParaguay());
  if ("error" in validada) {
    return NextResponse.json({ error: validada.error }, { status: 400, headers: noStore() });
  }

  const { data, error } = await supabase
    .from("eos_finanzas_deudas")
    .insert({ ...validada.valor, usuario_id: user.id })
    .select(COLUMNAS)
    .single();

  if (error) {
    console.error("No se pudo guardar la deuda:", error);
    return NextResponse.json(
      { error: "No pudimos guardar la deuda." },
      { status: 500, headers: noStore() },
    );
  }

  return NextResponse.json({ deuda: data }, { status: 201, headers: noStore() });
}

function noStore() {
  return { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" };
}
