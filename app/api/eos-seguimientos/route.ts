import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const ALLOWED_STATES = new Set(["visto", "resuelto", "descartado"]);

export async function GET() {
  const auth = await authenticatedClient();
  if (auth.error) return auth.error;

  const { data, error } = await auth.supabase
    .from("eos_proactive_followups")
    .select("id,objetivo_id,tipo,severidad,titulo,mensaje,estado,programado_para,generado_at,metadata")
    .eq("usuario_id", auth.userId)
    .in("estado", ["pendiente", "visto"])
    .order("programado_para", { ascending: true })
    .limit(20);

  if (error) {
    console.error("No se pudieron cargar los seguimientos:", error);
    return NextResponse.json(
      { error: "No pudimos cargar tus seguimientos." },
      { status: 500, headers: noStoreHeaders() },
    );
  }

  return NextResponse.json({ followups: data ?? [] }, { headers: noStoreHeaders() });
}

export async function PATCH(request: Request) {
  const auth = await authenticatedClient();
  if (auth.error) return auth.error;

  const body = (await request.json().catch(() => null)) as {
    id?: string;
    estado?: string;
  } | null;
  const id = typeof body?.id === "string" ? body.id.trim() : "";
  const estado = typeof body?.estado === "string" ? body.estado : "";

  if (!isUuid(id) || !ALLOWED_STATES.has(estado)) {
    return NextResponse.json(
      { error: "Seguimiento o estado no válido." },
      { status: 400, headers: noStoreHeaders() },
    );
  }

  const { data: transition, error } = await auth.supabase.rpc(
    "eos_transition_followup_v36",
    {
      p_followup_id: id,
      p_estado: estado,
    },
  );

  if (error) {
    const message = error.message || "";

    if (message.includes("EOS_FOLLOWUP_NOT_FOUND")) {
      return NextResponse.json(
        { error: "Seguimiento no encontrado." },
        { status: 404, headers: noStoreHeaders() },
      );
    }

    if (
      message.includes("EOS_FOLLOWUP_CLOSED") ||
      message.includes("EOS_FOLLOWUP_TRANSITION_CONFLICT")
    ) {
      return NextResponse.json(
        { error: "Este seguimiento ya fue cerrado y no puede reactivarse." },
        { status: 409, headers: noStoreHeaders() },
      );
    }

    console.error("No se pudo actualizar el seguimiento:", error);
    return NextResponse.json(
      { error: "No pudimos actualizar el seguimiento." },
      { status: 500, headers: noStoreHeaders() },
    );
  }

  if (!transition || typeof transition !== "object" || Array.isArray(transition)) {
    console.error("La transición del seguimiento devolvió una respuesta inválida.");
    return NextResponse.json(
      { error: "No pudimos confirmar la actualización del seguimiento." },
      { status: 500, headers: noStoreHeaders() },
    );
  }

  const result = transition as {
    followup?: unknown;
    idempotent?: boolean;
  };

  return NextResponse.json(
    {
      followup: result.followup ?? null,
      idempotent: Boolean(result.idempotent),
    },
    { headers: noStoreHeaders() },
  );
}

async function authenticatedClient() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();

  if (error || !user) {
    return {
      supabase,
      userId: "",
      error: NextResponse.json(
        { error: "Sesión no válida." },
        { status: 401, headers: noStoreHeaders() },
      ),
    };
  }

  return { supabase, userId: user.id, error: null };
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function noStoreHeaders() {
  return { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" };
}
