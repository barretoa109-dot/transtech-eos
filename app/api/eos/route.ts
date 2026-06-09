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

    console.log("RESPUESTA CRUDA N8N:", rawText);

    let respuesta = "";

    try {
      const data = JSON.parse(rawText);

      respuesta =
        data?.respuesta ||
        data?.output ||
        data?.text ||
        data?.message ||
        data?.content?.[0]?.text ||
        data?.[0]?.respuesta ||
        data?.[0]?.output ||
        data?.[0]?.text ||
        "";
    } catch {
      respuesta = rawText;
    }

    if (typeof respuesta !== "string") {
      respuesta = JSON.stringify(respuesta);
    }

    respuesta = respuesta
      .replace(/^```json/i, "")
      .replace(/^```/, "")
      .replace(/```$/, "")
      .replace(/\\n/g, "\n")
      .trim();

    if (!respuesta || respuesta === "[object Object]") {
      respuesta =
        "Te leo. Contame un poco más de contexto y lo vemos paso a paso.";
    }

    return Response.json(
      { respuesta },
      { status: response.ok ? 200 : response.status }
    );
  } catch (error) {
    console.log("Error proxy EOS:", error);

    return Response.json(
      {
        respuesta:
          "Ahora mismo no pude conectarme bien. Probá nuevamente en unos segundos.",
      },
      { status: 500 }
    );
  }
}