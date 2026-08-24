import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { hoyEnParaguay } from "@/lib/fecha";

export const dynamic = "force-dynamic";

/**
 * Dónde vive la plata del usuario.
 *
 * `eos_finanzas_politica.saldo_inicial` es un número único, y una PYME
 * paraguaya real tiene cuenta en un banco, algo en una cooperativa, saldo en
 * Tigo Money y efectivo en el cajón. Esta lista no reemplaza aquel saldo: lo
 * detalla, y sobre todo hace explícito **de qué cuentas EOS ve movimientos y
 * de cuáles no**.
 *
 * Ese último dato es el que sostiene la honestidad del panel: sin él, un
 * disponible real calculado sobre una sola cuenta parece el total del negocio.
 *
 * Se reemplaza la lista completa, como los fijos: el usuario piensa "estas son
 * mis cuentas", no "quiero editar la número 3".
 */

const MAX_CUENTAS = 25;
const MAXIMO_RAZONABLE = 999_999_999_999;

const TIPOS = ["banco", "cooperativa", "financiera", "billetera", "efectivo", "tarjeta_credito"];

const COLUMNAS =
  "id,nombre,tipo,institucion,moneda,saldo_declarado,saldo_declarado_el,recibe_avisos,activa";

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
    .from("eos_finanzas_cuentas")
    .select(COLUMNAS)
    .eq("usuario_id", user.id)
    .eq("activa", true)
    .order("nombre");

  if (error) {
    console.error("No se pudieron leer las cuentas:", error);
    return NextResponse.json(
      { error: "No pudimos cargar tus cuentas." },
      { status: 500, headers: noStore() },
    );
  }

  const cuentas = data ?? [];
  const conAvisos = cuentas.filter(
    (c) => (c as unknown as { recibe_avisos: boolean }).recibe_avisos,
  ).length;

  return NextResponse.json(
    {
      cuentas,
      // Lo que EOS puede afirmar sobre su propia cobertura, sin adornos.
      cobertura: {
        total: cuentas.length,
        con_avisos: conAvisos,
        ciegas: cuentas.length - conAvisos,
      },
    },
    { headers: noStore() },
  );
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

  let body: { cuentas?: unknown };
  try {
    body = (await request.json()) as { cuentas?: unknown };
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido." }, { status: 400, headers: noStore() });
  }

  if (!Array.isArray(body.cuentas)) {
    return NextResponse.json({ error: "Formato inválido." }, { status: 400, headers: noStore() });
  }

  if (body.cuentas.length > MAX_CUENTAS) {
    return NextResponse.json(
      { error: `Son demasiadas cuentas (máximo ${MAX_CUENTAS}).` },
      { status: 400, headers: noStore() },
    );
  }

  const hoy = hoyEnParaguay();
  const limpias = [];

  for (const cruda of body.cuentas as Record<string, unknown>[]) {
    const nombre = typeof cruda.nombre === "string" ? cruda.nombre.trim() : "";
    const tipo = typeof cruda.tipo === "string" && TIPOS.includes(cruda.tipo) ? cruda.tipo : null;

    // Igual que en los fijos: la pantalla permite renglones vacíos y no tiene
    // sentido devolver un error por una fila que el usuario no llenó.
    if (!tipo || nombre.length < 2) continue;

    const saldoCrudo = cruda.saldo_declarado;
    const tieneSaldo = saldoCrudo !== null && saldoCrudo !== undefined && saldoCrudo !== "";
    const saldo = tieneSaldo ? Number(saldoCrudo) : null;

    if (saldo !== null && (!Number.isFinite(saldo) || saldo < 0 || saldo > MAXIMO_RAZONABLE)) {
      continue;
    }

    limpias.push({
      usuario_id: user.id,
      nombre: nombre.slice(0, 80),
      tipo,
      institucion:
        typeof cruda.institucion === "string" ? cruda.institucion.trim().slice(0, 80) || null : null,
      moneda: cruda.moneda === "USD" ? "USD" : "PYG",
      saldo_declarado: saldo === null ? null : Math.round(saldo * 100) / 100,
      // La restricción de la base exige fecha si hay saldo, y con razón: un
      // saldo sin fecha no se puede interpretar dos meses después.
      saldo_declarado_el: saldo === null ? null : hoy,
      recibe_avisos: cruda.recibe_avisos === true,
      activa: true,
    });
  }

  // Borrado y alta, en ese orden: si el alta fallara queda la lista vacía, que
  // es un estado honesto —el usuario lo ve y vuelve a cargar— y no una mezcla
  // silenciosa de lo viejo con lo nuevo.
  const { error: borradoError } = await supabase
    .from("eos_finanzas_cuentas")
    .delete()
    .eq("usuario_id", user.id);

  if (borradoError) {
    console.error("No se pudieron reemplazar las cuentas:", borradoError);
    return NextResponse.json(
      { error: "No pudimos guardar tus cuentas." },
      { status: 500, headers: noStore() },
    );
  }

  if (limpias.length > 0) {
    const { error: insertError } = await supabase.from("eos_finanzas_cuentas").insert(limpias);

    if (insertError) {
      console.error("No se pudieron guardar las cuentas:", insertError);
      return NextResponse.json(
        { error: "No pudimos guardar tus cuentas." },
        { status: 500, headers: noStore() },
      );
    }
  }

  return NextResponse.json({ ok: true, guardadas: limpias.length }, { headers: noStore() });
}

function noStore() {
  return { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" };
}
