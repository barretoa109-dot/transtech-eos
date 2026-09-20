import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { exigirModulo } from "@/lib/modulos/acceso";
import { filtroDeEmpresa, miEmpresa } from "@/lib/empresa/acceso";
import { monedaConocida } from "@/lib/finanzas/monedas";
import { ETAPAS, embudoPorMoneda, esEtapa, siguienteEtapa } from "@/lib/crm/embudo";
import { combinarConfig, escalaDe, type FilaConfig } from "@/lib/crm/etapas-config";
import { faltaLaColumna, validarCambios } from "@/lib/crm/oportunidades";
import { registrarAprendizajeComercial } from "@/lib/crm/aprendizaje";
import { adminSinTipos } from "@/lib/supabase/sin-tipos";

export const dynamic = "force-dynamic";

/**
 * El embudo: lo que todavía no es una venta.
 *
 * Cinco etapas y no diez. Un embudo de diez se abandona —nadie mueve tarjetas
 * todos los días— y un embudo abandonado miente peor que no tenerlo: muestra
 * oportunidades "en negociación" que se perdieron hace tres meses.
 */

/** Lo de siempre. Contra una base sin la v185 solo se pueden pedir estas. */
const COLUMNAS_BASE =
  "id,titulo,detalle,monto,moneda,etapa,cierre_estimado,motivo_perdida," +
  "creado_en,cerrada_en,contacto:eos_crm_contactos(id,nombre)";

/** Más los campos de la v185: probabilidad, qué se vende y cuándo es el próximo paso. */
const COLUMNAS = COLUMNAS_BASE + ",probabilidad,producto_servicio,proxima_accion_en";

const MAX_FILAS = 300;

