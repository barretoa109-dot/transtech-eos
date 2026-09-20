import assert from "node:assert/strict";
import test from "node:test";

import { calcularAprendizajes, registrarAprendizajeComercial, type CierreCRM } from "./aprendizaje.ts";
import { baseFalsa } from "../whatsapp-crm/base-falsa.ts";

const dia = (n: number) => new Date(Date.UTC(2026, 8, 1) + n * 86_400_000).toISOString();

const ganada = (dias: number, extra: Partial<CierreCRM> = {}): CierreCRM => ({
  etapa: "ganada", monto: 1000, creado_en: dia(0), cerrada_en: dia(dias), motivo_perdida: null, origen: "manual", ...extra,
});
const perdida = (motivo: string | null, extra: Partial<CierreCRM> = {}): CierreCRM => ({
  etapa: "perdida", monto: 1000, creado_en: dia(0), cerrada_en: dia(10), motivo_perdida: motivo, origen: "manual", ...extra,
});
const por = (a: ReturnType<typeof calcularAprendizajes>, clave: string) => a.find((x) => x.clave === clave);

// ---------------------------------------------------------- lo que NO se afirma

test("con menos de tres cierres no se afirma nada", () => {
  assert.deepEqual(calcularAprendizajes([]), []);
  assert.deepEqual(calcularAprendizajes([ganada(5)]), []);
  assert.deepEqual(calcularAprendizajes([ganada(5), perdida("precio")]), []);
});

// ------------------------------------------------------------------ tasa de cierre

test("la tasa de cierre dice cuántos casos la sostienen", () => {
  const a = calcularAprendizajes([ganada(5), ganada(7), ganada(6), perdida("precio")]);
  const t = por(a, "crm:cierres:tasa")!;

  assert.match(t.patron, /De 4 oportunidades cerradas.*3 se ganaron \(75 %\)/);
  assert.equal(t.evidence_count, 4);
  assert.equal(t.positive_count, 3);
  assert.equal(t.negative_count, 1);
  assert.equal(t.tendencia, "positiva");
});

test("una tasa baja es tendencia negativa; una intermedia, mixta", () => {
  assert.equal(por(calcularAprendizajes([ganada(5), perdida("a"), perdida("b"), perdida("c")]), "crm:cierres:tasa")!.tendencia, "negativa");
  assert.equal(por(calcularAprendizajes([ganada(5), ganada(5), perdida("a"), perdida("b")]), "crm:cierres:tasa")!.tendencia, "mixta");
});

test("la confianza sube con los casos y NUNCA llega a 1", () => {
  const chico = por(calcularAprendizajes([ganada(5), ganada(5), ganada(5)]), "crm:cierres:tasa")!.confianza;
  const grande = por(calcularAprendizajes(Array.from({ length: 200 }, () => ganada(5))), "crm:cierres:tasa")!.confianza;
  assert.ok(chico < grande);
  assert.ok(grande <= 0.9);
});

// ------------------------------------------------------------------------- ciclo

test("el ciclo es el promedio de días de las ganadas, con al menos dos", () => {
  const a = calcularAprendizajes([ganada(4), ganada(8), perdida(null)]);
  assert.match(por(a, "crm:cierres:ciclo")!.patron, /tardaron 6 días en cerrarse \(2 casos\)/);

  // Con una sola ganada no hay ciclo que afirmar.
  assert.equal(por(calcularAprendizajes([ganada(4), perdida(null), perdida(null)]), "crm:cierres:ciclo"), undefined);
});

test("las fechas rotas (cierre antes que la creación, o ilegibles) no cuentan para el ciclo", () => {
  const rota = ganada(0, { cerrada_en: dia(-5) });
  const ilegible = ganada(0, { cerrada_en: "no es una fecha" });
  assert.equal(por(calcularAprendizajes([rota, ilegible, ganada(3)]), "crm:cierres:ciclo"), undefined);
});

