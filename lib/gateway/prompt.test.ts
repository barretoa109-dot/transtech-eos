import test from "node:test";
import assert from "node:assert/strict";

import { SIN_HISTORIAL, armarPrompt, bloqueDeNegocio, historialComoTexto } from "./prompt.ts";
import { prepararEntrada } from "./entrada.ts";

const UUID_A = "11111111-1111-4111-8111-111111111111";
const UUID_B = "22222222-2222-4222-9222-222222222222";
const UUID_C = "33333333-3333-4333-a333-333333333333";

function entrada(extra: Record<string, unknown> = {}) {
  return prepararEntrada({
    request_id: UUID_A,
    usuario_id: UUID_B,
    conversacion_id: UUID_C,
    mensaje: "¿cómo voy?",
    ...extra,
  });
}

// ---------------------------------------------------------------------------
// El historial
// ---------------------------------------------------------------------------

test("el historial mantiene el orden y marca quién habló", () => {
  const texto = historialComoTexto([
    { rol: "usuario", texto: "hola" },
    { rol: "eos", texto: "hola, ¿qué necesitás?" },
    { rol: "usuario", texto: "vendí 3" },
  ]);
  assert.equal(texto, "Usuario: hola\nEOS: hola, ¿qué necesitás?\nUsuario: vendí 3");
});

test("cualquier rol que no sea eos se atribuye al usuario", () => {
  // Es el error inofensivo: al revés, el modelo creería que ya dijo algo que
  // nunca dijo y seguiría desde ahí.
  assert.equal(historialComoTexto([{ rol: "assistant", texto: "x" }]), "Usuario: x");
  assert.equal(historialComoTexto([{ rol: "EOS", texto: "x" }]), "EOS: x");
});

test("acepta los nombres alternativos del texto", () => {
  assert.equal(historialComoTexto([{ role: "eos", content: "x" }]), "EOS: x");
  assert.equal(historialComoTexto([{ rol: "usuario", mensaje: "y" }]), "Usuario: y");
});

test("los turnos vacíos se descartan sin dejar líneas en blanco", () => {
  const texto = historialComoTexto([
    { rol: "usuario", texto: "a" },
    { rol: "eos", texto: "   " },
    { rol: "usuario", texto: "b" },
  ]);
  assert.equal(texto, "Usuario: a\nUsuario: b");
  assert.ok(!texto.includes("\n\n"));
});

test("sin historial lo dice, no manda vacío", () => {
  assert.equal(historialComoTexto([]), SIN_HISTORIAL);
  assert.equal(historialComoTexto([{ rol: "usuario", texto: "" }]), SIN_HISTORIAL);
});

// ---------------------------------------------------------------------------
// El bloque del negocio
// ---------------------------------------------------------------------------

test("sin datos del negocio el bloque NO aparece", () => {
  // Un bloque de ceros haría que el modelo hable de un negocio parado cuando
  // en realidad recién empieza.
  assert.equal(bloqueDeNegocio(""), "");
  assert.equal(bloqueDeNegocio("   \n  "), "");
});

test("con datos, el bloque trae la instrucción de no inventar ni mezclar monedas", () => {
  const b = bloqueDeNegocio("Ventas del mes: Gs. 12.000.000");
  assert.ok(b.includes("Ventas del mes: Gs. 12.000.000"));
  assert.ok(b.includes("no las inventes"));
  assert.ok(b.includes("no las mezcles entre monedas"));
  assert.ok(b.includes("decí que no lo tenés a mano"));
});

test("el prompt sin negocio no menciona el negocio en ningún lado", () => {
  const { prompt_eos } = armarPrompt(entrada());
  assert.ok(!prompt_eos.includes("Cómo va su negocio"));
});

test("el prompt con negocio lo pone antes de la conversación", () => {
  const { prompt_eos } = armarPrompt(entrada({ contexto_negocio: "Ventas: 100" }));
  assert.ok(prompt_eos.indexOf("Cómo va su negocio") < prompt_eos.indexOf("Conversación reciente"));
});

// ---------------------------------------------------------------------------
// La forma del prompt
// ---------------------------------------------------------------------------

test("el prompt trae los encabezados en el orden que el modelo espera", () => {
  const { prompt_eos } = armarPrompt(entrada({ nombre: "Marta", plan: "pro" }));
  const orden = ["Usuario: Marta", "Plan: pro", "Origen: eos-web", "Conversación reciente:", "Mensaje actual:"];

  let desde = -1;
  for (const parte of orden) {
    const donde = prompt_eos.indexOf(parte);
    assert.ok(donde > desde, `"${parte}" quedó fuera de orden`);
    desde = donde;
  }
});

test("el mensaje actual va completo y al final", () => {
  const { prompt_eos } = armarPrompt(entrada({ mensaje: "vendí 3 panes a Ana" }));
  assert.ok(prompt_eos.includes("Mensaje actual:\nvendí 3 panes a Ana"));
});

test("el prompt no arranca ni termina con espacios", () => {
  const { prompt_eos } = armarPrompt(entrada());
  assert.equal(prompt_eos, prompt_eos.trim());
});

// ---------------------------------------------------------------------------
// La imagen
// ---------------------------------------------------------------------------

test("con imagen se la anuncia por su nombre y viaja en el contenido", () => {
  const p = armarPrompt(
    entrada({ archivo: { nombre: "ticket.png", tipo: "image/png", base64: "AAAA" } }),
  );

  assert.equal(p.tiene_imagen, true);
  assert.ok(p.prompt_eos.includes('imagen llamada "ticket.png"'));
  assert.equal(p.contenido.length, 2);
  assert.deepEqual(p.contenido[1], {
    type: "input_image",
    image_url: "data:image/png;base64,AAAA",
  });
});

test("sin imagen no se anuncia ninguna y el contenido es solo texto", () => {
  const p = armarPrompt(entrada());
  assert.equal(p.tiene_imagen, false);
  assert.ok(!p.prompt_eos.includes("imagen llamada"));
  assert.equal(p.contenido.length, 1);
  assert.equal(p.contenido[0].type, "input_text");
});

test("un pdf adjunto NO se anuncia como imagen", () => {
  // Anunciar una imagen que no viaja hace que el modelo describa algo que no
  // vio, y suena idéntico a cuando sí la vio.
  const p = armarPrompt(
    entrada({ archivo: { nombre: "informe.pdf", tipo: "application/pdf", base64: "AAAA" } }),
  );
  assert.equal(p.tiene_imagen, false);
  assert.ok(!p.prompt_eos.includes("imagen llamada"));
  assert.equal(p.contenido.length, 1);
});

test("el texto del contenido es exactamente el prompt", () => {
  const p = armarPrompt(entrada({ contexto_negocio: "Ventas: 100" }));
  assert.equal(p.contenido[0].type === "input_text" && p.contenido[0].text, p.prompt_eos);
});
