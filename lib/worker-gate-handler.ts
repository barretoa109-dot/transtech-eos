import { createHash } from "crypto";
import { NextResponse } from "next/server";

import { adminSinTipos, type ClienteSinTipos } from "./supabase/sin-tipos.ts";
import { autorizadoComoWorker } from "./seguridad/worker-bearer.ts";
import { SYSTEM_RISK } from "./autonomia/riesgo.ts";

// Reexportado para que quien ya lo importaba de acá siga funcionando.
export { ACCIONES_CON_RIESGO } from "./autonomia/riesgo.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const POLICY_VERSION = "eos-worker-gate-v2";



/*
 * El perfil de quien todavía no tiene fila propia.
 *
 * Tiene que decir lo mismo que el default de la columna en la base
 * (v101, y ahora v127). Cuando dijeron cosas distintas, cinco de los seis
 * usuarios de producción corrieron catorce días en nivel 1 —que ni ejecuta
 * ni pregunta— mientras el chat les decía que sí. Si cambia uno, cambia el
 * otro.
 *
 * Los dos techos diarios subieron el 6 de septiembre de 2026. Estaban en 5
 * acciones y 10 puntos desde la v12, cuando lo más caro que se podía pedir
 * era crear un objetivo. Una venta vale 6 puntos: con presupuesto 10, la
 * PRIMERA venta del día pasaba y la segunda daba `block` —ni siquiera
 * `approval`, así que no quedaba nada que aprobar—. Desde el chat eso se ve
 * como que EOS no registra nada en el ERP, y así se reportó.
 *
 * Los números salen de un día cargado de uso conversacional —unas quince
 * ventas, tres contactos, dos ajustes de stock: 111 puntos en 20 acciones— y
 * se duplican. El techo sigue existiendo para frenar a un modelo trabado en
 * un bucle, que es para lo que sirve; dejó de frenar a alguien trabajando.
 *
 * ------------------------------------------------------------
 * EL NIVEL POR DEFECTO PASA DE 2 A 3, Y ESA ES LA DECISIÓN GRANDE
 * ------------------------------------------------------------
 *
 * En la escalera de abajo, el nivel 2 significa `approval`: la acción no se
 * ejecuta y queda esperando que la persona vaya a `/eos/autonomy` a aprobarla.
 * Como era el default, TODA acción que no fuera una de las tres del negocio
 * —guardar una memoria, crear una tarea, armar un Excel— terminaba ahí.
 *
 * En la práctica eso significa que no pasa nada. Nadie interrumpe una
 * conversación para ir a otra pantalla a autorizar que se guarde una nota, y
 * el resultado es un chat que promete y no cumple. Se reportó dos veces desde
 * el uso real, con estas palabras: "EOS no recuerda las cosas" y "cuando se le
 * pide por el chat que anote algo en el ERP y CRM no lo hace".
 *
 * El nivel 3 ejecuta, y lo que protege deja de ser una pregunta por acción
 * para ser el techo diario de acá arriba: 40 acciones y 240 puntos. Eso frena
 * a un modelo trabado en un bucle, que es el riesgo real, sin frenar a alguien
 * trabajando.
 *
 * Queda escrito qué se pierde: si el modelo entiende mal algo, ahora lo hace
 * en vez de preguntar. Es exactamente lo que el usuario pidió para las tres
 * acciones del negocio el 3 de septiembre —las más caras de equivocar— y no
 * tiene sentido ser más estricto con guardar una nota que con registrar una
 * venta.
 */
const DEFAULT_PROFILE = {
  default_level: 3,
  max_auto_actions_per_day: 40,
  max_daily_risk_points: 240,
  approval_ttl_minutes: 60,
  enabled: true,
};

function noStoreHeaders() {
  return {
    "Cache-Control": "private, no-store, max-age=0",
    Vary: "Authorization",
  };
}

function safeObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;

  return Object.keys(value as Record<string, unknown>)
    .sort()
    .reduce<Record<string, unknown>>((acc, key) => {
      acc[key] = stable((value as Record<string, unknown>)[key]);
      return acc;
    }, {});
}

function fingerprint(value: Record<string, unknown>) {
  return createHash("sha256")
    .update(JSON.stringify(stable(value)))
    .digest("hex");
}

const AUTONOMY_TIME_ZONE = "America/Asuncion";

function dateInTimeZone(value: string, timeZone = AUTONOMY_TIME_ZONE) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(value));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function recentAutonomyWindowStart() {
  return new Date(Date.now() - 30 * 60 * 60 * 1000).toISOString();
}
async function logEvent(
  admin: ClienteSinTipos,
  params: {
    usuarioId: string;
    approvalId?: string | null;
    commandId?: string | null;
    eventType:
      | "evaluated"
      | "approval_requested"
      | "auto_allowed"
      | "auto_blocked";
    detail: Record<string, unknown>;
  },
) {
  const { error } = await admin.from("eos_autonomy_events_v12").insert({
    usuario_id: params.usuarioId,
    approval_id: params.approvalId || null,
    command_id: params.commandId || null,
    event_type: params.eventType,
    actor: "service",
    detail: {
      ...params.detail,
      policy_version: POLICY_VERSION,
    },
  });

  if (error) {
    console.error("Worker gate: no se pudo registrar evento:", error);
    return false;
  }

  return true;
}

function blockResponse(reason: string, status = 409) {
  return NextResponse.json(
    {
      ok: false,
      execute: false,
      decision: "block",
      reason,
      policy_version: POLICY_VERSION,
    },
    { status, headers: noStoreHeaders() },
  );
}

