import { createClient } from "@/lib/supabase/server";

/**
 * Vincular un número de WhatsApp a la cuenta de quien tiene la sesión abierta.
 *
 * El código, no el número, es la prueba de identidad: `usuarios.whatsapp` ya
 * existe pero nadie confirmó nunca que ese teléfono sea de quien dice serlo.
 * Acá la persona ya probó quién es (tiene sesión), así que lo único que hace
 * falta es un código de un solo uso que ella misma mande por WhatsApp — eso
 * es lo que hace que el número, recién ahí, quede vinculado. La lectura del
 * código y la vinculación en sí pasan por `app/api/whatsapp/webhook`.
 */

const TABLA = "eos_whatsapp_vinculos_v162";
const CODIGO_VIGENCIA_MS = 10 * 60 * 1000;

function generarCodigo(): string {
  return String(Math.floor(100_000 + Math.random() * 900_000));
}

function enmascarar(telefono: string | null): string | null {
  if (!telefono) return null;
  return telefono.length > 4 ? `•••${telefono.slice(-4)}` : telefono;
}

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return Response.json({ error: "Sesión inválida." }, { status: 401 });
  }

  const { data, error } = await supabase
    .from(TABLA)
    .select("telefono, verificado_at, codigo_expira_at")
    .eq("usuario_id", user.id)
    .maybeSingle();

  if (error) {
    console.error("No se pudo leer el vínculo de WhatsApp:", error);
    return Response.json({ error: "No pudimos consultar tu vínculo de WhatsApp." }, { status: 503 });
  }

  const vinculado = Boolean(data?.telefono && data?.verificado_at);
  const codigoVigente = Boolean(
    data?.codigo_expira_at && new Date(data.codigo_expira_at).getTime() > Date.now(),
  );

  return Response.json({
    vinculado,
    telefono_enmascarado: vinculado ? enmascarar(data!.telefono) : null,
    codigo_pendiente: !vinculado && codigoVigente,
    numero_whatsapp_eos: process.env.WHATSAPP_DISPLAY_NUMBER || null,
  });
}

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return Response.json({ error: "Sesión inválida." }, { status: 401 });
  }

  const expiraAt = new Date(Date.now() + CODIGO_VIGENCIA_MS).toISOString();

  // Un reintento alcanza: la ventana de colisión es un código de 6 dígitos
  // compartido entre las pocas vinculaciones pendientes en un mismo momento.
  for (let intento = 0; intento < 2; intento++) {
    const codigo = generarCodigo();

    const { error } = await supabase
      .from(TABLA)
      .upsert(
        { usuario_id: user.id, codigo, codigo_expira_at: expiraAt, updated_at: new Date().toISOString() },
        { onConflict: "usuario_id" },
      );

    if (!error) {
      return Response.json({
        codigo,
        expira_en_segundos: CODIGO_VIGENCIA_MS / 1000,
        numero_whatsapp_eos: process.env.WHATSAPP_DISPLAY_NUMBER || null,
      });
    }

    // 23505: unique_violation. Cualquier otro error no se soluciona reintentando.
    if ((error as { code?: string }).code !== "23505") {
      console.error("No se pudo generar el código de vinculación de WhatsApp:", error);
      return Response.json({ error: "No pudimos generar el código. Probá nuevamente." }, { status: 503 });
    }
  }

  return Response.json({ error: "No pudimos generar el código. Probá nuevamente." }, { status: 503 });
}

export async function DELETE() {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return Response.json({ error: "Sesión inválida." }, { status: 401 });
  }

  // No se borra la fila: se limpia el teléfono y el código. La conversación
  // de WhatsApp que haya quedado asociada se conserva por si vuelve a
  // vincular — es historial de la cuenta, no del número.
  const { error } = await supabase
    .from(TABLA)
    .update({ telefono: null, verificado_at: null, codigo: null, codigo_expira_at: null })
    .eq("usuario_id", user.id);

  if (error) {
    console.error("No se pudo desvincular el WhatsApp:", error);
    return Response.json({ error: "No pudimos desvincular tu WhatsApp. Probá nuevamente." }, { status: 503 });
  }

  return Response.json({ ok: true });
}
