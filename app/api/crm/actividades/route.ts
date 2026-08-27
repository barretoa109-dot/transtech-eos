import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { exigirModulo } from "@/lib/modulos/acceso";
import { hoyEnParaguay } from "@/lib/fecha";

export const dynamic = "force-dynamic";

/**
 * Lo que se habló con alguien, y lo que hay que hacer.
 *
 * ============================================================
 * POR QUÉ LAS NOTAS Y LAS TAREAS SON LA MISMA TABLA
 * ============================================================
 *
 * Un CRM de manual separa "actividades" de "tareas pendientes". El usuario no
 * piensa en dos listas: piensa en "lo del cliente". Una llamada que ya ocurrió
 * y un "llamarlo el martes" son la misma cosa vista desde dos momentos, y la
 * diferencia es una fecha y un booleano.
 *
 * Separarlas obliga a decidir en qué lista va cada apunte antes de escribirlo,
 * y esa decisión —chiquita, repetida veinte veces por día— es la que hace que
 * la gente deje de anotar.
 */

const COLUMNAS =
  "id,tipo,detalle,fecha,hecha,creado_en,contacto_id,oportunidad_id," +
  "contacto:eos_crm_contactos(id,nombre)";

const TIPOS = new Set(["llamada", "reunion", "correo", "whatsapp", "nota", "tarea"]);
const MAX_FILAS = 200;

export async function GET(request: Request) {
  const puerta = await exigirModulo("crm");
  if (puerta.respuesta) return puerta.respuesta;

  const supabase = await createClient();
  const { searchParams } = new URL(request.url);

  let consulta = supabase
    .from("eos_crm_actividades")
    .select(COLUMNAS)
    .eq("usuario_id", puerta.usuarioId)
    .order("fecha", { ascending: false })
    .limit(MAX_FILAS);

  const contactoId = searchParams.get("contacto_id");
  if (contactoId) consulta = consulta.eq("contacto_id", contactoId);

  // `?pendientes=1` es el pedido de la pantalla de inicio: lo que hay que
  // hacer, no lo que ya se hizo.
  if (searchParams.get("pendientes") === "1") consulta = consulta.eq("hecha", false);

  const { data, error } = await consulta;

  if (error) {
    console.error("CRM: no se pudieron leer las actividades:", error);
    return NextResponse.json({ error: "No disponible." }, { status: 503, headers: noStore() });
  }

  const actividades = (data ?? []) as unknown as Record<string, unknown>[];
  const hoy = hoyEnParaguay();

  /*
   * "Vencidas" se calcula acá y no en la pantalla.
   *
   * Es la única cifra de esta lista que importa de verdad —lo que se prometió y
   * no se hizo— y tiene que dar igual en la lista, en el briefing y en cualquier
   * recordatorio. Que cada pantalla la derive es garantizar que un día no
   * coincidan.
   */
  const pendientes = actividades.filter((a) => a.hecha === false);

  return NextResponse.json(
    {
      actividades,
      resumen: {
        pendientes: pendientes.length,
        vencidas: pendientes.filter((a) => String(a.fecha) < hoy).length,
        para_hoy: pendientes.filter((a) => String(a.fecha) === hoy).length,
      },
    },
    { headers: noStore() },
  );
}

