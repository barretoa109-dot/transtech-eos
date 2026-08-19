import { createClient } from "@/lib/supabase/server";
import { extraerMovimientos, type MoneyFinding } from "@/lib/finanzas/extraerMovimientos";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const MAX_CONFIRMAR = 50;

/**
 * GET: movimientos candidatos detectados en los documentos del usuario.
 *
 * Doctrina EOS Finanzas: EOS hace el trabajo (detectar, normalizar, inferir
 * dirección y fecha) y el usuario solo observa/confirma. NO se escriben
 * movimientos automáticamente — un importe mal leído contaminaría el
 * disponible real, y el principio de "autonomía con límites" pide
 * confirmación antes de afectar los números reales del usuario.
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Sesión no válida." }, { status: 401, headers: noStore() });
  }

  const [findingsRes, movimientosRes] = await Promise.all([
    supabase
      .from("eos_document_findings_v11")
      .select("id,document_id,finding_type,value_text,evidence_text,created_at")
      .eq("usuario_id", user.id)
      .in("finding_type", ["money", "date"])
      .order("created_at", { ascending: false })
      .limit(400),
    supabase
      .from("eos_movimientos_financieros")
      .select("metadata")
      .eq("usuario_id", user.id)
      .eq("origen", "documento"),
  ]);

  if (findingsRes.error) {
    console.error("No se pudieron leer los hallazgos de documentos:", findingsRes.error);
    return NextResponse.json({ candidatos: [] }, { headers: noStore() });
  }

  const filas = (findingsRes.data ?? []) as (MoneyFinding & { finding_type: string })[];

  // Ya importados: se filtran por el finding original para no duplicar.
  const yaImportados = new Set(
    ((movimientosRes.data ?? []) as { metadata: Record<string, unknown> | null }[])
      .map((m) => (m.metadata?.finding_id as string) ?? null)
      .filter(Boolean),
  );

  const money = filas.filter((f) => f.finding_type === "money" && !yaImportados.has(f.id));
  const dates = filas.filter((f) => f.finding_type === "date");

  const candidatos = extraerMovimientos(money, dates).slice(0, 40);

  return NextResponse.json({ candidatos }, { headers: noStore() });
}

/**
 * POST: confirma candidatos y los guarda como movimientos reales.
 * Solo acepta los campos necesarios; nunca confía en un usuario_id del body.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Sesión no válida." }, { status: 401, headers: noStore() });
  }

  let body: { movimientos?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido." }, { status: 400, headers: noStore() });
  }

  if (!Array.isArray(body.movimientos) || body.movimientos.length === 0) {
    return NextResponse.json({ error: "No enviaste movimientos." }, { status: 400, headers: noStore() });
  }

  if (body.movimientos.length > MAX_CONFIRMAR) {
    return NextResponse.json(
      { error: `Podés confirmar hasta ${MAX_CONFIRMAR} movimientos por vez.` },
      { status: 400, headers: noStore() },
    );
  }

  const filas = [];

  for (const item of body.movimientos as Record<string, unknown>[]) {
    const monto = Number(item.monto);
    const tipo = String(item.tipo);
    const moneda = String(item.moneda ?? "PYG");

    if (!Number.isFinite(monto) || monto <= 0) {
      return NextResponse.json({ error: "Hay un importe inválido." }, { status: 400, headers: noStore() });
    }

    if (!["ingreso", "gasto", "compromiso"].includes(tipo)) {
      return NextResponse.json({ error: "Hay un tipo de movimiento inválido." }, { status: 400, headers: noStore() });
    }

    if (!["PYG", "USD"].includes(moneda)) {
      return NextResponse.json({ error: "Moneda no soportada." }, { status: 400, headers: noStore() });
    }

    const fecha =
      typeof item.fecha === "string" && /^\d{4}-\d{2}-\d{2}$/.test(item.fecha)
        ? item.fecha
        : new Date().toISOString().slice(0, 10);

    filas.push({
      usuario_id: user.id,
      tipo,
      monto,
      moneda,
      fecha,
      descripcion: typeof item.descripcion === "string" ? item.descripcion.slice(0, 300) : null,
      origen: "documento" as const,
      documento_id: typeof item.document_id === "string" ? item.document_id : null,
      metadata: {
        finding_id: typeof item.finding_id === "string" ? item.finding_id : null,
        confianza: Number(item.confianza) || null,
      },
    });
  }

  const { error } = await supabase.from("eos_movimientos_financieros").insert(filas);

  if (error) {
    console.error("No se pudieron guardar los movimientos:", error);
    return NextResponse.json({ error: "No pudimos guardar los movimientos." }, { status: 500, headers: noStore() });
  }

  return NextResponse.json({ ok: true, guardados: filas.length }, { headers: noStore() });
}

function noStore() {
  return { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" };
}
