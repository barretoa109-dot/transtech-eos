import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { exigirModulo } from "@/lib/modulos/acceso";
import { filtroDeEmpresa, miEmpresa } from "@/lib/empresa/acceso";
import { combinarConfig, validarConfig, type FilaConfig } from "@/lib/crm/etapas-config";

export const dynamic = "force-dynamic";

/**
 * Cómo se llama cada etapa del embudo, en qué orden se muestra y qué probabilidad lleva.
 *
 * GET     la configuración de la empresa, ya combinada con la de fábrica.
 * PUT     { etapas: [{ etapa, etiqueta, orden, visible, probabilidad }] }  la guarda.
 * DELETE  vuelve a la de fábrica.
 *
 * Los CÓDIGOS de etapa no se configuran: los indicadores, el trigger que gana una oportunidad al
 * registrar una venta y el aviso de estancadas dependen de ellos. Lo que se cambia es cómo se ven.
 *
 * Todo va con la SESIÓN de la persona: la RLS y el `usuario_id` de la sesión son la frontera.
 */

const noStore = { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" };
const AUSENTE = new Set(["42P01", "PGRST205"]);

const sinTabla = () =>
  NextResponse.json({ error: "Esta función todavía no está disponible en tu cuenta." }, { status: 409, headers: noStore });

export async function GET() {
  const puerta = await exigirModulo("crm");
  if (puerta.respuesta) return puerta.respuesta;

  const supabase = await createClient();
  const empresaId = await miEmpresa(supabase);

  const { data, error } = await supabase
    .from("eos_crm_etapas_config")
    .select("etapa,etiqueta,orden,visible,probabilidad_defecto")
    .or(filtroDeEmpresa(puerta.usuarioId, empresaId));

  if (error && !AUSENTE.has(String(error.code))) {
    console.error("CRM: no se pudo leer la configuración de etapas:", error);
    return NextResponse.json({ error: "No pudimos cargar las etapas." }, { status: 503, headers: noStore });
  }

  // Sin la tabla (v185 sin aplicar), son las de fábrica.
  return NextResponse.json({ etapas: combinarConfig(error ? [] : ((data ?? []) as FilaConfig[])) }, { headers: noStore });
}

export async function PUT(request: Request) {
  const puerta = await exigirModulo("crm");
  if (puerta.respuesta) return puerta.respuesta;

  let cuerpo: unknown;
  try {
    cuerpo = await request.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido." }, { status: 400, headers: noStore });
  }

  const validacion = validarConfig(cuerpo);
  if (!validacion.ok) {
    return NextResponse.json({ error: validacion.error }, { status: 400, headers: noStore });
  }

  const supabase = await createClient();
  const ahora = new Date().toISOString();

  const { error } = await supabase.from("eos_crm_etapas_config").upsert(
    validacion.filas.map((f) => ({ ...f, usuario_id: puerta.usuarioId, actualizado_en: ahora })),
    { onConflict: "usuario_id,etapa" },
  );

  if (error) {
    if (AUSENTE.has(String(error.code))) return sinTabla();
    console.error("CRM: no se pudo guardar la configuración de etapas:", error);
    return NextResponse.json({ error: "No pudimos guardar las etapas." }, { status: 503, headers: noStore });
  }

  return NextResponse.json({ etapas: combinarConfig(validacion.filas) }, { headers: noStore });
}

export async function DELETE() {
  const puerta = await exigirModulo("crm");
  if (puerta.respuesta) return puerta.respuesta;

  const supabase = await createClient();
  const { error } = await supabase.from("eos_crm_etapas_config").delete().eq("usuario_id", puerta.usuarioId);

  if (error) {
    if (AUSENTE.has(String(error.code))) return sinTabla();
    console.error("CRM: no se pudo restablecer la configuración de etapas:", error);
    return NextResponse.json({ error: "No pudimos restablecer las etapas." }, { status: 503, headers: noStore });
  }

  return NextResponse.json({ etapas: combinarConfig([]) }, { headers: noStore });
}
