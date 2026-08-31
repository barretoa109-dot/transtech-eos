import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { adminSinTipos } from "@/lib/supabase/sin-tipos";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json(
      { error: "Sesión no válida." },
      { status: 401, headers: noStoreHeaders() },
    );
  }

  const [summaryResult, learningsResult] = await Promise.all([
    supabase
      .from("eos_learning_summary_v7")
      .select("evidence_count,positive_count,negative_count,neutral_count,evidence_type_count,eligible,active_learnings,average_confidence,latest_learning_at")
      .eq("usuario_id", user.id)
      .maybeSingle(),
    /*
     * Van también los descartados.
     *
     * Antes se filtraba por `estado = 'activo'`, y con la v96 eso sería una
     * trampa: el usuario descarta un aprendizaje, desaparece de la pantalla, y
     * ya no tiene forma de restaurarlo si se arrepintió. Descartar sin poder
     * deshacer no es una opción, es un borrado disfrazado.
     */
    supabase
      .from("eos_learnings")
      .select(
        "id,clave,categoria,patron,recomendacion,recomendacion_original,tendencia,confianza," +
          "evidence_count,positive_count,negative_count,first_observed_at,last_observed_at," +
          "generated_at,updated_at,estado,corregido_en,descartado_en,descartado_motivo",
      )
      .eq("usuario_id", user.id)
      .in("estado", ["activo", "descartado"])
      .order("confianza", { ascending: false })
      .order("updated_at", { ascending: false })
      .limit(40),
  ]);

  if (summaryResult.error || learningsResult.error) {
    console.error("No se pudieron cargar los aprendizajes:", {
      summary: summaryResult.error,
      learnings: learningsResult.error,
    });

    return NextResponse.json(
      { error: "No pudimos cargar los aprendizajes en este momento." },
      { status: 500, headers: noStoreHeaders() },
    );
  }

  const summary = summaryResult.data ?? {
    evidence_count: 0,
    positive_count: 0,
    negative_count: 0,
    neutral_count: 0,
    evidence_type_count: 0,
    eligible: false,
    active_learnings: 0,
    average_confidence: null,
    latest_learning_at: null,
  };

  return NextResponse.json(
    { summary, learnings: learningsResult.data ?? [], minimum_evidence: 3 },
    { headers: noStoreHeaders() },
  );
}

/**
 * Corregir, descartar, restaurar o eliminar un aprendizaje.
 *
 * Hasta la v96 esto era solo lectura: el usuario podía ver lo que EOS creía de
 * él y no podía hacer nada al respecto. Un sistema que saca conclusiones sobre
 * una persona y no le deja discutirlas no es un asistente, es un expediente.
 *
 * Pasa por la función de la base y no por un update directo porque la RLS solo
 * le da `select` sobre la tabla — y porque el filtro por dueño tiene que estar
 * del lado del servidor, no en un `.eq()` que alguien pueda olvidar mañana.
 */
export async function PATCH(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json(
      { error: "Sesión no válida." },
      { status: 401, headers: noStoreHeaders() },
    );
  }

  let cuerpo: Record<string, unknown>;
  try {
    cuerpo = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { error: "Cuerpo inválido." },
      { status: 400, headers: noStoreHeaders() },
    );
  }

  const id = typeof cuerpo.id === "string" ? cuerpo.id : "";
  const accion = typeof cuerpo.accion === "string" ? cuerpo.accion.toLowerCase() : "";

  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json(
      { error: "Aprendizaje no encontrado." },
      { status: 404, headers: noStoreHeaders() },
    );
  }

  if (!ACCIONES.includes(accion)) {
    return NextResponse.json(
      { error: "Acción inválida." },
      { status: 400, headers: noStoreHeaders() },
    );
  }

  const texto =
    typeof cuerpo.texto === "string" ? cuerpo.texto.trim().slice(0, 1000) || null : null;

  if (accion === "corregir" && !texto) {
    return NextResponse.json(
      { error: "Escribí con tus palabras lo que EOS tendría que haber entendido." },
      { status: 400, headers: noStoreHeaders() },
    );
  }

  const { data, error } = await adminSinTipos().rpc("eos_gestionar_aprendizaje_v96", {
    p_usuario_id: user.id,
    p_learning_id: id,
    p_accion: accion,
    p_texto: texto,
  });

  if (error) {
    const mensaje = String(error.message ?? "");

    if (mensaje.includes("EOS_APRENDIZAJE_NO_EXISTE")) {
      return NextResponse.json(
        { error: "Aprendizaje no encontrado." },
        { status: 404, headers: noStoreHeaders() },
      );
    }

    if (mensaje.includes("EOS_APRENDIZAJE_TEXTO_REQUERIDO")) {
      return NextResponse.json(
        { error: "Escribí con tus palabras lo que EOS tendría que haber entendido." },
        { status: 400, headers: noStoreHeaders() },
      );
    }

    console.error("No se pudo gestionar el aprendizaje:", error);
    return NextResponse.json(
      { error: "No pudimos guardar el cambio." },
      { status: 500, headers: noStoreHeaders() },
    );
  }

  return NextResponse.json(data, { headers: noStoreHeaders() });
}

const ACCIONES = ["corregir", "descartar", "restaurar", "eliminar"];

function noStoreHeaders() {
  return { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" };
}
