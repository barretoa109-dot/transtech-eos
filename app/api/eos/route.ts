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

    const text = await response.text();

    return new Response(text, {
      status: response.status,
      headers: {
        "Content-Type": "application/json",
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