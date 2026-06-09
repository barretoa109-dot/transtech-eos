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

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const response = await fetch(
      "https://n8n-production-6cdb.up.railway.app/webhook/eos-chat",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
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

    respuesta = respuesta
      .replace(/^```json/i, "")
      .replace(/^```/, "")
      .replace(/```$/, "")
      .replace(/\\n/g, "\n")
      .replace(/\\"/g, '"')
      .trim();

    if (!respuesta || respuesta === "[object Object]") {
      respuesta = `DEBUG: n8n devolvió vacío o sin texto. Respuesta cruda: ${rawText}`;
    }

    return Response.json({ respuesta });
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