import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { registrarAuditoria } from "@/lib/auditoria/registrar";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

function noStoreHeaders() {
  return { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" };
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  );
}

async function parseJson(response: Response) {
  return response.json().catch(() => null);
}

export async function PATCH(request: Request, context: RouteContext) {
  const { id } = await context.params;

  if (!isUuid(id)) {
    return NextResponse.json(
      { error: "Solicitud inválida." },
      { status: 400, headers: noStoreHeaders() },
    );
  }

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

  const body = await request.json().catch(() => null);
  const status = body?.status;

  if (status !== "approved" && status !== "rejected") {
    return NextResponse.json(
      { error: "Solo podés aprobar o rechazar una solicitud." },
      { status: 400, headers: noStoreHeaders() },
    );
  }

  const { data: current, error: currentError } = await supabase
    .from("eos_action_approvals_v12")
    .select(
      "id,usuario_id,request_id,accion,status,reason,risk_tier,risk_points,effective_level,payload_snapshot,expires_at,decided_at,command_id",
    )
    .eq("id", id)
    .eq("usuario_id", user.id)
    .maybeSingle();

  if (currentError) {
    console.error("No se pudo cargar aprobación EOS:", currentError);
    return NextResponse.json(
      { error: "No pudimos cargar la solicitud." },
      { status: 500, headers: noStoreHeaders() },
    );
  }

  if (!current) {
    return NextResponse.json(
      { error: "Solicitud no encontrada." },
      { status: 404, headers: noStoreHeaders() },
    );
  }

  if (new Date(current.expires_at).getTime() <= Date.now()) {
    return NextResponse.json(
      { error: "La solicitud ya venció." },
      { status: 409, headers: noStoreHeaders() },
    );
  }

  if (status === "rejected") {
    if (current.status !== "pending") {
      return NextResponse.json(
        { error: "La solicitud ya fue resuelta." },
        { status: 409, headers: noStoreHeaders() },
      );
    }

    const { data: rejected, error } = await supabase
      .from("eos_action_approvals_v12")
      .update({ status: "rejected" })
      .eq("id", id)
      .eq("usuario_id", user.id)
      .eq("status", "pending")
      .select("id,request_id,accion,status,decided_at")
      .single();

    if (error) {
      console.error("No se pudo rechazar aprobación EOS:", error);
      return NextResponse.json(
        { error: "No pudimos registrar el rechazo." },
        { status: 500, headers: noStoreHeaders() },
      );
    }

    await registrarAuditoria(createAdminClient() as never, {
      usuarioId: user.id,
      evento: "accion_rechazada",
      origen: "panel",
      resumen: `Rechazaste la acción ${current.accion} que EOS había propuesto.`,
      referencia: id,
      detalle: { accion: current.accion, riesgo: current.risk_tier },
    });

    return NextResponse.json(
      { ok: true, approval: rejected, executed: false },
      { headers: noStoreHeaders() },
    );
  }

  let approval = current;

  if (current.status === "pending") {
    const { data: approved, error } = await supabase
      .from("eos_action_approvals_v12")
      .update({ status: "approved" })
      .eq("id", id)
      .eq("usuario_id", user.id)
      .eq("status", "pending")
      .select(
        "id,usuario_id,request_id,accion,status,reason,risk_tier,risk_points,effective_level,payload_snapshot,expires_at,decided_at,command_id",
      )
      .single();

    if (error) {
      console.error("No se pudo aprobar acción EOS:", error);
      return NextResponse.json(
        { error: "No pudimos registrar la aprobación." },
        { status: 500, headers: noStoreHeaders() },
      );
    }

    approval = approved;

    // Se asienta el TAP, no el resultado. La regla no negociable de la hoja de
    // ruta es que ninguna acción se ejecute sin autorización explícita; lo que
    // hay que poder probar después es que esa autorización existió y cuándo.
    // Si la ejecución falla más abajo, la autorización igual ocurrió.
    await registrarAuditoria(createAdminClient() as never, {
      usuarioId: user.id,
      evento: "accion_autorizada",
      origen: "panel",
      resumen: `Autorizaste la acción ${approval.accion}.`,
      referencia: id,
      detalle: {
        accion: approval.accion,
        riesgo: approval.risk_tier,
        nivel: approval.effective_level,
        request_id: approval.request_id,
      },
    });
  } else if (current.status !== "approved") {
    return NextResponse.json(
      { error: "La solicitud ya fue resuelta." },
      { status: 409, headers: noStoreHeaders() },
    );
  }

  const secret = process.env.EOS_WORKER_GATE_SECRET;
  if (!secret) {
    return NextResponse.json(
      {
        error: "La aprobación quedó registrada, pero el ejecutor no está configurado.",
        code: "EOS_APPROVAL_EXECUTOR_UNAVAILABLE",
        approval,
      },
      { status: 503, headers: noStoreHeaders() },
    );
  }

  const base = (
    process.env.EOS_APP_BASE_URL ||
    "https://transtech-eos-git-release-eos-40-rc1-trans-tech.vercel.app"
  ).replace(/\/$/, "");

  const headers: Record<string, string> = {
    Authorization: `Bearer ${secret}`,
    "Content-Type": "application/json",
  };

  const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  if (bypass) headers["x-vercel-protection-bypass"] = bypass;

  const authorizeResponse = await fetch(`${base}/api/internal/worker-authorize/v1`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      usuario_id: user.id,
      request_id: approval.request_id,
      accion: approval.accion,
      payload: approval.payload_snapshot,
      conversacion_id: null,
      mensaje_id: null,
      origen: "eos-approval-ui",
    }),
    signal: AbortSignal.timeout(20_000),
    cache: "no-store",
  });

  const authorization = await parseJson(authorizeResponse);

  if (
    !authorizeResponse.ok ||
    authorization?.ok !== true ||
    authorization?.execute !== true ||
    !isUuid(authorization?.command_id)
  ) {
    console.error("Aprobación EOS no pudo revalidarse:", authorization);
    return NextResponse.json(
      {
        error: "La aprobación quedó registrada, pero no pudo revalidarse para ejecución.",
        code: "EOS_APPROVAL_REVALIDATION_FAILED",
        approval,
        authorization,
      },
      { status: 409, headers: noStoreHeaders() },
    );
  }

  const effectResponse = await fetch(`${base}/api/internal/action-effects/v1`, {
    method: "POST",
    headers,
    body: JSON.stringify({ command_id: authorization.command_id }),
    signal: AbortSignal.timeout(20_000),
    cache: "no-store",
  });

  const execution = await parseJson(effectResponse);

  if (!effectResponse.ok || execution?.ok !== true) {
    console.error("Aprobación EOS autorizada pero no ejecutada:", execution);
    return NextResponse.json(
      {
        error: "La acción fue autorizada, pero no pudo completarse.",
        code: "EOS_APPROVAL_EFFECT_FAILED",
        approval,
        authorization,
        execution,
      },
      { status: 409, headers: noStoreHeaders() },
    );
  }

  return NextResponse.json(
    {
      ok: true,
      approval,
      authorization,
      execution,
      executed: true,
    },
    { headers: noStoreHeaders() },
  );
}
