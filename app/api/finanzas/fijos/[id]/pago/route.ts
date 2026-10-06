import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { registrarAuditoria, resumirMovimiento } from "@/lib/auditoria/registrar";
import { esFechaISOValida, hoyEnParaguay } from "@/lib/fecha";
import { periodoDe } from "@/lib/finanzas/estado-fijo";

export const dynamic = "force-dynamic";

/**
 * Registrar (POST) o deshacer (DELETE) el pago de un fijo en un mes (v232).
 *
 * El pago es un movimiento común —cuenta en el panel, en el resultado y en la
 * proyección— atado a su fijo y al mes que cubre. El índice único de la v232
 * impide registrar dos veces el mismo mes, así que dos toques seguidos no
 * duplican el gasto.
 *
 * Lo de Personal queda en Personal y lo del negocio en el negocio: el ámbito
 * sale del fijo, no de lo que mande la pantalla.
 */
const MAXIMO_RAZONABLE = 999_999_999_999;

type Fijo = {
  id: string;
  tipo: "ingreso" | "gasto";
  descripcion: string;
  monto: number;
  moneda: string | null;
  ambito: "personal" | "negocio";
  pagado_hasta: string | null;
};

export async function POST(request: Request, contexto: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sesión no válida." }, { status: 401, headers: noStore() });

  const { id } = await contexto.params;
  const fijo = await leerFijo(supabase, user.id, id, ambitoDe(request));
  if (!fijo) return NextResponse.json({ error: "No encontramos ese fijo." }, { status: 404, headers: noStore() });

  let cuerpo: { monto?: unknown; fecha?: unknown; periodo?: unknown } = {};
  try {
    cuerpo = await request.json();
  } catch {
    // Sin cuerpo: se registra hoy, por el monto esperado.
  }

  const hoy = hoyEnParaguay();
  const fecha = esFechaISOValida(cuerpo.fecha) && cuerpo.fecha <= hoy ? cuerpo.fecha : hoy;
  const periodo = esFechaISOValida(cuerpo.periodo) ? periodoDe(cuerpo.periodo) : periodoDe(fecha);
  const monto = cuerpo.monto === undefined ? Number(fijo.monto) : Number(cuerpo.monto);

  if (!Number.isFinite(monto) || monto <= 0 || monto > MAXIMO_RAZONABLE) {
    return NextResponse.json({ error: "El monto tiene que ser mayor a cero." }, { status: 400, headers: noStore() });
  }

  const { data, error } = await supabase
    .from("eos_movimientos_financieros")
    .insert({
      usuario_id: user.id,
      tipo: fijo.tipo,
      monto: Math.round(monto * 100) / 100,
      moneda: fijo.moneda ?? "PYG",
      fecha,
      descripcion: fijo.descripcion.slice(0, 300),
      origen: "manual",
      ambito: fijo.ambito,
      recurrente: true,
      fijo_id: fijo.id,
      fijo_periodo: periodo,
    })
    .select("id")
    .single();

  if (error) {
    if (String(error.code) === "23505") {
      return NextResponse.json(
        { error: "Ese mes ya tiene el pago registrado." },
        { status: 409, headers: noStore() },
      );
    }
    console.error("Fijos: no se pudo registrar el pago:", error);
    return NextResponse.json({ error: "No pudimos registrar el pago." }, { status: 500, headers: noStore() });
  }

  if (!fijo.pagado_hasta || fijo.pagado_hasta < periodo) {
    const { error: marcaError } = await supabase
      .from("eos_finanzas_fijos")
      .update({ pagado_hasta: periodo, updated_at: new Date().toISOString() })
      .eq("id", fijo.id)
      .eq("usuario_id", user.id)
      .eq("ambito", fijo.ambito);
    if (marcaError) console.error("Fijos: no se pudo marcar el mes pagado:", marcaError);
  }

  await registrarAuditoria(createAdminClient() as never, {
    usuarioId: user.id,
    evento: "movimiento_confirmado",
    origen: "panel",
    resumen: resumirMovimiento({
      tipo: fijo.tipo,
      monto,
      moneda: fijo.moneda ?? "PYG",
      descripcion: fijo.descripcion,
      fuente: `pago del fijo de ${periodo.slice(0, 7)}`,
    }),
    referencia: data.id as string,
    detalle: { fijo_id: fijo.id, periodo, fecha, ambito: fijo.ambito },
  });

  return NextResponse.json(
    { ok: true, movimiento_id: data.id, periodo, fecha, monto },
    { status: 201, headers: noStore() },
  );
}

export async function DELETE(request: Request, contexto: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sesión no válida." }, { status: 401, headers: noStore() });

  const { id } = await contexto.params;
  const fijo = await leerFijo(supabase, user.id, id, ambitoDe(request));
  if (!fijo) return NextResponse.json({ error: "No encontramos ese fijo." }, { status: 404, headers: noStore() });

  const pedido = new URL(request.url).searchParams.get("periodo");
  const periodo = esFechaISOValida(pedido) ? periodoDe(pedido) : periodoDe(hoyEnParaguay());

  const { data: borrados, error } = await supabase
    .from("eos_movimientos_financieros")
    .delete()
    .eq("usuario_id", user.id)
    .eq("ambito", fijo.ambito)
    .eq("fijo_id", fijo.id)
    .eq("fijo_periodo", periodo)
    .select("id");

  if (error) {
    console.error("Fijos: no se pudo deshacer el pago:", error);
    return NextResponse.json({ error: "No pudimos deshacer el pago." }, { status: 500, headers: noStore() });
  }

  if (!borrados || borrados.length === 0) {
    return NextResponse.json({ error: "Ese mes no tenía pago registrado." }, { status: 404, headers: noStore() });
  }

  // El último mes pagado se recalcula con lo que quedó.
  const { data: ultimo } = await supabase
    .from("eos_movimientos_financieros")
    .select("fijo_periodo")
    .eq("usuario_id", user.id)
    .eq("ambito", fijo.ambito)
    .eq("fijo_id", fijo.id)
    .order("fijo_periodo", { ascending: false })
    .limit(1)
    .maybeSingle();

  await supabase
    .from("eos_finanzas_fijos")
    .update({ pagado_hasta: (ultimo?.fijo_periodo as string | undefined) ?? null, updated_at: new Date().toISOString() })
    .eq("id", fijo.id)
    .eq("usuario_id", user.id)
    .eq("ambito", fijo.ambito);

  return NextResponse.json({ ok: true, periodo }, { headers: noStore() });
}

/** De quién es el fijo: lo dice la pantalla que lo muestra (`?ambito=negocio`). Sin decirlo, personal. */
function ambitoDe(request: Request): "personal" | "negocio" {
  return new URL(request.url).searchParams.get("ambito") === "negocio" ? "negocio" : "personal";
}

async function leerFijo(
  supabase: Awaited<ReturnType<typeof createClient>>,
  usuarioId: string,
  id: string,
  ambito: "personal" | "negocio",
): Promise<Fijo | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;

  const { data, error } = await supabase
    .from("eos_finanzas_fijos")
    .select("id,tipo,descripcion,monto,moneda,ambito,pagado_hasta")
    .eq("id", id)
    .eq("usuario_id", usuarioId)
    .eq("ambito", ambito)
    .eq("activo", true)
    .maybeSingle();

  if (error) {
    console.error("Fijos: no se pudo leer el fijo:", error);
    return null;
  }

  return (data as Fijo | null) ?? null;
}

function noStore() {
  return { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" };
}
