import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { exigirModulo } from "@/lib/modulos/acceso";
import { monedaConocida } from "@/lib/finanzas/monedas";
import { ETAPAS, esEtapa, porEtapa, siguienteEtapa, valorPonderado } from "@/lib/crm/embudo";

export const dynamic = "force-dynamic";

/**
 * El embudo: lo que todavía no es una venta.
 *
 * Cinco etapas y no diez. Un embudo de diez se abandona —nadie mueve tarjetas
 * todos los días— y un embudo abandonado miente peor que no tenerlo: muestra
 * oportunidades "en negociación" que se perdieron hace tres meses.
 */

const COLUMNAS =
  "id,titulo,detalle,monto,moneda,etapa,cierre_estimado,motivo_perdida," +
  "creado_en,cerrada_en,contacto:eos_crm_contactos(id,nombre)";

const MAX_FILAS = 300;

export async function GET() {
  const puerta = await exigirModulo("crm");
  if (puerta.respuesta) return puerta.respuesta;

  const supabase = await createClient();

  const { data, error } = await supabase
    .from("eos_crm_oportunidades")
    .select(COLUMNAS)
    .eq("usuario_id", puerta.usuarioId)
    .order("cierre_estimado", { ascending: true, nullsFirst: false })
    .limit(MAX_FILAS);

  if (error) {
    console.error("CRM: no se pudieron leer las oportunidades:", error);
    return NextResponse.json({ error: "No disponible." }, { status: 503, headers: noStore() });
  }

  const oportunidades = (data ?? []) as unknown as Record<string, unknown>[];

  /*
   * El resumen se calcula acá y no en la pantalla.
   *
   * "Cuánto hay en juego" es la única cifra del embudo que alguien mira todos
   * los días, y tiene que ser la misma en la lista, en el briefing y en
   * cualquier informe. Calcularla en cada pantalla es garantizar que un día no
   * coincidan.
   */
  const abiertas = oportunidades.filter(
    (o) => o.etapa !== "ganada" && o.etapa !== "perdida",
  );

  const enJuego = abiertas.reduce((total, o) => total + Number(o.monto ?? 0), 0);
  const ganadas = oportunidades.filter((o) => o.etapa === "ganada");

  const paraPonderar = oportunidades.map((o) => ({
    monto: Number(o.monto ?? 0),
    etapa: String(o.etapa),
  }));

  return NextResponse.json(
    {
      oportunidades,
      resumen: {
        abiertas: abiertas.length,
        // Lo que suma el embudo entero. Es cierto y no significa nada solo.
        en_juego: Math.round(enJuego),
        // Lo que razonablemente va a entrar, según en qué etapa está cada una.
        // Es la cifra que se puede mirar sin gastar plata que no existe.
        esperado: valorPonderado(paraPonderar),
        ganadas: ganadas.length,
        ganado: Math.round(ganadas.reduce((t, o) => t + Number(o.monto ?? 0), 0)),
        por_etapa: porEtapa(paraPonderar),
      },
      etapas: ETAPAS,
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

  const titulo = String(cuerpo.titulo ?? "").trim().slice(0, 200);
  if (!titulo) {
    return NextResponse.json(
      { error: "La oportunidad necesita un título." },
      { status: 400, headers: noStore() },
    );
  }

  const supabase = await createClient();
  const contactoId =
    typeof cuerpo.contacto_id === "string" && cuerpo.contacto_id ? cuerpo.contacto_id : null;

  // La FK simple solo prueba que el UUID exista. Comprobamos pertenencia acá
  // para responder 400; el trigger v76 repite la regla como última defensa.
  if (contactoId) {
    const { data: contacto, error: contactoError } = await supabase
      .from("eos_crm_contactos")
      .select("id")
      .eq("id", contactoId)
      .eq("usuario_id", puerta.usuarioId)
      .maybeSingle();

    if (contactoError) {
      console.error("CRM: no se pudo validar el contacto:", contactoError);
      return NextResponse.json(
        { error: "No pudimos validar el contacto." },
        { status: 503, headers: noStore() },
      );
    }

    if (!contacto) {
      return NextResponse.json(
        { error: "El contacto no pertenece a tu cuenta." },
        { status: 400, headers: noStore() },
      );
    }
  }

  const { data, error } = await supabase
    .from("eos_crm_oportunidades")
    .insert({
      usuario_id: puerta.usuarioId,
      contacto_id: contactoId,
      titulo,
      detalle: String(cuerpo.detalle ?? "").trim().slice(0, 2000) || null,
      monto: Math.max(0, Number(cuerpo.monto) || 0),
      moneda: monedaConocida(cuerpo.moneda),
      etapa: esEtapa(cuerpo.etapa) ? cuerpo.etapa : "nueva",
      cierre_estimado: /^\d{4}-\d{2}-\d{2}$/.test(String(cuerpo.cierre_estimado ?? ""))
        ? String(cuerpo.cierre_estimado)
        : null,
    })
    .select(COLUMNAS)
    .single();

  if (error) {
    if (String(error.message ?? "").includes("EOS_CONTACTO_AJENO")) {
      return NextResponse.json(
        { error: "El contacto no pertenece a tu cuenta." },
        { status: 400, headers: noStore() },
      );
    }

    console.error("CRM: no se pudo guardar la oportunidad:", error);
    return NextResponse.json(
      { error: "No pudimos guardar la oportunidad." },
      { status: 503, headers: noStore() },
    );
  }

  return NextResponse.json({ oportunidad: data }, { status: 201, headers: noStore() });
}

/**
 * Mover una oportunidad de etapa.
 *
 * Es la única operación del embudo que se usa a diario, así que es un PATCH con
 * un solo campo y no un formulario de edición. Si mover una tarjeta cuesta tres
 * clics, el embudo deja de estar al día en una semana.
 */
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
    return NextResponse.json(
      { error: "Oportunidad no encontrada." },
      { status: 404, headers: noStore() },
    );
  }

  const etapa = esEtapa(cuerpo.etapa) ? cuerpo.etapa : siguienteEtapa("nueva");
  const cerrada = etapa === "ganada" || etapa === "perdida";

  const supabase = await createClient();

  const { data, error } = await supabase
    .from("eos_crm_oportunidades")
    .update({
      etapa,
      // La fecha de cierre se pone al cerrar y se borra al reabrir: una
      // oportunidad que vuelve a negociación con fecha de cierre vieja arruina
      // cualquier métrica de cuánto tarda en cerrarse una venta.
      cerrada_en: cerrada ? new Date().toISOString() : null,
      motivo_perdida:
        etapa === "perdida"
          ? String(cuerpo.motivo_perdida ?? "").trim().slice(0, 500) || null
          : null,
      actualizado_en: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("usuario_id", puerta.usuarioId)
    .select(COLUMNAS)
    .maybeSingle();

  if (error) {
    console.error("CRM: no se pudo mover la oportunidad:", error);
    return NextResponse.json(
      { error: "No pudimos mover la oportunidad." },
      { status: 503, headers: noStore() },
    );
  }

  if (!data) {
    return NextResponse.json(
      { error: "Oportunidad no encontrada." },
      { status: 404, headers: noStore() },
    );
  }

  return NextResponse.json({ oportunidad: data }, { headers: noStore() });
}

function noStore() {
  return { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" };
}
