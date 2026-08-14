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
    return NextResponse.json({ error: "No pudimos cargar tus seguimientos." }, { status: 500 });
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

  if (!body?.id || !body.estado || !ALLOWED_STATES.has(body.estado)) {
    return NextResponse.json({ error: "Seguimiento o estado no válido." }, { status: 400 });
  }

  const { data, error } = await auth.supabase
    .from("eos_proactive_followups")
    .update({ estado: body.estado })
    .eq("id", body.id)
    .eq("usuario_id", auth.userId)
    .select("id,estado,visto_at,resuelto_at")
    .maybeSingle();

  if (error) {
    console.error("No se pudo actualizar el seguimiento:", error);
    return NextResponse.json({ error: "No pudimos actualizar el seguimiento." }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json({ error: "Seguimiento no encontrado." }, { status: 404 });
  }

  return NextResponse.json({ followup: data }, { headers: noStoreHeaders() });
}

async function authenticatedClient() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();

  if (error || !user) {
    return {
      supabase,
      userId: "",
      error: NextResponse.json({ error: "Sesión no válida." }, { status: 401 }),
    };
  }

  return { supabase, userId: user.id, error: null };
}

function noStoreHeaders() {
  return { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" };
}