// ---------------------------------------------------------------- motivo de pérdida

test("un motivo de pérdida que se REPITE se señala; uno suelto, no", () => {
  const repetido = calcularAprendizajes([ganada(5), perdida("Precio alto"), perdida("precio  alto"), perdida("no contestó")]);
  const m = por(repetido, "crm:cierres:motivo")!;
  assert.match(m.patron, /«precio alto» \(2 de 3\)/);
  assert.equal(m.tendencia, "negativa");

  const sueltos = calcularAprendizajes([ganada(5), perdida("precio"), perdida("plazo"), perdida("no contestó")]);
  assert.equal(por(sueltos, "crm:cierres:motivo"), undefined);
});

test("las pérdidas sin motivo no cuentan para el motivo", () => {
  const a = calcularAprendizajes([ganada(5), perdida(null), perdida(""), perdida("   ")]);
  assert.equal(por(a, "crm:cierres:motivo"), undefined);
});

// ------------------------------------------------------------------------- origen

test("si WhatsApp convierte claramente mejor, se dice", () => {
  const a = calcularAprendizajes([
    ganada(3, { origen: "whatsapp" }), ganada(3, { origen: "whatsapp" }),
    ganada(3, { origen: "manual" }), perdida("x", { origen: "manual" }), perdida("y", { origen: "manual" }),
  ]);
  const o = por(a, "crm:cierres:origen")!;
  assert.match(o.patron, /WhatsApp se ganaron el 100 % de las veces; los demás, el 33 %/);
  assert.match(o.recomendacion, /contestar rápido/);
  assert.equal(o.tendencia, "positiva");
});

test("si WhatsApp convierte peor, la recomendación cambia", () => {
  const a = calcularAprendizajes([
    perdida("x", { origen: "whatsapp" }), perdida("y", { origen: "whatsapp" }),
    ganada(3, { origen: "manual" }), ganada(3, { origen: "manual" }),
  ]);
  const o = por(a, "crm:cierres:origen")!;
  assert.match(o.recomendacion, /calificarlos/);
  assert.equal(o.tendencia, "negativa");
});

test("una diferencia chica, o pocos casos de un lado, no se afirma: es ruido", () => {
  const parecido = calcularAprendizajes([
    ganada(3, { origen: "whatsapp" }), perdida("x", { origen: "whatsapp" }),
    ganada(3, { origen: "manual" }), perdida("x", { origen: "manual" }),
  ]);
  assert.equal(por(parecido, "crm:cierres:origen"), undefined);

  const pocos = calcularAprendizajes([ganada(3, { origen: "whatsapp" }), ganada(3, { origen: "manual" }), ganada(3, { origen: "manual" }), perdida("x", { origen: "manual" })]);
  assert.equal(por(pocos, "crm:cierres:origen"), undefined);
});

// --------------------------------------------------------------------- guardarlos

const filas = (cierres: CierreCRM[]) =>
  cierres.map((c) => ({ etapa: c.etapa, monto: c.monto, creado_en: c.creado_en, cerrada_en: c.cerrada_en, motivo_perdida: c.motivo_perdida, contacto: { origen: c.origen } }));

test("cada cierre recalcula y GUARDA los aprendizajes, con el dueño como filtro", async () => {
  const { admin, pedidos } = baseFalsa({
    "eos_crm_oportunidades.select": { data: filas([ganada(4), ganada(8), perdida("precio"), perdida("precio")]), error: null },
    "eos_learnings.select": { data: [], error: null },
    "eos_learnings.insert": { data: null, error: null },
  });

  const r = await registrarAprendizajeComercial(admin, "u-1", new Date("2026-09-19T12:00:00Z"));

  assert.ok(r.guardados >= 3);
  const inserts = pedidos.filter((p) => p.clave === "eos_learnings.insert").map((p) => p.payload as Record<string, unknown>);
  assert.ok(inserts.every((i) => i.usuario_id === "u-1" && i.estado === "activo" && i.categoria === "general"));
  // La categoría `ejecucion` NO entra al prompt: los aprendizajes comerciales tienen que entrar.
  assert.ok(inserts.every((i) => i.categoria !== "ejecucion"));
  assert.ok(inserts.some((i) => i.clave === "crm:cierres:tasa"));

  for (const p of pedidos.filter((x) => /^eos_(crm_oportunidades|learnings)\.select$/.test(x.clave))) {
    assert.ok(p.filtros.some((f) => f.metodo === "eq" && f.args[0] === "usuario_id" && f.args[1] === "u-1"), p.clave);
  }
});

