function buscarTexto(valor: any): string {
  if (!valor) return "";

  if (typeof valor === "string") return valor;

  if (Array.isArray(valor)) {
    for (const item of valor) {
      const encontrado = buscarTexto(item);
      if (encontrado) return encontrado;
    }
  }

  if (typeof valor === "object") {
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
      const encontrado = buscarTexto(valor[campo]);
      if (encontrado) return encontrado;
    }

    for (const key of Object.keys(valor)) {
      const encontrado = buscarTexto(valor[key]);
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
    const body = await req.json();

    const payload = {
      usuario_id: body.usuario_id || body.user_id || "",
      conversacion_id: body.conversacion_id || "",
      nombre: body.nombre || "Usuario",
      plan: body.plan || "free",
      mensaje: body.mensaje || "",
      historial: body.historial || [],
      origen: body.origen || "eos-web",
      fecha: new Date().toISOString(),
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

    return Response.json({
      respuesta,
      metadata: {
        usuario_id: payload.usuario_id,
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