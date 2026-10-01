import { NextResponse } from "next/server";
import { paraRegistro } from "@/lib/seguridad/registro";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { registrarAuditoria } from "@/lib/auditoria/registrar";
import { esUuid, resolverAprobacion } from "@/lib/autonomia/resolver-aprobacion";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

function noStoreHeaders() {
  return { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" };
}

/*
 * La lógica vive en `lib/autonomia/resolver-aprobacion.ts` desde el
 * 01/10/2026, compartida con la aprobación por WhatsApp. Esta ruta solo
 * traduce cada resultado a la respuesta HTTP de siempre.
 */
export async function PATCH(request: Request, context: RouteContext) {
  const { id } = await context.params;

  if (!esUuid(id)) {
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

  const r = await resolverAprobacion(
    { usuarioId: user.id, id, decision: status, origen: "panel" },
    {
      // La sesión de la persona: RLS además del filtro por usuario.
      cliente: supabase,
      auditar: (entrada) => registrarAuditoria(createAdminClient() as never, entrada),
    },
  );

  const responder = (cuerpo: Record<string, unknown>, estado = 200) =>
    NextResponse.json(cuerpo, { status: estado, headers: noStoreHeaders() });

  switch (r.tipo) {
    case "error_lectura":
      console.error("No se pudo cargar aprobación EOS.");
      return responder({ error: "No pudimos cargar la solicitud." }, 500);
    case "no_encontrada":
      return responder({ error: "Solicitud no encontrada." }, 404);
    case "vencida":
      return responder({ error: "La solicitud ya venció." }, 409);
    case "ya_resuelta":
      return responder({ error: "La solicitud ya fue resuelta." }, 409);
    case "error_decision":
      console.error("No se pudo registrar la decisión sobre la aprobación EOS:", r.decision);
      return responder(
        { error: r.decision === "rejected" ? "No pudimos registrar el rechazo." : "No pudimos registrar la aprobación." },
        500,
      );
    case "rechazada":
      return responder({ ok: true, approval: r.approval, executed: false });
    case "sin_ejecutor":
      return responder(
        {
          error: "La aprobación quedó registrada, pero el ejecutor no está configurado.",
          code: "EOS_APPROVAL_EXECUTOR_UNAVAILABLE",
          approval: r.approval,
        },
        503,
      );
    case "no_revalidada":
      console.error("Aprobación EOS no pudo revalidarse:", paraRegistro(r.authorization));
      return responder(
        {
          error: "La aprobación quedó registrada, pero no pudo revalidarse para ejecución.",
          code: "EOS_APPROVAL_REVALIDATION_FAILED",
          approval: r.approval,
          authorization: r.authorization,
        },
        409,
      );
    case "no_ejecutada":
      console.error("Aprobación EOS autorizada pero no ejecutada:", paraRegistro(r.execution));
      return responder(
        {
          error: "La acción fue autorizada, pero no pudo completarse.",
          code: "EOS_APPROVAL_EFFECT_FAILED",
          approval: r.approval,
          authorization: r.authorization,
          execution: r.execution,
        },
        409,
      );
    case "ejecutada":
      return responder({
        ok: true,
        approval: r.approval,
        authorization: r.authorization,
        execution: r.execution,
        executed: true,
      });
  }
}
