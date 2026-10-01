import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { ACCIONES_DEL_GATEWAY, ACCIONES_PERMITIDAS } from "./respuesta.ts";
import { PROMPT_SISTEMA } from "./sistema.ts";

test("el prompt explica cuándo buscar, cuándo no, y que la consulta va sin datos privados", () => {
  assert.match(PROMPT_SISTEMA, /BÚSQUEDA EN LA WEB\n\nBUSCAR_WEB\n  datos: \{ consulta, pais\?, profundidad\?, periodo\? \}/);
  assert.match(PROMPT_SISTEMA, /NUNCA nombres de personas, clientes o\n  proveedores, montos de la persona/);
  assert.match(PROMPT_SISTEMA, /lo que ya buscaste en esta conversación/);
  assert.match(PROMPT_SISTEMA, /no lo guardes\n  con GUARDAR_MEMORIA/);
  assert.match(PROMPT_SISTEMA, /UNA sola BUSCAR_WEB por mensaje/);
});

test("BUSCAR_WEB es del gateway: no está en la lista del worker", () => {
  assert.ok(ACCIONES_DEL_GATEWAY.has("BUSCAR_WEB"));
  assert.ok(!ACCIONES_PERMITIDAS.has("BUSCAR_WEB"));
});

test("n8n (respaldo, no busca) no promete una búsqueda que no hace", () => {
  const flujo = JSON.parse(readFileSync(new URL("../../n8n/workflows/eos-conversational-gateway-rc1.json", import.meta.url), "utf8"));
  const n05 = flujo.nodes.find((n: { name: string }) => n.name === "05 GW Preparar Respuesta");
  assert.match(n05.parameters.jsCode, /const pidioBuscarWeb =/);
  assert.match(n05.parameters.jsCode, /No pude buscar información actual por este camino/);
  assert.doesNotThrow(() => new Function(n05.parameters.jsCode));
});
