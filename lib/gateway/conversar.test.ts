import test from "node:test";
import assert from "node:assert/strict";

import { conversar, gatewayEnTypeScript } from "./conversar.ts";
import { MODELO, PROMPT_SISTEMA } from "./sistema.ts";

const UUID_A = "11111111-1111-4111-8111-111111111111";
const UUID_B = "22222222-2222-4222-9222-222222222222";
const UUID_C = "33333333-3333-4333-a333-333333333333";

function payload(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    request_id: UUID_A,
    usuario_id: UUID_B,
    conversacion_id: UUID_C,
    mensaje: "¿cómo voy este mes?",
    ...extra,
  };
}

function respuestaDeOpenAI(texto: string) {
  return {
    id: "resp_1",
    status: "completed",
    model: MODELO,
    output: [{ type: "message", content: [{ type: "output_text", text: texto }] }],
    usage: { input_tokens: 10, output_tokens: 5 },
  };
}

/**
 * Corre `conversar` con un OpenAI de mentira.
 *
 * Devuelve además lo que se le mandó, que es la mitad de lo que hay que
 * probar: que el prompt del sistema viaje entero y que el modelo sea el mismo
 * que usa n8n.
 */
async function conFetchFalso(
  responder: () => Promise<Response> | Response,
  entrada = payload(),
): Promise<{ resultado: Awaited<ReturnType<typeof conversar>>; enviado: Record<string, unknown> | null }> {
  const fetchOriginal = globalThis.fetch;
  const claveOriginal = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "sk-de-prueba";

  let enviado: Record<string, unknown> | null = null;

  globalThis.fetch = (async (_url: unknown, opciones?: { body?: string }) => {
    enviado = opciones?.body ? JSON.parse(opciones.body) : null;
    return responder();
  }) as unknown as typeof fetch;

  try {
    return { resultado: await conversar(entrada), enviado };
  } finally {
    globalThis.fetch = fetchOriginal;
    if (claveOriginal === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = claveOriginal;
  }
}

function ok(cuerpo: unknown): Response {
  return new Response(JSON.stringify(cuerpo), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

// ---------------------------------------------------------------------------
// La bandera
// ---------------------------------------------------------------------------

test("sin la bandera el gateway en TypeScript no se usa", () => {
  const flag = process.env.EOS_GATEWAY_TS;
  const clave = process.env.OPENAI_API_KEY;
  try {
    process.env.OPENAI_API_KEY = "sk-x";

    delete process.env.EOS_GATEWAY_TS;
    assert.equal(gatewayEnTypeScript(), false);

    process.env.EOS_GATEWAY_TS = "0";
    assert.equal(gatewayEnTypeScript(), false);

    process.env.EOS_GATEWAY_TS = "1";
    assert.equal(gatewayEnTypeScript(), true);

    // Con la bandera pero sin clave tampoco: prenderla sola dejaría a todo el
    // mundo sin respuesta.
    delete process.env.OPENAI_API_KEY;
    assert.equal(gatewayEnTypeScript(), false);
  } finally {
    if (flag === undefined) delete process.env.EOS_GATEWAY_TS;
    else process.env.EOS_GATEWAY_TS = flag;
    if (clave === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = clave;
  }
});

test("sin clave no intenta nada y devuelve null", async () => {
  const clave = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    assert.equal(await conversar(payload()), null);
  } finally {
    if (clave !== undefined) process.env.OPENAI_API_KEY = clave;
  }
});

// ---------------------------------------------------------------------------
// Qué se le manda a OpenAI
// ---------------------------------------------------------------------------

test("manda el mismo modelo y el prompt del sistema entero", async () => {
  const { enviado } = await conFetchFalso(() =>
    ok(respuestaDeOpenAI(JSON.stringify({ respuesta: "Bien.", acciones: [] }))),
  );

  const cuerpo = enviado as unknown as {
    model: string;
    input: { role: string; content: { type: string; text?: string }[] }[];
  };

  assert.equal(cuerpo.model, MODELO);
  assert.equal(cuerpo.input[0].role, "system");
  assert.equal(cuerpo.input[0].content[0].text, PROMPT_SISTEMA, "el prompt del sistema llegó recortado");
  assert.equal(cuerpo.input[1].role, "user");
});

test("la imagen viaja en el turno del usuario", async () => {
  const { enviado } = await conFetchFalso(
    () => ok(respuestaDeOpenAI(JSON.stringify({ respuesta: "Veo el ticket.", acciones: [] }))),
    payload({ archivo: { nombre: "t.png", tipo: "image/png", base64: "AAAA" } }),
  );

  const cuerpo = enviado as unknown as {
    input: { content: { type: string; image_url?: string }[] }[];
  };
  const imagen = cuerpo.input[1].content.find((c) => c.type === "input_image");
  assert.equal(imagen?.image_url, "data:image/png;base64,AAAA");
});

// ---------------------------------------------------------------------------
// Conversación pura: responde este camino
// ---------------------------------------------------------------------------

test("sin acciones responde acá mismo", async () => {
  const { resultado } = await conFetchFalso(() =>
    ok(respuestaDeOpenAI(JSON.stringify({ respuesta: "Vas bien.", acciones: [] }))),
  );

  assert.equal(resultado?.estado, "respondido");
  assert.ok(resultado?.estado === "respondido" && resultado.cuerpo.respuesta === "Vas bien.");
  assert.ok(resultado?.estado === "respondido" && resultado.cuerpo.tokens_entrada === 10);
});

// ---------------------------------------------------------------------------
// La red: todo lo que sale mal termina en n8n
// ---------------------------------------------------------------------------

test("con acciones se aparta y delega en n8n", async () => {
  // El nodo que arma los jobs sigue en n8n: esta etapa no lo mueve.
  const { resultado } = await conFetchFalso(() =>
    ok(
      respuestaDeOpenAI(
        JSON.stringify({
          respuesta: "Lo dejo listo.",
          acciones: [{ tipo: "REGISTRAR_VENTA", datos: {} }],
        }),
      ),
    ),
  );

  assert.equal(resultado?.estado, "delegar");
  assert.ok(resultado?.estado === "delegar" && resultado.motivo === "REGISTRAR_VENTA");
});

test("si OpenAI responde con error, se cae a n8n", async () => {
  const { resultado } = await conFetchFalso(() => new Response("nope", { status: 500 }));
  assert.equal(resultado, null);
});

test("si OpenAI rechaza la clave, se cae a n8n", async () => {
  const { resultado } = await conFetchFalso(() => new Response("", { status: 401 }));
  assert.equal(resultado, null);
});

test("si se corta la red, se cae a n8n", async () => {
  const { resultado } = await conFetchFalso(() => {
    throw new Error("ECONNRESET");
  });
  assert.equal(resultado, null);
});

test("si el cuerpo no es JSON, se cae a n8n", async () => {
  const { resultado } = await conFetchFalso(() => new Response("<html>502</html>", { status: 200 }));
  assert.equal(resultado, null);
});

test("una entrada inválida se delega en vez de romper", async () => {
  // n8n va a fallar igual, pero conservar el comportamiento de hoy es lo único
  // que esta etapa se compromete a no cambiar.
  const { resultado } = await conFetchFalso(
    () => ok(respuestaDeOpenAI("x")),
    payload({ request_id: "no-es-uuid" }),
  );
  assert.equal(resultado, null);
});

test("nunca lanza: siempre devuelve algo que quien llama pueda leer", async () => {
  for (const romper of [
    () => {
      throw new Error("boom");
    },
    () => new Response("", { status: 503 }),
    () => ok(null),
    () => ok({ sin: "texto" }),
  ]) {
    const { resultado } = await conFetchFalso(romper);
    assert.ok(resultado === null || resultado.estado === "respondido" || resultado.estado === "delegar");
  }
});
