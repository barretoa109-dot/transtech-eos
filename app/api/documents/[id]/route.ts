import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const auth = await authenticatedClient();
  if (auth.response) return auth.response;

  const { id } = await context.params;
  if (!validUuid(id)) {
    return NextResponse.json(
      { error: "Documento no válido." },
      { status: 400, headers: noStoreHeaders() },
    );
  }

  const [document, findings, links] = await Promise.all([
    auth.supabase
      .from("eos_documents_v11")
      .select("*")
      .eq("usuario_id", auth.userId)
      .eq("id", id)
      .maybeSingle(),
    auth.supabase
      .from("eos_document_findings_v11")
      .select("id,finding_type,title,value_text,normalized_value,evidence_text,confidence,importance,status,created_at,metadata")
      .eq("usuario_id", auth.userId)
      .eq("document_id", id)
      .order("importance", { ascending: false })
      .order("created_at", { ascending: false }),
    auth.supabase
      .from("eos_document_links_v11")
      .select("id,entity_type,entity_id,relation,confidence,created_at,metadata")
      .eq("usuario_id", auth.userId)
      .eq("document_id", id)
      .order("created_at", { ascending: false }),
  ]);

  const error = document.error || findings.error || links.error;
  if (error) return databaseError("cargar", error);

  if (!document.data) {
    return NextResponse.json(
      { error: "Documento no encontrado." },
      { status: 404, headers: noStoreHeaders() },
    );
  }

  return NextResponse.json(
    {
      document: document.data,
      findings: findings.data ?? [],
      links: links.data ?? [],
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
      response: NextResponse.json(
        { error: "Sesión no válida." },
        { status: 401, headers: noStoreHeaders() },
      ),
    };
  }

  return { supabase, userId: user.id, response: null };
}

function validUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function databaseError(action: string, error: unknown) {
  console.error(`No se pudo ${action} el documento:`, error);
  return NextResponse.json(
    { error: `No pudimos ${action} el documento en este momento.` },
    { status: 500, headers: noStoreHeaders() },
  );
}

function noStoreHeaders() {
  return { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" };
}
