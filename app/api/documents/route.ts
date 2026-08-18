import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const ALLOWED_TYPES = new Set([
  "invoice",
  "receipt",
  "contract",
  "report",
  "spreadsheet",
  "proposal",
  "policy",
  "statement",
  "presentation",
  "image",
  "text",
  "unknown",
]);

const ALLOWED_SOURCES = new Set([
  "chat_upload",
  "manual",
  "generated",
  "imported",
  "api",
]);

export async function GET(request: Request) {
  const auth = await authenticatedClient();
  if (auth.response) return auth.response;

  const { searchParams } = new URL(request.url);
  const limit = clampLimit(searchParams.get("limit"));
  const status = cleanText(searchParams.get("status"), 40);
  const type = cleanText(searchParams.get("type"), 40);

  let query = auth.supabase
    .from("eos_documents_v11")
    .select(
      "id,nombre,mime_type,extension,size_bytes,source,document_type,extraction_status,intelligence_status,summary,confidence,processed_at,created_at,updated_at",
    )
    .eq("usuario_id", auth.userId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (status) query = query.eq("intelligence_status", status);
  if (type) query = query.eq("document_type", type);

  const { data, error } = await query;
  if (error) return databaseError("cargar", error);

  return NextResponse.json(
    { documents: data ?? [] },
    { headers: noStoreHeaders() },
  );
}

export async function POST(request: Request) {
  const auth = await authenticatedClient();
  if (auth.response) return auth.response;

  const body = await request.json().catch(() => null);
  const nombre = cleanText(body?.nombre, 240);
  const mimeType = cleanText(body?.mime_type, 160);
  const extension = normalizeExtension(body?.extension);
  const documentType = ALLOWED_TYPES.has(body?.document_type)
    ? body.document_type
    : "unknown";
  const source = ALLOWED_SOURCES.has(body?.source)
    ? body.source
    : "chat_upload";
  const checksum = cleanText(body?.checksum_sha256, 128) || null;
  const storagePath = cleanText(body?.storage_path, 1200) || null;
  const conversationId = validUuid(body?.conversacion_id);
  const sizeBytes = validNonNegativeInteger(body?.size_bytes);

  if (!nombre || !mimeType) {
    return NextResponse.json(
      { error: "El nombre y el tipo MIME del documento son obligatorios." },
      { status: 400, headers: noStoreHeaders() },
    );
  }

  const payload = {
    usuario_id: auth.userId,
    conversacion_id: conversationId,
    nombre,
    mime_type: mimeType,
    extension,
    size_bytes: sizeBytes,
    checksum_sha256: checksum,
    storage_path: storagePath,
    source,
    document_type: documentType,
    extraction_status: "pending",
    intelligence_status: "pending",
    metadata: sanitizeMetadata(body?.metadata),
  };

  if (checksum) {
    const { data: existing, error: existingError } = await auth.supabase
      .from("eos_documents_v11")
      .select("*")
      .eq("usuario_id", auth.userId)
      .eq("checksum_sha256", checksum)
      .maybeSingle();

    if (existingError) return databaseError("verificar", existingError);
    if (existing) {
      return NextResponse.json(
        { document: existing, duplicate: true },
        { status: 200, headers: noStoreHeaders() },
      );
    }
  }

  const { data, error } = await auth.supabase
    .from("eos_documents_v11")
    .insert(payload)
    .select("*")
    .single();

  if (error) return databaseError("registrar", error);

  return NextResponse.json(
    { document: data, duplicate: false },
    { status: 201, headers: noStoreHeaders() },
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

function cleanText(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function normalizeExtension(value: unknown) {
  const cleaned = cleanText(value, 20).replace(/^\./, "").toLowerCase();
  return cleaned || null;
}

function validUuid(value: unknown) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalized)
    ? normalized
    : null;
}

function validNonNegativeInteger(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function clampLimit(value: string | null) {
  const parsed = Number(value ?? 50);
  if (!Number.isFinite(parsed)) return 50;
  return Math.min(100, Math.max(1, Math.floor(parsed)));
}

function sanitizeMetadata(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value;
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