test("un aprendizaje que ya existía se ACTUALIZA, no se duplica", async () => {
  const { admin, pedidos } = baseFalsa({
    "eos_crm_oportunidades.select": { data: filas([ganada(4), ganada(8), perdida("precio")]), error: null },
    "eos_learnings.select": { data: [{ id: "l-1", clave: "crm:cierres:tasa", estado: "activo" }], error: null },
  });
  await registrarAprendizajeComercial(admin, "u-1");

  assert.ok(pedidos.some((p) => p.clave === "eos_learnings.update" && p.filtros.some((f) => f.args[1] === "l-1")));
  assert.ok(!pedidos.some((p) => p.clave === "eos_learnings.insert" && (p.payload as { clave: string }).clave === "crm:cierres:tasa"));
});

test("lo que la persona DESCARTÓ no se vuelve a activar", async () => {
  const { admin, pedidos } = baseFalsa({
    "eos_crm_oportunidades.select": { data: filas([ganada(4), ganada(8), perdida("precio")]), error: null },
    "eos_learnings.select": { data: [{ id: "l-1", clave: "crm:cierres:tasa", estado: "descartado" }], error: null },
  });
  await registrarAprendizajeComercial(admin, "u-1");

  assert.ok(!pedidos.some((p) => p.clave === "eos_learnings.update" && p.filtros.some((f) => f.args[1] === "l-1")));
});

test("un patrón que ya no se cumple se retira, con el motivo", async () => {
  const { admin, pedidos } = baseFalsa({
    // Hoy no hay ninguna pérdida con motivo repetido: el aprendizaje de motivo ya no vale.
    "eos_crm_oportunidades.select": { data: filas([ganada(4), ganada(8), perdida(null)]), error: null },
    "eos_learnings.select": { data: [{ id: "l-9", clave: "crm:cierres:motivo", estado: "activo" }], error: null },
  });
  const r = await registrarAprendizajeComercial(admin, "u-1");

  assert.equal(r.retirados, 1);
  const retiro = pedidos.find((p) => p.clave === "eos_learnings.update" && p.filtros.some((f) => f.args[1] === "l-9"))!;
  assert.equal((retiro.payload as { estado: string }).estado, "descartado");
  assert.match((retiro.payload as { descartado_motivo: string }).descartado_motivo, /ya no se cumple/);
});

test("con pocos cierres no se guarda nada (y no se rompe)", async () => {
  const { admin, pedidos } = baseFalsa({
    "eos_crm_oportunidades.select": { data: filas([ganada(4)]), error: null },
    "eos_learnings.select": { data: [], error: null },
  });
  const r = await registrarAprendizajeComercial(admin, "u-1");

  assert.deepEqual(r, { guardados: 0, retirados: 0 });
  assert.ok(!pedidos.some((p) => p.clave === "eos_learnings.insert"));
});

test("si no se pueden leer los cierres, no se toca nada", async () => {
  const { admin, pedidos } = baseFalsa({ "eos_crm_oportunidades.select": { data: null, error: { code: "42703", message: "x" } } });
  const r = await registrarAprendizajeComercial(admin, "u-1");

  assert.deepEqual(r, { guardados: 0, retirados: 0 });
  assert.ok(!pedidos.some((p) => p.clave.startsWith("eos_learnings")));
});
