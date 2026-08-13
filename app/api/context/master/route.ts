import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const HEADERS = { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" };

export async function GET() {
  const auth = await authenticatedClient();
  if (auth.response) return auth.response;

  const { data, error } = await auth.supabase
    .from("eos_master_context_v8")
    .select("*")
    .eq("usuario_id", auth.userId)
    .maybeSingle();

  if (error) return databaseError("cargar", error);
  return NextResponse.json({ context: data }, { headers: HEADERS });
}

export async function POST(request: Request) {
  const startedAt = Date.now();
  const auth = await authenticatedClient();
  if (auth.response) return auth.response;

  const body = await request.json().catch(() => ({}));
  const requestId = validUuid(body?.request_id) ? body.request_id : crypto.randomUUID();
  const triggerSource = cleanText(body?.trigger_source, 80) || "eos-web";

  const [
    userResult,
    profileResult,
    goalsResult,
    projectsResult,
    followupsResult,
    actionsResult,
    decisionsResult,
    learningsResult,
  ] = await Promise.all([
    auth.supabase.from("usuarios").select("nombre, plan").eq("id", auth.userId).maybeSingle(),
    auth.supabase.from("eos_profiles").select("tipo_usuario, nombre_visible, rubro, etapa_actual, prioridad_actual, resumen_actual, score_general").eq("usuario_id", auth.userId).maybeSingle(),
    auth.supabase.from("eos_goals").select("id, titulo, progreso, estado, prioridad, valor_actual, valor_objetivo, unidad, proximo_paso, fecha_limite, ultima_actualizacion_at").eq("usuario_id", auth.userId).in("estado", ["activo", "pausado"]).order("prioridad").limit(8),
    auth.supabase.from("eos_projects").select("id, nombre, descripcion, estado, progreso, prioridad, updated_at").eq("usuario_id", auth.userId).neq("estado", "archivado").order("updated_at", { ascending: false }).limit(6),
    auth.supabase.from("eos_proactive_followups").select("id, tipo, severidad, titulo, mensaje, estado, programado_para, objetivo_id").eq("usuario_id", auth.userId).eq("estado", "pendiente").order("programado_para").limit(8),
    auth.supabase.from("eos_action_commands").select("id, accion, estado, payload, created_at, updated_at").eq("usuario_id", auth.userId).in("estado", ["recibida", "ejecutando"]).order("created_at", { ascending: false }).limit(8),
    auth.supabase.from("eos_decision_registry_v6").select("id, titulo, decision, razon, resultado_esperado, estado, fecha_decision, fecha_revision, result_count, latest_result_type, latest_result_summary, latest_learning").eq("usuario_id", auth.userId).order("fecha_decision", { ascending: false }).limit(6),
    auth.supabase.from("eos_learnings").select("id, categoria, patron, recomendacion, tendencia, confianza, evidence_count, last_observed_at").eq("usuario_id", auth.userId).eq("estado", "activo").order("confianza", { ascending: false }).limit(5),
  ]);

  const requiredErrors = [
    userResult.error,
    profileResult.error,
    goalsResult.error,
    projectsResult.error,
    followupsResult.error,
    actionsResult.error,
    decisionsResult.error,
    learningsResult.error,
  ].filter(Boolean);
  if (requiredErrors.length > 0) return databaseError("reconstruir", requiredErrors[0]);

  const user = userResult.data;
  const profile = profileResult.data;
  const goals = goalsResult.data ?? [];
  const projects = projectsResult.data ?? [];
  const followups = followupsResult.data ?? [];
  const actions = actionsResult.data ?? [];
  const decisions = decisionsResult.data ?? [];
  const learnings = learningsResult.data ?? [];

  const identidad = {
    nombre: profile?.nombre_visible || user?.nombre || null,
    tipo: profile?.tipo_usuario || null,
    sector: profile?.rubro || null,
    etapa: profile?.etapa_actual || null,
    plan: user?.plan || null,
  };
  const estadoActual = {
    resumen: profile?.resumen_actual || null,
    prioridad: profile?.prioridad_actual || null,
    score: profile?.score_general ?? null,
  };
  const objetivos = goals.map((goal) => ({
    id: goal.id,
    titulo: goal.titulo,
    progreso: goal.progreso,
    estado: goal.estado,
    prioridad: goal.prioridad,
    valor_actual: goal.valor_actual,
    valor_objetivo: goal.valor_objetivo,
    unidad: goal.unidad,
    proximo_paso: goal.proximo_paso,
    fecha_limite: goal.fecha_limite,
  }));
  const compromisos = [
    ...actions.map((action) => ({ tipo: "accion", id: action.id, titulo: action.accion, estado: action.estado, fecha: action.created_at })),
    ...goals.filter((goal) => goal.proximo_paso).map((goal) => ({ tipo: "proximo_paso", id: goal.id, titulo: goal.proximo_paso, estado: goal.estado, fecha: goal.fecha_limite })),
  ].slice(0, 8);
  const alertas = followups.map((followup) => ({
    id: followup.id,
    tipo: followup.tipo,
    severidad: followup.severidad,
    titulo: followup.titulo,
    mensaje: followup.mensaje,
    programado_para: followup.programado_para,
    objetivo_id: followup.objetivo_id,
  }));
  const decisionesRecientes = decisions.map((decision) => ({
    id: decision.id,
    titulo: decision.titulo,
    decision: decision.decision,
    razon: decision.razon,
    resultado_esperado: decision.resultado_esperado,
    estado: decision.estado,
    fecha: decision.fecha_decision,
    fecha_revision: decision.fecha_revision,
    resultados: decision.result_count,
    ultimo_resultado: decision.latest_result_summary,
    aprendizaje: decision.latest_learning,
  }));
  const aprendizajes = learnings.map((learning) => ({
    id: learning.id,
    categoria: learning.categoria,
    patron: learning.patron,
    recomendacion: learning.recomendacion,
    tendencia: learning.tendencia,
    confianza: learning.confianza,
    evidencias: learning.evidence_count,
  }));
  const nextAction = chooseNextAction(alertas, objetivos, compromisos, aprendizajes);
  const canonical = { identidad, estadoActual, objetivos, projects, compromisos, alertas, decisionesRecientes, aprendizajes, nextAction };
  const fingerprint = await sha256(stableStringify(canonical));
  const summary = compactSummary(identidad, estadoActual, objetivos, alertas, decisionesRecientes, nextAction);

  const { data: commit, error: saveError } = await auth.supabase.rpc(
    "eos_commit_master_context_v31",
    {
      p_request_id: requestId,
      p_trigger_source: triggerSource,
      p_identidad: identidad,
      p_estado_actual: estadoActual,
      p_objetivos: objetivos,
      p_proyectos: projects,
      p_compromisos: compromisos,
      p_alertas: alertas,
      p_decisiones_recientes: decisionesRecientes,
      p_aprendizajes: aprendizajes,
      p_proxima_mejor_accion: nextAction,
      p_resumen_compacto: summary,
      p_source_fingerprint: fingerprint,
      p_fuentes: {
        goals: goals.length,
        projects: projects.length,
        followups: followups.length,
        actions: actions.length,
        decisions: decisions.length,
        learnings: learnings.length,
      },
      p_section_counts: {
        objetivos: objetivos.length,
        proyectos: projects.length,
        compromisos: compromisos.length,
        alertas: alertas.length,
        decisiones: decisionesRecientes.length,
        aprendizajes: aprendizajes.length,
      },
      p_duration_ms: Date.now() - startedAt,
    },
  );

  if (saveError || !commit || typeof commit !== "object") {
    return databaseError("guardar", saveError || "EOS_CONTEXT_COMMIT_EMPTY");
  }

  const committed = commit as {
    context?: unknown;
    changed?: boolean;
    idempotent?: boolean;
  };

  return NextResponse.json(
    {
      context: committed.context ?? null,
      changed: Boolean(committed.changed),
      idempotent: Boolean(committed.idempotent),
    },
    { headers: HEADERS },
  );
}

type RankedItem = { titulo?: string | null; severidad?: string | null; prioridad?: number | null; progreso?: number | null; recomendacion?: string | null; tipo?: string | null; id?: string };

function chooseNextAction(alerts: RankedItem[], goals: RankedItem[], commitments: RankedItem[], learnings: RankedItem[]) {
  const alert = [...alerts].sort((a, b) => severity(b.severidad) - severity(a.severidad))[0];
  if (alert) return { tipo: "resolver_alerta", titulo: alert.titulo, referencia_id: alert.id, razon: `Alerta ${alert.severidad || "activa"}` };
  const goal = [...goals].sort((a, b) => (a.prioridad ?? 9) - (b.prioridad ?? 9) || (a.progreso ?? 0) - (b.progreso ?? 0))[0];
  if (goal) return { tipo: "avanzar_objetivo", titulo: goal.titulo, referencia_id: goal.id, razon: `Objetivo prioritario al ${goal.progreso ?? 0}%` };
  const commitment = commitments[0];
  if (commitment) return { tipo: "cumplir_compromiso", titulo: commitment.titulo, referencia_id: commitment.id, razon: "Compromiso pendiente" };
  const learning = learnings[0];
  if (learning) return { tipo: "aplicar_aprendizaje", titulo: learning.recomendacion, referencia_id: learning.id, razon: "Patrón respaldado por evidencia" };
  return { tipo: "completar_contexto", titulo: "Definir el objetivo y la prioridad actuales", razon: "Todavía no hay señales operativas suficientes" };
}

function severity(value?: string | null) {
  return ({ critica: 4, alta: 3, media: 2, baja: 1 } as Record<string, number>)[value || ""] ?? 0;
}

function compactSummary(identity: Record<string, unknown>, current: Record<string, unknown>, goals: RankedItem[], alerts: RankedItem[], decisions: RankedItem[], next: Record<string, unknown>) {
  return [
    `IDENTIDAD: ${String(identity.nombre || "Sin nombre")}; sector ${String(identity.sector || "sin definir")}; etapa ${String(identity.etapa || "sin definir")}.`,
    `ESTADO ACTUAL: ${String(current.resumen || "Sin resumen")}; prioridad ${String(current.prioridad || "sin definir")}; score ${String(current.score ?? "sin medir")}.`,
    `OBJETIVOS: ${goals.slice(0, 5).map((item) => `${item.titulo} (${item.progreso ?? 0}%)`).join("; ") || "ninguno activo"}.`,
    `ALERTAS: ${alerts.slice(0, 4).map((item) => item.titulo).join("; ") || "ninguna activa"}.`,
    `DECISIONES RECIENTES: ${decisions.slice(0, 3).map((item) => item.titulo).join("; ") || "ninguna registrada"}.`,
    `PRÓXIMA MEJOR ACCIÓN: ${next.titulo || "sin definir"}.`,
  ].join("\n").slice(0, 6000);
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

async function sha256(value: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function authenticatedClient() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) {
    return { supabase, userId: "", response: NextResponse.json({ error: "Sesión no válida." }, { status: 401, headers: HEADERS }) };
  }
  return { supabase, userId: user.id, response: null };
}

function cleanText(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function validUuid(value: unknown) {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function databaseError(action: string, error: unknown) {
  console.error(`No se pudo ${action} el Contexto Maestro:`, error);
  return NextResponse.json({ error: `No pudimos ${action} el Contexto Maestro.` }, { status: 500, headers: HEADERS });
}
