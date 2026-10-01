import { after } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { adminSinTipos } from "@/lib/supabase/sin-tipos";
import { sumarCostoIA } from "@/lib/eos/costo-ia";
import { INSTRUCCIONES_TITULO, TITULOS_AUTOMATICOS, limpiarTituloDelModelo, tituloProvisional } from "@/lib/eos/titulo-chat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
 * El título de una conversación, escrito por un modelo barato (01/10/2026).
 *
 * Solo la persona dueña de la conversación lo pide, y solo se reemplaza un
 * título automático (de fábrica, de palabras clave de antes, o el provisional
 * del primer mensaje): si la persona lo renombró, no se toca. La escritura es
 * condicional (`.eq("titulo", actual)`): si cambió mientras tanto, no se pisa.
 *
 * Modelo: gpt-6-luna (US$ 0,10 / 0,50 por millón): un título cuesta menos de
 * US$ 0,0005. Va al consumo del mes de la persona.
 */
const MODELO_TITULO = "gpt-6-luna";
const TARIFA = { entrada: 0.1, salida: 0.5 };

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "sesion" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { conversacion_id?: unknown } | null;
  const conversacionId = typeof body?.conversacion_id === "string" ? body.conversacion_id : "";
  if (!/^[0-9a-f-]{36}$/i.test(conversacionId)) return Response.json({ error: "conversacion" }, { status: 400 });

  const admin = adminSinTipos();
  const { data: conversacion } = await admin
    .from("conversaciones")
    .select("id, titulo")
    .eq("id", conversacionId)
    .eq("usuario_id", user.id)
    .maybeSingle();
  if (!conversacion) return Response.json({ error: "conversacion" }, { status: 404 });

  const { data: filas } = await admin
    .from("mensajes")
    .select("rol, texto")
    .eq("conversacion_id", conversacionId)
    .eq("usuario_id", user.id)
    .order("created_at", { ascending: true })
    .limit(6);
  const mensajes = (filas ?? []) as { rol: string; texto: string }[];
  const primeroDelUsuario = mensajes.find((m) => m.rol === "usuario")?.texto ?? "";

  const actual = String(conversacion.titulo ?? "");
  const esAutomatico = !actual || TITULOS_AUTOMATICOS.has(actual) || actual === tituloProvisional(primeroDelUsuario);
  if (!esAutomatico) return Response.json({ titulo: actual, cambiado: false });
  if (!mensajes.some((m) => m.rol === "eos")) return Response.json({ titulo: actual, cambiado: false });

  const clave = process.env.OPENAI_API_KEY;
  if (!clave) return Response.json({ titulo: actual, cambiado: false });

  const conversacionTexto = mensajes
    .map((m) => `${m.rol === "usuario" ? "Persona" : "EOS"}: ${String(m.texto ?? "").replace(/\s+/g, " ").slice(0, 500)}`)
    .join("\n");

  let titulo: string | null = null;
  try {
    const r = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${clave}` },
      body: JSON.stringify({
        model: MODELO_TITULO,
        reasoning: { effort: "low" },
        max_output_tokens: 300,
        instructions: INSTRUCCIONES_TITULO,
        input: conversacionTexto,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (r.ok) {
      const ai = (await r.json()) as {
        output?: { type?: string; content?: { type?: string; text?: string }[] }[];
        usage?: { input_tokens?: number; output_tokens?: number };
      };
      const texto = ai.output?.find((o) => o.type === "message")?.content?.find((c) => c.type === "output_text")?.text;
      titulo = limpiarTituloDelModelo(texto);
      const usd = ((ai.usage?.input_tokens ?? 0) * TARIFA.entrada + (ai.usage?.output_tokens ?? 0) * TARIFA.salida) / 1e6;
      if (usd > 0) after(() => sumarCostoIA(user.id, usd));
    }
  } catch {
    // Sin título nuevo queda el provisional: no es un error para la persona.
  }

  if (!titulo || titulo === actual) return Response.json({ titulo: actual, cambiado: false, sin_tema: !titulo });

  const { data: guardado } = await admin
    .from("conversaciones")
    .update({ titulo })
    .eq("id", conversacionId)
    .eq("usuario_id", user.id)
    .eq("titulo", actual)
    .select("titulo")
    .maybeSingle();

  return Response.json({ titulo: guardado?.titulo ?? actual, cambiado: Boolean(guardado) });
}
