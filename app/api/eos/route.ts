import { createClient } from "@/lib/supabase/server";

function buscarTexto(valor: unknown): string {
  if (!valor) return "";

  if (typeof valor === "string") return valor;

  if (Array.isArray(valor)) {
    for (const item of valor) {
      const encontrado = buscarTexto(item);
      if (encontrado) return encontrado;
    }
  }

  if (typeof valor === "object") {
    const registro = valor as Record<string, unknown>;
    const campos = [
      "respuesta",
      "text",
      "message",
      "output",
      "content",
      "data",
      "body",
      "json",
    ];

    for (const campo of campos) {
      const encontrado = buscarTexto(registro[campo]);
      if (encontrado) return encontrado;
    }

    for (const key of Object.keys(registro)) {
      const encontrado = buscarTexto(registro[key]);
      if (encontrado) return encontrado;
    }
  }

  return "";
}

function limpiarRespuesta(texto: string): string {
  return texto
    .replace(/^```json/i, "")
    .replace(/^```/, "")
    .replace(/```$/, "")
    .replace(/\\n/g, "\n")
    .replace(/\\"/g, '"')
    .trim();
}

export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return Response.json(
        { respuesta: "Tu sesión dejó de ser válida. Iniciá sesión nuevamente." },
        { status: 401 },
      );
    }

    const body = await req.json();

    const { data: masterContext, error: contextError } = await supabase
      .from("eos_master_context_v8")
      .select("version,resumen_compacto,proxima_mejor_accion,generado_at,necesita_actualizacion")
      .eq("usuario_id", user.id)
      .maybeSingle();

    if (contextError) {
      console.log("Contexto Maestro no disponible:", contextError);
    }

    const payload = {
      request_id: body.request_id || crypto.randomUUID(),
      usuario_id: user.id,
      conversacion_id: body.conversacion_id || "",
      nombre: body.nombre || "Usuario",
      plan: body.plan || "free",
      mensaje: body.mensaje || "",
      historial: body.historial || [],
      origen: body.origen || "eos-web",
      fecha: new Date().toISOString(),
      contexto_maestro: masterContext?.resumen_compacto || "",
      contexto_maestro_version: masterContext?.version || null,
      proxima_mejor_accion: masterContext?.proxima_mejor_accion || null,
      contexto_maestro_generado_at: masterContext?.generado_at || null,
      contexto_maestro_desactualizado: masterContext?.necesita_actualizacion ?? true,
    };

    if (!payload.usuario_id || !payload.mensaje) {
      return Response.json(
        {
          respuesta:
            "Necesito identificar tu usuario y recibir un mensaje para poder ayudarte bien.",
        },
        { status: 400 }
      );
    }

    const response = await fetch(
      "https://n8n-production-6cdb.up.railway.app/webhook/eos-chat",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      }
    );

    const rawText = await response.text();

    let respuesta = "";

    try {
      const data = JSON.parse(rawText);
      respuesta = buscarTexto(data);
    } catch {
      respuesta = rawText;
    }

    respuesta = limpiarRespuesta(respuesta);

    if (!respuesta || respuesta === "[object Object]") {
      respuesta =
        "Recibí tu mensaje, pero EOS no pudo generar una respuesta clara en este momento. Probá nuevamente.";
    }

    if (!response.ok) {
      console.log("Error desde n8n:", response.status, rawText);

      return Response.json(
        {
          respuesta:
            "EOS recibió tu mensaje, pero tuvo un problema procesándolo. Probá nuevamente en unos segundos.",
        },
        { status: response.status }
      );
    }

    try {
      await fetch(
        process.env.N8N_DECISION_CAPTURE_URL ||
          "https://n8n-production-6cdb.up.railway.app/webhook/eos-decision-capture",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            usuario_id: payload.usuario_id,
            request_id: payload.request_id,
            conversacion_id: payload.conversacion_id,
            mensaje: payload.mensaje,
            respuesta,
          }),
          signal: AbortSignal.timeout(2500),
        },
      );
    } catch (captureError) {
      console.log("Registro de decisión no disponible:", captureError);
    }

    return Response.json({
      respuesta,
      metadata: {
        usuario_id: payload.usuario_id,
        request_id: payload.request_id,
        conversacion_id: payload.conversacion_id,
        origen: payload.origen,
        fecha: payload.fecha,
      },
    });
  } catch (error) {
    console.log("Error proxy EOS:", error);

    return Response.json(
      {
        respuesta:
          "No pude conectarme con EOS en este momento. Probá nuevamente.",
      },
      { status: 500 }
    );
  }
}