export async function POST(request: Request) {
  try {
    const authorization = autorizadoComoWorker(request);

    if (authorization.unavailable) {
      return NextResponse.json(
        {
          ok: false,
          execute: false,
          decision: "block",
          error: "Worker gate no configurado.",
        },
        { status: 503, headers: noStoreHeaders() },
      );
    }

    if (!authorization.ok) {
      return NextResponse.json(
        {
          ok: false,
          execute: false,
          decision: "block",
          error: "No autorizado.",
        },
        { status: 401, headers: noStoreHeaders() },
      );
    }

    const body = await request.json().catch(() => null);
    const usuarioId = body?.usuario_id;
    const requestId = body?.request_id;
    const action = typeof body?.accion === "string" ? body.accion.trim() : "";
    const commandId = body?.command_id ?? null;
    const approvalId = body?.approval_id ?? null;
    const consumeApproval = body?.consume_approval === true;
    const payload = safeObject(body?.payload);
    const systemRisk = SYSTEM_RISK[action];

    if (!isUuid(usuarioId) || !isUuid(requestId) || !systemRisk) {
      /*
       * Un rechazo en la puerta también se audita.
       *
       * Antes se devolvía el 400 y se acababa: no quedaba fila en ningún
       * lado. Eso costó dos semanas. El worker de n8n le estaba pegando a un
       * despliegue viejo que no conocía REGISTRAR_VENTA, cada intento moría
       * acá, y la auditoría del gate seguía mostrando como último movimiento
       * uno de catorce días antes. Desde afuera era indistinguible de que
       * nadie estuviera usando el chat.
       *
       * Se audita sólo cuando el usuario es identificable, que es lo único
       * que hace falta para que alguien pueda mirar. Si ni eso se puede, no
       * hay a quién atribuirle la fila y queda el log del servidor.
       *
       * El motivo va separado por campo y no en una frase armada: "la acción
       * no existe en esta versión del gate" y "el request_id no es un UUID"
       * llevan a lugares distintos, y con un solo mensaje genérico hay que
       * adivinar cuál de los dos fue.
       */
      const motivo = !isUuid(usuarioId)
        ? "usuario_id no es un UUID"
        : !isUuid(requestId)
          ? "request_id no es un UUID"
          : "la acción no existe en esta versión del gate";

      if (isUuid(usuarioId)) {
        await logEvent(adminSinTipos(), {
          usuarioId,
          eventType: "auto_blocked",
          detail: {
            accion: action || null,
            request_id: isUuid(requestId) ? requestId : null,
            decision: "block",
            reason: motivo,
            rechazado_en: "entrada",
            policy_version: POLICY_VERSION,
          },
        }).catch((error: unknown) => {
          // Auditar no puede impedir contestar: el rechazo es el mismo con
          // fila o sin ella.
          console.error("Worker gate: no se pudo auditar el rechazo:", error);
        });
      }

      console.error("Worker gate: solicitud rechazada en la entrada.", {
        motivo,
        accion: action || "(vacía)",
      });

      return NextResponse.json(
        {
          ok: false,
          execute: false,
          decision: "block",
          error: "Solicitud de gate inválida.",
          // Al worker se le dice cuál de las tres cosas fue. No es
          // información sensible y es lo único que separa "arreglalo en un
          // día" de "buscalo dos semanas".
          motivo,
        },
        { status: 400, headers: noStoreHeaders() },
      );
    }

    if (commandId !== null && !isUuid(commandId)) {
      return NextResponse.json(
        {
          ok: false,
          execute: false,
          decision: "block",
          error: "command_id inválido.",
        },
        { status: 400, headers: noStoreHeaders() },
      );
    }

    if (approvalId !== null && !isUuid(approvalId)) {
      return NextResponse.json(
        {
          ok: false,
          execute: false,
          decision: "block",
          error: "approval_id inválido.",
        },
        { status: 400, headers: noStoreHeaders() },
      );
    }

    if (consumeApproval && (!approvalId || !commandId)) {
      return NextResponse.json(
        {
          ok: false,
          execute: false,
          decision: "block",
          error:
            "Para consumir una aprobación se requieren approval_id y command_id.",
        },
        { status: 400, headers: noStoreHeaders() },
      );
    }

    const admin = adminSinTipos();

    const { data: userExists, error: userError } = await admin
      .from("usuarios")
      .select("id")
      .eq("id", usuarioId)
      .maybeSingle();

    if (userError || !userExists) {
      return NextResponse.json(
        {
          ok: false,
          execute: false,
          decision: "block",
          error: "Usuario no válido para ejecución.",
        },
        { status: 404, headers: noStoreHeaders() },
      );
    }

    let command: {
      id: string;
      usuario_id: string;
      request_id: string;
      accion: string;
      estado: string;
    } | null = null;

    if (commandId) {
      const { data: commandData, error: commandError } = await admin
        .from("eos_action_commands")
        .select("id,usuario_id,request_id,accion,estado")
        .eq("id", commandId)
        .maybeSingle();

      if (commandError || !commandData) {
        return blockResponse("command_id no corresponde a una orden existente.", 404);
      }

      if (
        commandData.usuario_id !== usuarioId ||
        commandData.request_id !== requestId ||
        commandData.accion !== action
      ) {
        return blockResponse(
          "La orden no coincide exactamente con usuario, request_id y acción evaluados.",
        );
      }

      if (!["recibida", "ejecutando"].includes(commandData.estado)) {
        return blockResponse(
          `La orden está en estado no ejecutable: ${commandData.estado}.`,
        );
      }

      command = commandData;
    }

    const [
      profileResult,
      ruleResult,
      approvalResult,
      priorEventResult,
      dailyEventsResult,
      masterContextResult,
    ] = await Promise.all([
      admin
        .from("eos_autonomy_profiles_v12")
        .select(
          "default_level,max_auto_actions_per_day,max_daily_risk_points,approval_ttl_minutes,enabled",
        )
        .eq("usuario_id", usuarioId)
        .maybeSingle(),
      admin
        .from("eos_autonomy_rules_v12")
        .select(
          "autonomy_level,risk_tier,risk_points,max_auto_per_day,enabled,require_fresh_context",
        )
        .eq("usuario_id", usuarioId)
        .eq("accion", action)
        .maybeSingle(),
      admin
        .from("eos_action_approvals_v12")
        .select(
          "id,request_id,accion,status,risk_tier,risk_points,requested_level,effective_level,reason,expires_at,decided_at,created_at",
        )
        .eq("usuario_id", usuarioId)
        .eq("request_id", requestId)
        .eq("accion", action)
        .maybeSingle(),
      admin
        .from("eos_autonomy_events_v12")
        .select("id,command_id,event_type,detail,created_at")
        .eq("usuario_id", usuarioId)
        .contains("detail", { request_id: requestId, accion: action })
        .order("created_at", { ascending: false })
        .limit(1),
      admin
        .from("eos_autonomy_events_v12")
        .select("event_type,detail,created_at")
        .eq("usuario_id", usuarioId)
        .eq("event_type", "auto_allowed")
        .gte("created_at", recentAutonomyWindowStart()),
      admin
        .from("eos_master_context_v8")
        .select("id,version,necesita_actualizacion,vigente_hasta,updated_at")
        .eq("usuario_id", usuarioId)
        .order("version", { ascending: false })
        .order("updated_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    const readError =
      profileResult.error ||
      ruleResult.error ||
      approvalResult.error ||
      priorEventResult.error ||
      dailyEventsResult.error ||
      masterContextResult.error;

    if (readError) {
      console.error("Worker gate: error leyendo autonomía:", readError);
      return blockResponse(
        "No fue posible verificar la política de autonomía.",
        500,
      );
    }

    const profile = { ...DEFAULT_PROFILE, ...(profileResult.data || {}) };

    /*
     * Y si no tenía fila, se la crea con lo que se acaba de usar.
     *
     * No es cosmético: mientras el nivel es un valor implícito nadie puede
     * verlo ni cambiarlo, y una diferencia entre este archivo y la base pasa
     * inadvertida hasta que un usuario reporta que EOS le miente. Con la fila
     * escrita, el nivel es un dato: se lee, se audita y se edita.
     *
     * Si el insert falla no se corta la evaluación —el usuario no tiene la
     * culpa de que no se haya podido escribir una preferencia— y la carrera
     * entre dos evaluaciones simultáneas la resuelve el propio unique.
     */
    if (!profileResult.data) {
      const { error: altaError } = await admin
        .from("eos_autonomy_profiles_v12")
        .upsert(
          { usuario_id: usuarioId, ...DEFAULT_PROFILE },
          // `ignoreDuplicates` lo vuelve un `on conflict do nothing`: si entre
          // la lectura y esta escritura otra evaluación ya creó la fila —o el
          // usuario ya había elegido su nivel—, no se pisa nada.
          { onConflict: "usuario_id", ignoreDuplicates: true },
        );

      if (altaError) {
        console.error("Worker gate: no se pudo crear el perfil de autonomía:", altaError);
      }
    }
    const rule = ruleResult.data;
    const masterContext = masterContextResult.data;
    const requiresFreshContext = rule?.require_fresh_context === true;
    const contextExpiry = masterContext?.vigente_hasta
      ? new Date(masterContext.vigente_hasta).getTime()
      : Number.NaN;
    const contextFresh = Boolean(
      masterContext &&
        masterContext.necesita_actualizacion === false &&
        Number.isFinite(contextExpiry) &&
        contextExpiry > Date.now(),
    );

    if (requiresFreshContext && !contextFresh) {
      const reason =
        "El Contexto Maestro debe actualizarse antes de ejecutar esta acción.";

      await logEvent(admin, {
        usuarioId,
        commandId,
        eventType: "auto_blocked",
        detail: {
          request_id: requestId,
          accion: action,
          decision: "block",
          reason,
          code: "EOS_ACTION_CONTEXT_STALE",
          require_fresh_context: true,
          context_id: masterContext?.id ?? null,
          context_version: masterContext?.version ?? null,
          context_vigente_hasta: masterContext?.vigente_hasta ?? null,
          context_necesita_actualizacion:
            masterContext?.necesita_actualizacion ?? null,
        },
      });

      return NextResponse.json(
        {
          ok: true,
          execute: false,
          decision: "block",
          code: "EOS_ACTION_CONTEXT_STALE",
          reason,
          context: {
            required: true,
            fresh: false,
            version: masterContext?.version ?? null,
            vigente_hasta: masterContext?.vigente_hasta ?? null,
          },
          policy_version: POLICY_VERSION,
        },
        { headers: noStoreHeaders() },
      );
    }

    if (consumeApproval && approvalId && commandId) {
      const { data, error } = await admin.rpc(
        "eos_consume_action_approval_v12",
        {
          p_approval_id: approvalId,
          p_command_id: commandId,
        },
      );

      if (error) {
        console.error("Worker gate: consumo de aprobación rechazado:", error);
        return blockResponse(
          "La aprobación no pudo consumirse de forma segura.",
        );
      }

      return NextResponse.json(
        {
          ok: true,
          execute: true,
          decision: "allow",
          reason: "Aprobación explícita consumida de forma atómica.",
          consumed: true,
          command_id: command?.id || commandId,
          approval: Array.isArray(data) ? data[0] || null : data,
          policy_version: POLICY_VERSION,
        },
        { headers: noStoreHeaders() },
      );
    }

    /*
     * Una regla apagada no existe; no es una regla que diga "nunca".
     *
     * Antes, `enabled: false` bajaba el nivel a 0, que en la escalera de abajo
     * significa `recommend`: la acción no se ejecuta y el usuario recibe "la
     * política permite únicamente recomendar esta acción", una frase con la
     * que no puede hacer nada.
     *
     * Eso costó caro y se encontró usando el producto. La cuenta del plan
     * Business tenía tres reglas apagadas —GUARDAR_MEMORIA entre ellas— y por
     * eso EOS no guardó una sola memoria desde el 18 de agosto. Cuando el
     * usuario preguntó "¿en serio no recordás nada de mi negocio?", la
     * respuesta era correcta: no había nada guardado, porque cada intento
     * terminaba en `recommend`.
     *
     * Y nadie lo eligió: **ninguna ruta ni pantalla del producto escribe en
     * `eos_autonomy_rules_v12`.** Esas filas son restos de pruebas, y no hay
     * forma de apagarlas desde la aplicación. Un interruptor que solo se puede
     * prender desde afuera no puede ser el que decide si EOS recuerda.
     *
     * Ahora una regla apagada se ignora ENTERA —nivel, tope diario y riesgo—
     * y manda el perfil. Si algún día hace falta "nunca hagas esta acción",
     * eso es un `block` con su propio motivo, no un booleano que produce el
     * fallo más silencioso posible.
     */
    const reglaVigente = rule?.enabled === false ? null : rule;

    const configuredLevel = Number(
      reglaVigente?.autonomy_level ??
        systemRisk.defaultLevelOverride ??
        profile.default_level,
    );
    const effectiveLevel = Math.min(configuredLevel, systemRisk.maxLevel);
    const riskTier = Math.max(systemRisk.tier, Number(reglaVigente?.risk_tier ?? 0));
    const riskPoints = Math.max(systemRisk.points, Number(reglaVigente?.risk_points ?? 0));
    const autonomyDay = dateInTimeZone(new Date().toISOString());
    const autoEvents = (
      (dailyEventsResult.data || []) as { created_at: string; detail: unknown }[]
    ).filter((event) => dateInTimeZone(event.created_at) === autonomyDay);
    const autoCount = autoEvents.length;
    const usedRisk = autoEvents.reduce((total: number, event) => {
      const detail = safeObject(event.detail);
      const points = Number(detail.risk_points || 0);
      return total + (Number.isFinite(points) ? points : 0);
    }, 0);
    const actionLimit =
      reglaVigente?.max_auto_per_day === null || reglaVigente?.max_auto_per_day === undefined
        ? Number(profile.max_auto_actions_per_day)
        : Math.min(
            Number(profile.max_auto_actions_per_day),
            Number(reglaVigente.max_auto_per_day),
          );

    const existingApproval = approvalResult.data;

    if (existingApproval) {
      const expired = new Date(existingApproval.expires_at).getTime() <= Date.now();

      if (existingApproval.status === "approved" && !expired) {
        return NextResponse.json(
          {
            ok: true,
            execute: false,
            decision: "approval_ready",
            reason:
              "La aprobación está lista. Creá/asegurá el command_id y volvé a llamar con consume_approval=true justo antes del efecto secundario.",
            approval: existingApproval,
            policy_version: POLICY_VERSION,
          },
          { headers: noStoreHeaders() },
        );
      }

      if (existingApproval.status === "pending" && !expired) {
        return NextResponse.json(
          {
            ok: true,
            execute: false,
            decision: "approval",
            reason: existingApproval.reason || "Requiere aprobación explícita.",
            approval: existingApproval,
            policy_version: POLICY_VERSION,
          },
          { headers: noStoreHeaders() },
        );
      }

      return NextResponse.json(
        {
          ok: true,
          execute: false,
          decision: "block",
          reason: expired
            ? "La aprobación asociada ya venció."
            : `La aprobación está en estado ${existingApproval.status}.`,
          approval: existingApproval,
          policy_version: POLICY_VERSION,
        },
        { headers: noStoreHeaders() },
      );
    }

    const priorEvent = priorEventResult.data?.[0];
    const priorDetail = safeObject(priorEvent?.detail);

    if (
      priorEvent?.event_type === "auto_allowed" &&
      priorDetail.request_id === requestId &&
      priorDetail.accion === action
    ) {
      if (!commandId || priorEvent.command_id !== commandId) {
        return NextResponse.json(
          {
            ok: true,
            execute: false,
            decision: "allow",
            reason:
              "La política ya autorizó esta intención, pero falta presentar el command_id exacto para ejecutar.",
            requires_command: true,
            policy_version: POLICY_VERSION,
          },
          { headers: noStoreHeaders() },
        );
      }

      return NextResponse.json(
        {
          ok: true,
          execute: true,
          decision: "allow",
          reason: "Autorización automática idempotente vinculada al mismo comando.",
          idempotent: true,
          command_id: commandId,
          policy_version: POLICY_VERSION,
        },
        { headers: noStoreHeaders() },
      );
    }

    let decision: "recommend" | "prepare" | "approval" | "allow" | "block";
    let reason = "";

    if (!profile.enabled) {
      decision = "recommend";
      reason = "La autonomía está desactivada para este usuario.";
    } else if (effectiveLevel <= 0) {
      decision = "recommend";
      reason = "La política permite únicamente recomendar esta acción.";
    } else if (effectiveLevel === 1) {
      decision = "prepare";
      reason = "EOS puede preparar la acción, pero no ejecutar el efecto secundario.";
    } else if (
      effectiveLevel === 2 ||
      (riskTier >= 2 && systemRisk.forceApproval !== false)
    ) {
      decision = "approval";
      reason =
        riskTier >= 2 && systemRisk.forceApproval !== false
          ? "El riesgo mínimo de sistema exige aprobación explícita."
          : "La configuración del usuario exige aprobación explícita.";
    } else if (autoCount >= actionLimit) {
      decision = "block";
      reason = "Se alcanzó el límite diario de acciones automáticas.";
    } else if (usedRisk + riskPoints > Number(profile.max_daily_risk_points)) {
      decision = "block";
      reason = "La acción superaría el presupuesto diario de riesgo automático.";
    } else {
      decision = "allow";
      reason = "La acción está dentro del nivel, riesgo y límites permitidos.";
    }

    if (decision === "approval") {
      if (commandId) {
        return blockResponse(
          "No crees una orden ejecutable antes de obtener la aprobación. Evaluá sin command_id y crealo después de approval_ready.",
        );
      }

      const expiresAt = new Date(
        Date.now() + Number(profile.approval_ttl_minutes) * 60_000,
      ).toISOString();

      const { data: approval, error: approvalError } = await admin
        .from("eos_action_approvals_v12")
        .insert({
          usuario_id: usuarioId,
          request_id: requestId,
          accion: action,
          risk_tier: riskTier,
          risk_points: riskPoints,
          requested_level: configuredLevel,
          effective_level: effectiveLevel,
          status: "pending",
          reason,
          payload_snapshot: payload,
          payload_fingerprint: fingerprint(payload),
          expires_at: expiresAt,
        })
        .select(
          "id,request_id,accion,status,risk_tier,risk_points,expires_at,created_at",
        )
        .single();

      if (approvalError) {
        console.error("Worker gate: no se pudo crear aprobación:", approvalError);
        return blockResponse(
          "No se pudo crear la solicitud de aprobación de forma segura.",
          500,
        );
      }

      await logEvent(admin, {
        usuarioId,
        approvalId: approval.id,
        eventType: "approval_requested",
        detail: {
          request_id: requestId,
          accion: action,
          decision,
          reason,
          configured_level: configuredLevel,
          effective_level: effectiveLevel,
          risk_tier: riskTier,
          risk_points: riskPoints,
        },
      });

      return NextResponse.json(
        {
          ok: true,
          execute: false,
          decision: "approval",
          reason,
          approval,
          policy_version: POLICY_VERSION,
        },
        { headers: noStoreHeaders() },
      );
    }

    if (decision === "allow" && !commandId) {
      return NextResponse.json(
        {
          ok: true,
          execute: false,
          decision: "allow",
          reason:
            "La política permite autoejecución. Creá/asegurá eos_action_commands y volvé a llamar con su command_id antes del efecto secundario.",
          requires_command: true,
          effective_level: effectiveLevel,
          effective_risk: { tier: riskTier, points: riskPoints },
          policy_version: POLICY_VERSION,
        },
        { headers: noStoreHeaders() },
      );
    }

    const eventType =
      decision === "allow"
        ? "auto_allowed"
        : decision === "block"
          ? "auto_blocked"
          : "evaluated";

    const eventLogged = await logEvent(admin, {
      usuarioId,
      commandId,
      eventType,
      detail: {
        request_id: requestId,
        accion: action,
        decision,
        reason,
        configured_level: configuredLevel,
        effective_level: effectiveLevel,
        risk_tier: riskTier,
        risk_points: riskPoints,
        daily_auto_count: autoCount,
        daily_auto_limit: actionLimit,
        daily_risk_used: usedRisk,
        daily_risk_limit: Number(profile.max_daily_risk_points),
        command_binding_verified: decision === "allow" ? Boolean(command) : false,
      },
    });

    if (decision === "allow" && !eventLogged) {
      return blockResponse(
        "No se pudo persistir la autorización automática; ejecución bloqueada por seguridad.",
        500,
      );
    }

    return NextResponse.json(
      {
        ok: true,
        execute: decision === "allow" && eventLogged,
        decision,
        reason,
        command_id: decision === "allow" ? commandId : null,
        effective_level: effectiveLevel,
        effective_risk: { tier: riskTier, points: riskPoints },
        daily_limits: {
          auto_count: autoCount,
          auto_limit: actionLimit,
          risk_used: usedRisk,
          risk_limit: Number(profile.max_daily_risk_points),
        },
        policy_version: POLICY_VERSION,
      },
      { headers: noStoreHeaders() },
    );
  } catch (error) {
    console.error("Error en Worker gate:", error);

    return NextResponse.json(
      {
        ok: false,
        execute: false,
        decision: "block",
        error: "El gate interno falló y bloqueó la ejecución por seguridad.",
      },
      { status: 500, headers: noStoreHeaders() },
    );
  }
}
