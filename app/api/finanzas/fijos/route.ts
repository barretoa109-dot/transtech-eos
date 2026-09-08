import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

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
    .select("id,tipo,descripcion,monto,dia_del_mes")
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

  return NextResponse.json({ fijos: data ?? [] }, { headers: noStore() });
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

  const limpios: {
    usuario_id: string;
    tipo: string;
    descripcion: string;
    monto: number;
    dia_del_mes: number;
    ambito: string;
  }[] = [];

  for (const crudo of body.fijos as FijoEntrada[]) {
    const tipo = crudo.tipo === "ingreso" || crudo.tipo === "gasto" ? crudo.tipo : null;
    const descripcion = typeof crudo.descripcion === "string" ? crudo.descripcion.trim() : "";
    const monto = Number(crudo.monto);
    const dia = Math.round(Number(crudo.dia_del_mes));

    // Se descartan en silencio las filas incompletas: la pantalla permite
    // agregar renglones vacíos, y no tiene sentido devolver un error por una
    // fila que el usuario simplemente no llenó.
    if (!tipo || descripcion.length < 2) continue;
    if (!Number.isFinite(monto) || monto <= 0 || monto > MAXIMO_RAZONABLE) continue;
    if (!Number.isFinite(dia) || dia < 1 || dia > 31) continue;

    limpios.push({
      usuario_id: user.id,
      tipo,
      descripcion: descripcion.slice(0, 120),
      monto: Math.round(monto * 100) / 100,
      dia_del_mes: dia,
      ambito,
    });
  }

  // Reemplazo total. El borrado va primero y el insert después: si el insert
  // fallara quedaría la lista vacía, que es un estado honesto —el usuario ve
  // que no quedó nada y vuelve a cargar— y no una mezcla de lo viejo y lo nuevo.
  const { error: borradoError } = await supabase
    .from("eos_finanzas_fijos")
    .delete()
    .eq("usuario_id", user.id)
    // Acotado al ámbito que se está guardando: sin esto, guardar los fijos
    // personales borraría los del negocio, que la pantalla ni siquiera mandó.
    .eq("ambito", ambito);

  if (borradoError) {
    console.error("No se pudieron reemplazar los fijos:", borradoError);
    return NextResponse.json(
      { error: "No pudimos guardar tus fijos." },
      { status: 500, headers: noStore() },
    );
  }

  if (limpios.length > 0) {
    const { error: insertError } = await supabase.from("eos_finanzas_fijos").insert(limpios);

    if (insertError) {
      console.error("No se pudieron guardar los fijos:", insertError);
      return NextResponse.json(
        { error: "No pudimos guardar tus fijos." },
        { status: 500, headers: noStore() },
      );
    }
  }

  return NextResponse.json({ ok: true, guardados: limpios.length }, { headers: noStore() });
}

function noStore() {
  return { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" };
}
