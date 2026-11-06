import assert from "node:assert/strict";
import { test } from "node:test";

import { PROMPT_SISTEMA } from "./sistema.ts";
import {
  BLOQUES_ERP_CRM_EXCLUSIVOS,
  construirNucleo,
  gatewayNucleoPorModulo,
  necesitaModuloErpCrm,
  PROMPT_NUCLEO,
  promptSistemaDeCuenta,
} from "./prompt-modulos.ts";

test("cada índice excluido sigue siendo el bloque que dice ser", () => {
  // Si alguien reordena sistema.ts, este test se rompe ANTES de que el
  // núcleo quede mal armado en silencio — el mismo problema que ya mordió
  // al proyecto con las listas de acciones de n8n, pero detectado acá.
  const bloques = PROMPT_SISTEMA.split("\n\n");

  for (const [indice, esperado] of BLOQUES_ERP_CRM_EXCLUSIVOS) {
    assert.ok(
      bloques[indice]?.startsWith(esperado),
      `bloque ${indice} esperaba empezar con "${esperado}", es "${bloques[indice]?.slice(0, 60)}"`,
    );
  }
});

test("el núcleo es más chico que el prompt completo, pero no vacío", () => {
  assert.ok(PROMPT_NUCLEO.length < PROMPT_SISTEMA.length);
  assert.ok(PROMPT_NUCLEO.length > PROMPT_SISTEMA.length * 0.6);
});

test("el núcleo NO tiene las instrucciones de REGISTRAR_VENTA", () => {
  // No alcanza con que falte el verbo suelto (puede nombrarse en otro
  // lado, como en la desambiguación negocio/personal): tiene que faltar su
  // bloque de instrucciones completo.
  assert.ok(!PROMPT_NUCLEO.includes("\nREGISTRAR_VENTA\n"));
});

test("el núcleo SÍ conserva reglas generales que no son de un dominio", () => {
  // Spot-check de reglas anti-bug que tienen que sobrevivir a cualquier
  // recorte: si una de estas desaparece del núcleo, un mensaje puramente
  // personal reintroduce un bug ya arreglado.
  assert.ok(PROMPT_NUCLEO.includes("LO QUE YA CONFIRMASTE NO SE VUELVE A MANDAR"));
  assert.ok(PROMPT_NUCLEO.includes("UN [Audio] ES UNA TRANSCRIPCIÓN AUTOMÁTICA"));
});

test("el núcleo SÍ conserva las acciones de plata ambiguas entre negocio y persona", () => {
  // REGISTRAR_GASTO_FIJO, REGISTRAR_DEUDA, etc. no están en la lista de
  // exclusión a propósito: no hay forma segura de saber a qué ámbito
  // pertenecen sin la lógica de desambiguación completa.
  assert.ok(PROMPT_NUCLEO.includes("\nREGISTRAR_GASTO_FIJO\n"));
  assert.ok(PROMPT_NUCLEO.includes("\nREGISTRAR_DEUDA\n"));
  assert.ok(PROMPT_NUCLEO.includes("son de los dos y por eso"));
});

test("construirNucleo sobre un prompt propio no depende del real", () => {
  // Prueba el mecanismo con un texto chico, para no depender de que
  // sistema.ts nunca cambie de forma.
  const bloques = ["A", "B título negocio", "C", "D", "E"];
  const nucleo = construirNucleo(bloques.join("\n\n"));
  // Con los índices reales (9..35), un prompt de 5 bloques no excluye nada.
  assert.equal(nucleo, bloques.join("\n\n"));
});

test("necesitaModuloErpCrm: mensaje con vocabulario de negocio, true", () => {
  assert.equal(necesitaModuloErpCrm("vendí 3 remeras a Juan"), true);
  assert.equal(necesitaModuloErpCrm("¿cuánto stock me queda de cemento?"), true);
  assert.equal(necesitaModuloErpCrm("cargá un cliente nuevo"), true);
});

test("necesitaModuloErpCrm: mensaje claramente personal, false", () => {
  assert.equal(necesitaModuloErpCrm("pagué el mínimo de la Visa"), false);
  assert.equal(necesitaModuloErpCrm("¿cuánto me queda de reserva este mes?"), false);
});

test("necesitaModuloErpCrm: un seguimiento corto hereda el contexto de negocio del historial", () => {
  const historial = [{ texto: "vendí 3 bolsas de balanceado a Pedro" }];
  assert.equal(necesitaModuloErpCrm("¿y a 150 mil?", historial), true);
});

test("necesitaModuloErpCrm: el historial viejo (más de 4 turnos) no arrastra para siempre", () => {
  const historial = [
    { texto: "vendí 3 bolsas de balanceado a Pedro" },
    { texto: "gracias" },
    { texto: "dale" },
    { texto: "ok" },
    { texto: "perfecto" },
  ];
  assert.equal(necesitaModuloErpCrm("pagué la cuota del préstamo", historial), false);
});

test("promptSistemaDeCuenta: false confirmado → núcleo", () => {
  assert.equal(promptSistemaDeCuenta(false), PROMPT_NUCLEO);
});

test("promptSistemaDeCuenta: true, o null (sin confirmar), → el prompt completo", () => {
  // Ante la duda, se manda todo: mismo criterio que `puedeBajarDocumentos`
  // en procesar-mensaje.ts.
  assert.equal(promptSistemaDeCuenta(true), PROMPT_SISTEMA);
  assert.equal(promptSistemaDeCuenta(null), PROMPT_SISTEMA);
});

test("gatewayNucleoPorModulo: apagada por defecto", () => {
  const anterior = process.env.EOS_GATEWAY_NUCLEO_SIN_ERP;
  delete process.env.EOS_GATEWAY_NUCLEO_SIN_ERP;
  try {
    assert.equal(gatewayNucleoPorModulo(), false);
  } finally {
    if (anterior === undefined) delete process.env.EOS_GATEWAY_NUCLEO_SIN_ERP;
    else process.env.EOS_GATEWAY_NUCLEO_SIN_ERP = anterior;
  }
});

test("gatewayNucleoPorModulo: se prende solo con el valor exacto '1'", () => {
  const anterior = process.env.EOS_GATEWAY_NUCLEO_SIN_ERP;
  try {
    process.env.EOS_GATEWAY_NUCLEO_SIN_ERP = "true";
    assert.equal(gatewayNucleoPorModulo(), false);
    process.env.EOS_GATEWAY_NUCLEO_SIN_ERP = "1";
    assert.equal(gatewayNucleoPorModulo(), true);
  } finally {
    if (anterior === undefined) delete process.env.EOS_GATEWAY_NUCLEO_SIN_ERP;
    else process.env.EOS_GATEWAY_NUCLEO_SIN_ERP = anterior;
  }
});