export async function GET() {
  const puerta = await exigirModulo("crm");
  if (puerta.respuesta) return puerta.respuesta;

  const supabase = await createClient();

  // Las dos fronteras mientras dure la transición de la v109/v110.
  const empresaId = await miEmpresa(supabase);

  const pedir = (columnas: string) =>
    supabase
      .from("eos_crm_oportunidades")
      .select(columnas)
      .or(filtroDeEmpresa(puerta.usuarioId, empresaId))
      .order("cierre_estimado", { ascending: true, nullsFirst: false })
      .limit(MAX_FILAS);

  let { data, error } = await pedir(COLUMNAS);

  // Si la v185 todavía no está aplicada, las columnas nuevas no existen: se pide lo de
  // siempre en vez de dejar el embudo sin abrir.
  if (faltaLaColumna(error)) ({ data, error } = await pedir(COLUMNAS_BASE));

  if (error) {
    console.error("CRM: no se pudieron leer las oportunidades:", error);
    return NextResponse.json({ error: "No disponible." }, { status: 503, headers: noStore() });
  }

  // Cómo llama la empresa a sus etapas y qué probabilidad les da (v185). Sin la tabla, o
  // sin filas, son las de fábrica.
  const { data: filasConfig } = await supabase
    .from("eos_crm_etapas_config")
    .select("etapa,etiqueta,orden,visible,probabilidad_defecto")
    .or(filtroDeEmpresa(puerta.usuarioId, empresaId));
  const etapasConfig = combinarConfig((filasConfig ?? []) as FilaConfig[]);

  const oportunidades = (data ?? []) as unknown as Record<string, unknown>[];

  /*
   * El resumen se calcula acá y no en la pantalla.
   *
   * "Cuánto hay en juego" es la única cifra del embudo que alguien mira todos
   * los días, y tiene que ser la misma en la lista, en el briefing y en
   * cualquier informe. Calcularla en cada pantalla es garantizar que un día no
   * coincidan.
   */
  /*
   * Y se calcula UNA VEZ POR MONEDA.
   *
   * Antes se sumaba `monto` de todas las oportunidades sin mirar la moneda, y
   * la pantalla etiquetaba el resultado con la moneda de la primera de la
   * lista. Con una oportunidad de USD 10.000 y otra de Gs. 5.000.000 el embudo
   * decía "en juego Gs. 5.010.000": un número que no existe en ninguna moneda
   * y que el usuario no tiene forma de detectar.
   *
   * Un total pertenece a una moneda. Si hay dos monedas hay dos totales.
   */
  const conMoneda = oportunidades.map((o) => ({
    monto: Number(o.monto ?? 0),
    etapa: String(o.etapa),
    moneda: monedaConocida(o.moneda),
    // La probabilidad propia, si la persona la estimó (v185).
    probabilidad: typeof o.probabilidad === "number" ? o.probabilidad : null,
  }));

  return NextResponse.json(
    {
      oportunidades,
      // Un embudo por moneda, con la del negocio primero. Vacío si no hay
      // ninguna oportunidad todavía. El pronóstico usa la probabilidad propia de
      // cada oportunidad y, si no la tiene, la de su etapa según la empresa.
      embudos: embudoPorMoneda(conMoneda, "PYG", escalaDe(etapasConfig)),
      etapas: ETAPAS,
      // Nombre, orden, visibilidad y probabilidad de cada etapa, ya combinados.
      etapas_config: etapasConfig,
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

  // Las dos fronteras mientras dure la transición de la v109/v110.
  const empresaId = await miEmpresa(supabase);
  const contactoId =
    typeof cuerpo.contacto_id === "string" && cuerpo.contacto_id ? cuerpo.contacto_id : null;

  // La FK simple solo prueba que el UUID exista. Comprobamos pertenencia acá
  // para responder 400; el trigger v76 repite la regla como última defensa.
  if (contactoId) {
    const { data: contacto, error: contactoError } = await supabase
      .from("eos_crm_contactos")
      .select("id")
      .eq("id", contactoId)
      .or(filtroDeEmpresa(puerta.usuarioId, empresaId))
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

  // Los campos de la v185, validados. Un valor inválido es un 400 con su campo, no un
  // dato tirado en silencio.
  const validacion = validarCambios({
    probabilidad: cuerpo.probabilidad,
    producto_servicio: cuerpo.producto_servicio,
    proxima_accion_en: cuerpo.proxima_accion_en,
    cierre_estimado: cuerpo.cierre_estimado,
  });
  if (!validacion.ok) {
    return NextResponse.json({ error: validacion.error, campo: validacion.campo }, { status: 400, headers: noStore() });
  }

  const filaBase = {
    usuario_id: puerta.usuarioId,
    contacto_id: contactoId,
    titulo,
    detalle: String(cuerpo.detalle ?? "").trim().slice(0, 2000) || null,
    monto: Math.max(0, Number(cuerpo.monto) || 0),
    moneda: monedaConocida(cuerpo.moneda),
    etapa: esEtapa(cuerpo.etapa) ? cuerpo.etapa : "nueva",
    cierre_estimado: (validacion.cambios.base.cierre_estimado as string | null | undefined) ?? null,
  };

  // Solo se mandan los campos nuevos si la persona llenó alguno: contra una base sin la
  // v185, escribirlos rompería una oportunidad que no los necesita.
  const hayNuevos = Object.values(validacion.cambios.nuevos).some((v) => v !== null && v !== undefined);

  let { data, error } = await supabase
    .from("eos_crm_oportunidades")
    .insert(hayNuevos ? { ...filaBase, ...validacion.cambios.nuevos } : filaBase)
    .select(COLUMNAS)
    .single();

  // La v185 sin aplicar: se guarda lo de siempre y se lee lo de siempre.
  if (faltaLaColumna(error)) {
    ({ data, error } = await supabase.from("eos_crm_oportunidades").insert(filaBase).select(COLUMNAS_BASE).single());
  }

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
 * Mover una oportunidad de etapa, y/o editar sus datos.
 *
 * Mover es la operación del embudo que se usa a diario, así que sigue siendo un PATCH
 * con un solo campo: `{ id, etapa }`. Si mover una tarjeta cuesta tres clics, el
 * embudo deja de estar al día en una semana. Editar (probabilidad, qué se vende,
 * próximo paso, monto…) viaja por el mismo camino y solo toca lo que vino.
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

  // Qué viene: mover de etapa, editar campos, o las dos cosas a la vez.
  const validacion = validarCambios(cuerpo);
  if (!validacion.ok) {
    return NextResponse.json({ error: validacion.error, campo: validacion.campo }, { status: 400, headers: noStore() });
  }

  const cambiaEtapa = esEtapa(cuerpo.etapa);
  const hayEdicion = Object.keys(validacion.cambios.base).length + Object.keys(validacion.cambios.nuevos).length > 0;

  if (!cambiaEtapa && !hayEdicion) {
    return NextResponse.json({ error: "No hay nada que cambiar." }, { status: 400, headers: noStore() });
  }

  const etapa = cambiaEtapa ? (cuerpo.etapa as string) : null;
  const cerrada = etapa === "ganada" || etapa === "perdida";

  const supabase = await createClient();

  // Las dos fronteras mientras dure la transición de la v109/v110.
  const empresaId = await miEmpresa(supabase);

  const cambiosDeEtapa = etapa
    ? {
        etapa,
        // La fecha de cierre se pone al cerrar y se borra al reabrir: una
        // oportunidad que vuelve a negociación con fecha de cierre vieja arruina
        // cualquier métrica de cuánto tarda en cerrarse una venta.
        cerrada_en: cerrada ? new Date().toISOString() : null,
        motivo_perdida:
          etapa === "perdida"
            ? String(cuerpo.motivo_perdida ?? "").trim().slice(0, 500) || null
            : null,
      }
    : {};

  const hayNuevos = Object.keys(validacion.cambios.nuevos).length > 0;

  const actualizar = (conNuevos: boolean, columnas: string) =>
    supabase
      .from("eos_crm_oportunidades")
      .update({
        ...cambiosDeEtapa,
        ...validacion.cambios.base,
        ...(conNuevos ? validacion.cambios.nuevos : {}),
        actualizado_en: new Date().toISOString(),
      })
      .eq("id", id)
      .or(filtroDeEmpresa(puerta.usuarioId, empresaId))
      .select(columnas)
      .maybeSingle();

  let { data, error } = await actualizar(hayNuevos, COLUMNAS);

  if (faltaLaColumna(error)) {
    // La v185 sin aplicar. Si solo se pedían campos nuevos, no hay nada que hacer todavía;
    // si además se movía de etapa, se mueve y se dice que lo demás no se pudo guardar.
    if (!cambiaEtapa && Object.keys(validacion.cambios.base).length === 0) {
      return NextResponse.json(
        { error: "Esos campos todavía no están disponibles en tu cuenta." },
        { status: 409, headers: noStore() },
      );
    }
    ({ data, error } = await actualizar(false, COLUMNAS_BASE));
  }

  if (error) {
    console.error("CRM: no se pudo actualizar la oportunidad:", error);
    return NextResponse.json(
      { error: "No pudimos actualizar la oportunidad." },
      { status: 503, headers: noStore() },
    );
  }

  if (!data) {
    return NextResponse.json(
      { error: "Oportunidad no encontrada." },
      { status: 404, headers: noStore() },
    );
  }

  // Cuando se CIERRA una oportunidad (ganada o perdida), EOS aprende del resultado. Si eso
  // falla, la oportunidad ya está cerrada: no se deshace por una nota de aprendizaje.
  if (cerrada) {
    await registrarAprendizajeComercial(adminSinTipos(), puerta.usuarioId).catch((e) =>
      console.error("CRM: no se pudo registrar el aprendizaje del cierre:", e),
    );
  }

  return NextResponse.json({ oportunidad: data }, { headers: noStore() });
}

function noStore() {
  return { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" };
}
