import assert from "node:assert/strict";
import test from "node:test";

import { combinarConfig, escalaDe, validarConfig } from "./etapas-config.ts";

const claves = (c: ReturnType<typeof combinarConfig>) => c.map((e) => e.clave);

test("sin configuración, son las seis de siempre, en su orden y sin personalizar", () => {
  const c = combinarConfig([]);
  assert.deepEqual(claves(c), ["nueva", "contactado", "propuesta", "negociacion", "ganada", "perdida"]);
  assert.ok(c.every((e) => !e.personalizada && e.visible));
  assert.equal(c.find((e) => e.clave === "propuesta")!.probabilidad, 0.5);
});

test("una etapa se puede renombrar y darle otra probabilidad", () => {
  const c = combinarConfig([{ etapa: "propuesta", etiqueta: "Presupuesto enviado", orden: 2, visible: true, probabilidad_defecto: 35 }]);
  const p = c.find((e) => e.clave === "propuesta")!;
  assert.equal(p.etiqueta, "Presupuesto enviado");
  assert.equal(p.probabilidad, 0.35);
  assert.equal(p.personalizada, true);
});

test("las intermedias se reordenan y se pueden ocultar", () => {
  const c = combinarConfig([
    { etapa: "nueva", etiqueta: "Nueva", orden: 5, visible: true, probabilidad_defecto: null },
    { etapa: "contactado", etiqueta: "Contactado", orden: 1, visible: false, probabilidad_defecto: null },
  ]);
  assert.equal(c.find((e) => e.clave === "contactado")!.visible, false);
  assert.ok(claves(c).indexOf("nueva") > claves(c).indexOf("propuesta"));
});

test("ganada y perdida quedan siempre al final, visibles y con 100 y 0, digan lo que digan las filas", () => {
  const c = combinarConfig([
    { etapa: "ganada", etiqueta: "Cerrada", orden: 0, visible: false, probabilidad_defecto: 40 },
    { etapa: "perdida", etiqueta: "Perdida", orden: 0, visible: false, probabilidad_defecto: 90 },
  ]);
  assert.deepEqual(claves(c).slice(-2), ["ganada", "perdida"]);
  const g = c.find((e) => e.clave === "ganada")!;
  const p = c.find((e) => e.clave === "perdida")!;
  assert.equal(g.visible, true);
  assert.equal(g.probabilidad, 1);
  assert.equal(p.probabilidad, 0);
  // Pero SÍ se les puede cambiar el nombre.
  assert.equal(g.etiqueta, "Cerrada");
});

test("una fila de una etapa inventada se ignora", () => {
  const c = combinarConfig([{ etapa: "inventada", etiqueta: "X", orden: 0, visible: true, probabilidad_defecto: 10 }]);
  assert.equal(c.length, 6);
});

test("la escala de probabilidades sale de la configuración combinada", () => {
  const e = escalaDe(combinarConfig([{ etapa: "propuesta", etiqueta: "P", orden: 2, visible: true, probabilidad_defecto: 20 }]));
  assert.equal(e.propuesta, 0.2);
  assert.equal(e.ganada, 1);
  assert.equal(e.nueva, 0.1);
});

// ------------------------------------------------------------------ validación

const etapa = (extra: Record<string, unknown> = {}) => ({ etapa: "propuesta", etiqueta: "Propuesta", orden: 2, visible: true, probabilidad: 50, ...extra });

test("una configuración correcta pasa y se normaliza", () => {
  const r = validarConfig({ etapas: [etapa(), etapa({ etapa: "ganada", visible: false, probabilidad: 10, etiqueta: "Ganada" })] });
  assert.ok(r.ok);
  const ganada = r.filas.find((f) => f.etapa === "ganada")!;
  // Las finales no se pueden ocultar ni cambiar de probabilidad.
  assert.equal(ganada.visible, true);
  assert.equal(ganada.probabilidad_defecto, null);
});

test("una etapa inventada, repetida o sin nombre se rechaza", () => {
  assert.ok(!validarConfig({ etapas: [etapa({ etapa: "inventada" })] }).ok);
  assert.ok(!validarConfig({ etapas: [etapa(), etapa()] }).ok);
  assert.ok(!validarConfig({ etapas: [etapa({ etiqueta: "   " })] }).ok);
  assert.ok(!validarConfig({ etapas: [etapa({ etiqueta: "x".repeat(41) })] }).ok);
});

test("una probabilidad fuera de 0 a 100 o con decimales se rechaza; vacía es 'la de fábrica'", () => {
  for (const probabilidad of [101, -1, 50.5, "abc"]) assert.ok(!validarConfig({ etapas: [etapa({ probabilidad })] }).ok, String(probabilidad));
  const r = validarConfig({ etapas: [etapa({ probabilidad: "" })] });
  assert.ok(r.ok && r.filas[0].probabilidad_defecto === null);
});

test("dos etapas visibles con el mismo nombre se rechazan; si una está oculta, no", () => {
  const dos = [etapa({ etapa: "nueva", etiqueta: "Consulta" }), etapa({ etapa: "contactado", etiqueta: "consulta" })];
  assert.ok(!validarConfig({ etapas: dos }).ok);
  const oculta = [etapa({ etapa: "nueva", etiqueta: "Consulta" }), etapa({ etapa: "contactado", etiqueta: "consulta", visible: false })];
  assert.ok(validarConfig({ etapas: oculta }).ok);
});

test("no se pueden ocultar TODAS las intermedias", () => {
  const todas = ["nueva", "contactado", "propuesta", "negociacion"].map((e) => etapa({ etapa: e, etiqueta: e, visible: false }));
  const r = validarConfig({ etapas: todas });
  assert.ok(!r.ok);
  assert.match(r.error, /al menos una etapa visible/);
});

test("un nombre con caracteres de control se rechaza", () => {
  assert.ok(!validarConfig({ etapas: [etapa({ etiqueta: "Hola" + String.fromCharCode(7) })] }).ok);
});

test("lo que no es una lista se rechaza sin romper", () => {
  for (const x of [null, undefined, {}, { etapas: "x" }, { etapas: [] }, { etapas: [null] }]) assert.ok(!validarConfig(x).ok);
});
