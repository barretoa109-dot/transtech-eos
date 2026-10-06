import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { hoyEnParaguay } from "@/lib/fecha";
import { estadoDelFijo, periodoAnterior, periodoDe, type PagoDeFijo } from "@/lib/finanzas/estado-fijo";

export const dynamic = "force-dynamic";

/**
 * Ingresos y gastos fijos que el usuario declara una vez.
 *
 * Es lo que permite que el panel sirva desde el primer día en vez de esperar
 * dos meses a que el detector de recurrencia vea cada gasto dos veces.
 *
 * El PUT reemplaza la lista completa en vez de aplicar altas y bajas sueltas:
 * el usuario piensa "estos son mis gastos fijos", no "quiero borrar el ítem 3".
 * Un reemplazo total hace imposible que la lista de la pantalla y la de la
 * base queden distintas.
 */

const MAX_FIJOS = 40;

/*
 * De quién son los fijos que se piden.
 *
 * Desde la v136 esta tabla guarda los dos: el alquiler de la casa y el sueldo
 * de un empleado. La ruta estaba clavada en "personal", así que un fijo del
 * negocio —que el chat sí sabe registrar y que YA entra en los números de
 * rentabilidad— no se veía ni se podía corregir desde ninguna pantalla.
 *
 * El default sigue siendo personal: es lo que pide la pantalla de Personal,
 * que es la que existía cuando esta ruta se escribió.
 */
function ambitoDe(valor: unknown): "negocio" | "personal" {
  return valor === "negocio" ? "negocio" : "personal";
}
const MAXIMO_RAZONABLE = 999_999_999_999;

type FijoEntrada = {
  id?: unknown;
  tipo?: unknown;
  descripcion?: unknown;
  monto?: unknown;
  dia_del_mes?: unknown;
};

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Sesión no válida." }, { status: 401, headers: noStore() });
  }

  const ambito = ambitoDe(new URL(request.url).searchParams.get("ambito"));

  const { data, error } = await supabase
    .from("eos_finanzas_fijos")
    .select("id,tipo,descripcion,monto,moneda,dia_del_mes,pagado_hasta")
    .eq("usuario_id", user.id)
    .eq("ambito", ambito)
    .eq("activo", true)
    .order("tipo", { ascending: true })
    .order("dia_del_mes", { ascending: true });

  if (error) {
    console.error("No se pudieron leer los fijos:", error);
    return NextResponse.json(
      { error: "No pudimos cargar tus fijos." },
      { status: 500, headers: noStore() },
    );
  }

  /*
   * En qué está cada fijo este mes (v232): el concepto, el vencimiento y el
   * pago registrado, por separado. Si los pagos no se pueden leer, la lista
   * sale igual y sin estado: la pantalla de edición no depende de esto.
   */
  const filas = (data ?? []) as Record<string, unknown>[];
  const hoy = hoyEnParaguay();
  const desde = periodoAnterior(periodoDe(hoy), 2);
  const pagosPorFijo = new Map<string, PagoDeFijo[]>();

  if (filas.length > 0) {
    const { data: pagos, error: pagosError } = await supabase
      .from("eos_movimientos_financieros")
      .select("id,fijo_id,fijo_periodo,fecha,monto")
      .eq("usuario_id", user.id)
      .eq("ambito", ambito)
      .in("fijo_id", filas.map((f) => f.id as string))
      .gte("fijo_periodo", desde);

    if (pagosError) console.error("No se pudieron leer los pagos de los fijos:", pagosError);

    for (const p of (pagos ?? []) as Record<string, unknown>[]) {
      const lista = pagosPorFijo.get(p.fijo_id as string) ?? [];
      lista.push({
        periodo: String(p.fijo_periodo),
        fecha: String(p.fecha),
        monto: Number(p.monto ?? 0),
        movimiento_id: String(p.id),
      });
      pagosPorFijo.set(p.fijo_id as string, lista);
    }
  }

  const fijos = filas.map((f) => ({
    ...f,
    monto: Number(f.monto ?? 0),
    estado: estadoDelFijo({
      dia_del_mes: Number(f.dia_del_mes),
      pagos: pagosPorFijo.get(f.id as string) ?? [],
      hoy,
    }),
  }));

  return NextResponse.json({ fijos, hoy }, { headers: noStore() });
}