export async function POST(request: Request) {
  const puerta = await exigirModulo("crm");
  if (puerta.respuesta) return puerta.respuesta;

  let cuerpo: Record<string, unknown>;
  try {
    cuerpo = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido." }, { status: 400, headers: noStore() });
  }

  const detalle = String(cuerpo.detalle ?? "").trim().slice(0, 4000);
  if (!detalle) {
    return NextResponse.json(
      { error: "Escribí qué pasó o qué hay que hacer." },
      { status: 400, headers: noStore() },
    );
  }

  const tipo = TIPOS.has(String(cuerpo.tipo)) ? String(cuerpo.tipo) : "nota";
  const fecha = /^\d{4}-\d{2}-\d{2}$/.test(String(cuerpo.fecha ?? ""))
    ? String(cuerpo.fecha)
    : hoyEnParaguay();

  /*
   * Una tarea nace pendiente; una nota nace hecha.
   *
   * Es lo que evita el campo "¿está hecha?" al lado de cada apunte: anotar lo
   * que ya pasó no debería obligar a marcar nada, y anotar lo que falta hacer
   * no debería obligar a desmarcarlo.
   */
  const hecha = typeof cuerpo.hecha === "boolean" ? cuerpo.hecha : tipo !== "tarea";

  const supabase = await createClient();
  const contactoId =
    typeof cuerpo.contacto_id === "string" && cuerpo.contacto_id ? cuerpo.contacto_id : null;
  const oportunidadId =
    typeof cuerpo.oportunidad_id === "string" && cuerpo.oportunidad_id
      ? cuerpo.oportunidad_id
      : null;

  const [contactoRespuesta, oportunidadRespuesta] = await Promise.all([
    contactoId
      ? supabase
          .from("eos_crm_contactos")
          .select("id")
          .eq("id", contactoId)
          .eq("usuario_id", puerta.usuarioId)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    oportunidadId
      ? supabase
          .from("eos_crm_oportunidades")
          .select("id,contacto_id")
          .eq("id", oportunidadId)
          .eq("usuario_id", puerta.usuarioId)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);

  if (contactoRespuesta.error || oportunidadRespuesta.error) {
    console.error(
      "CRM: no se pudieron validar las relaciones de la actividad:",
      contactoRespuesta.error || oportunidadRespuesta.error,
    );
    return NextResponse.json(
      { error: "No pudimos validar el contacto o la oportunidad." },
      { status: 503, headers: noStore() },
    );
  }

  if (contactoId && !contactoRespuesta.data) {
    return NextResponse.json(
      { error: "El contacto no pertenece a tu cuenta." },
      { status: 400, headers: noStore() },
    );
  }

  if (oportunidadId && !oportunidadRespuesta.data) {
    return NextResponse.json(
      { error: "La oportunidad no pertenece a tu cuenta." },
      { status: 400, headers: noStore() },
    );
  }

  if (
    contactoId &&
    oportunidadRespuesta.data?.contacto_id &&
    contactoId !== oportunidadRespuesta.data.contacto_id
  ) {
    return NextResponse.json(
      { error: "El contacto no coincide con el de la oportunidad." },
      { status: 400, headers: noStore() },
    );
  }

  const { data, error } = await supabase
    .from("eos_crm_actividades")
    .insert({
      usuario_id: puerta.usuarioId,
      contacto_id: contactoId,
      oportunidad_id: oportunidadId,
      tipo,
      detalle,
      fecha,
      hecha,
    })
    .select(COLUMNAS)
    .single();

  if (error) {
    const texto = String(error.message ?? "");
    if (texto.includes("EOS_CONTACTO_AJENO") || texto.includes("EOS_OPORTUNIDAD_AJENA")) {
      return NextResponse.json(
        { error: "El contacto o la oportunidad no pertenecen a tu cuenta." },
        { status: 400, headers: noStore() },
      );
    }
    if (texto.includes("EOS_ACTIVIDAD_RELACIONES_INCONSISTENTES")) {
      return NextResponse.json(
        { error: "El contacto no coincide con el de la oportunidad." },
        { status: 400, headers: noStore() },
      );
    }

    console.error("CRM: no se pudo guardar la actividad:", error);
    return NextResponse.json(
      { error: "No pudimos guardar la nota." },
      { status: 503, headers: noStore() },
    );
  }

  return NextResponse.json({ actividad: data }, { status: 201, headers: noStore() });
}

/** Marcar una tarea como hecha, que es lo único que se edita a diario. */
export async function PATCH(request: Request) {
  const puerta = await exigirModulo("crm");
  if (puerta.respuesta) return puerta.respuesta;

  let cuerpo: Record<string, unknown>;
  try {
    cuerpo = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido." }, { status: 400, headers: noStore() });
  }

  const id = String(cuerpo.id ?? "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: "No encontrada." }, { status: 404, headers: noStore() });
  }

  const supabase = await createClient();

  const { data, error } = await supabase
    .from("eos_crm_actividades")
    .update({ hecha: cuerpo.hecha !== false })
    .eq("id", id)
    .eq("usuario_id", puerta.usuarioId)
    .select(COLUMNAS)
    .maybeSingle();

  if (error) {
    console.error("CRM: no se pudo actualizar la actividad:", error);
    return NextResponse.json(
      { error: "No pudimos actualizarla." },
      { status: 503, headers: noStore() },
    );
  }

  if (!data) {
    return NextResponse.json({ error: "No encontrada." }, { status: 404, headers: noStore() });
  }

  return NextResponse.json({ actividad: data }, { headers: noStore() });
}

function noStore() {
  return { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" };
}