export async function PUT(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Sesión no válida." }, { status: 401, headers: noStore() });
  }

  let body: { fijos?: unknown; ambito?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido." }, { status: 400, headers: noStore() });
  }

  if (!Array.isArray(body.fijos)) {
    return NextResponse.json({ error: "Formato inválido." }, { status: 400, headers: noStore() });
  }

  if (body.fijos.length > MAX_FIJOS) {
    return NextResponse.json(
      { error: `Son demasiados fijos (máximo ${MAX_FIJOS}).` },
      { status: 400, headers: noStore() },
    );
  }

  const ambito = ambitoDe(body.ambito);

  type Limpio = {
    id: string | null;
    tipo: string;
    descripcion: string;
    monto: number;
    dia_del_mes: number;
  };

  const limpios: Limpio[] = [];

  for (const crudo of body.fijos as FijoEntrada[]) {
    const tipo = crudo.tipo === "ingreso" || crudo.tipo === "gasto" ? crudo.tipo : null;
    const descripcion = typeof crudo.descripcion === "string" ? crudo.descripcion.trim() : "";
    const monto = Number(crudo.monto);
    const dia = Math.round(Number(crudo.dia_del_mes));

    if (!tipo || descripcion.length < 2) continue;
    if (!Number.isFinite(monto) || monto <= 0 || monto > MAXIMO_RAZONABLE) continue;
    if (!Number.isFinite(dia) || dia < 1 || dia > 31) continue;

    limpios.push({
      id: typeof crudo.id === "string" && /^[0-9a-f-]{36}$/i.test(crudo.id) ? crudo.id : null,
      tipo,
      descripcion: descripcion.slice(0, 120),
      monto: Math.round(monto * 100) / 100,
      dia_del_mes: dia,
    });
  }

  /*
   * Reemplazo de la lista, pero conservando cada fila (v232).
   *
   * Antes se borraba todo y se volvía a insertar. Desde que un pago queda
   * atado a su fijo, eso cortaba el hilo: editar el monto de internet le hacía
   * perder el registro de que octubre ya estaba pago. Ahora el fijo que vuelve
   * con su id se actualiza, el nuevo se inserta y el que ya no está se da de
   * baja (activo = false). Para quien mira la pantalla es lo mismo que antes:
   * la lista guardada es exactamente la que mandó.
   */
  const { data: actuales, error: leerError } = await supabase
    .from("eos_finanzas_fijos")
    .select("id")
    .eq("usuario_id", user.id)
    .eq("ambito", ambito)
    .eq("activo", true);

  if (leerError) {
    console.error("No se pudieron leer los fijos para reemplazarlos:", leerError);
    return NextResponse.json({ error: "No pudimos guardar tus fijos." }, { status: 500, headers: noStore() });
  }

  const existentes = new Set(((actuales ?? []) as { id: string }[]).map((f) => f.id));
  const ahora = new Date().toISOString();
  const conservados = new Set<string>();

  for (const fijo of limpios) {
    if (fijo.id && existentes.has(fijo.id) && !conservados.has(fijo.id)) {
      conservados.add(fijo.id);
      const { error } = await supabase
        .from("eos_finanzas_fijos")
        .update({
          tipo: fijo.tipo,
          descripcion: fijo.descripcion,
          monto: fijo.monto,
          dia_del_mes: fijo.dia_del_mes,
          updated_at: ahora,
        })
        .eq("id", fijo.id)
        .eq("usuario_id", user.id)
        .eq("ambito", ambito);

      if (error) {
        console.error("No se pudo actualizar un fijo:", error);
        return NextResponse.json({ error: "No pudimos guardar tus fijos." }, { status: 500, headers: noStore() });
      }
      continue;
    }

    const { error } = await supabase.from("eos_finanzas_fijos").insert({
      usuario_id: user.id,
      tipo: fijo.tipo,
      descripcion: fijo.descripcion,
      monto: fijo.monto,
      dia_del_mes: fijo.dia_del_mes,
      ambito,
    });

    if (error) {
      console.error("No se pudieron guardar los fijos:", error);
      return NextResponse.json({ error: "No pudimos guardar tus fijos." }, { status: 500, headers: noStore() });
    }
  }

  const dadosDeBaja = [...existentes].filter((id) => !conservados.has(id));

  if (dadosDeBaja.length > 0) {
    const { error } = await supabase
      .from("eos_finanzas_fijos")
      .update({ activo: false, updated_at: ahora })
      .eq("usuario_id", user.id)
      .eq("ambito", ambito)
      .in("id", dadosDeBaja);

    if (error) {
      console.error("No se pudieron dar de baja los fijos:", error);
      return NextResponse.json({ error: "No pudimos guardar tus fijos." }, { status: 500, headers: noStore() });
    }
  }

  return NextResponse.json({ ok: true, guardados: limpios.length }, { headers: noStore() });
}

function noStore() {
  return { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" };
}
