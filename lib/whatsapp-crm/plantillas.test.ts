import assert from "node:assert/strict";
import test from "node:test";

import { cantidadDeVariables, crearPlantilla, sincronizarPlantilla, validarPlantilla } from "./plantillas.ts";
import { baseFalsa } from "./base-falsa.ts";
import type { Fetcher } from "./meta.ts";

const TOKEN = "EAAG" + "x".repeat(40);
const buena = { nombre: "seguimiento_propuesta", cuerpo: "Hola {{1}}, ¿pudiste ver la propuesta de {{2}}? Quedo atento.", categoria: "utilidad", ejemplos: ["Carlos", "Gs. 3.500.000"] };

// -------------------------------------------------------------- validación

test("las variables se cuentan y tienen que estar numeradas en orden", () => {
  assert.equal(cantidadDeVariables("Hola mundo"), 0);
  assert.equal(cantidadDeVariables("Hola {{1}} y {{2}}"), 2);
  assert.equal(cantidadDeVariables("{{1}} {{1}} {{2}}"), 2);
  assert.equal(cantidadDeVariables("Hola {{2}}"), -1);
  assert.equal(cantidadDeVariables("Hola {{1}} y {{3}}"), -1);
});

test("una plantilla correcta pasa", () => {
  const r = validarPlantilla(buena);
  assert.ok(r.ok);
  assert.equal(r.datos.idioma, "es");
  assert.deepEqual(r.datos.ejemplos, ["Carlos", "Gs. 3.500.000"]);
});

test("el nombre tiene que ser el que exige Meta", () => {
  for (const nombre of ["Seguimiento", "con espacio", "tildé", "", "a".repeat(61)]) {
    const r = validarPlantilla({ ...buena, nombre });
    assert.ok(!r.ok, nombre);
    assert.equal(r.campo, "nombre");
  }
});

test("Meta pide un ejemplo por variable, ninguno vacío", () => {
  for (const ejemplos of [[], ["Carlos"], ["Carlos", ""], ["Carlos", "x", "y"]]) {
    const r = validarPlantilla({ ...buena, ejemplos });
    assert.ok(!r.ok, JSON.stringify(ejemplos));
    assert.equal(r.campo, "ejemplos");
  }
});

test("no puede empezar ni terminar con una variable (Meta la rechaza)", () => {
  for (const cuerpo of ["{{1}}, ¿viste la propuesta?", "Hola, tu propuesta es {{1}}"]) {
    const r = validarPlantilla({ nombre: "x", cuerpo, categoria: "utilidad", ejemplos: ["a"] });
    assert.ok(!r.ok, cuerpo);
    assert.match(r.error, /empieza o termina con una variable/);
  }
});

test("una categoría inventada o un mensaje vacío o larguísimo se rechazan", () => {
  assert.ok(!validarPlantilla({ ...buena, categoria: "spam" }).ok);
  assert.ok(!validarPlantilla({ ...buena, cuerpo: "" }).ok);
  assert.ok(!validarPlantilla({ ...buena, cuerpo: "x".repeat(1025) }).ok);
});

// ------------------------------------------------------------------- crear

const datos = () => {
  const r = validarPlantilla(buena);
  if (!r.ok) throw new Error("datos de prueba inválidos");
  return r.datos;
};

const meta = (status: number, cuerpo: unknown) => {
  let llamadas = 0;
  const fetcher = (async () => {
    llamadas++;
    return new Response(JSON.stringify(cuerpo), { status });
  }) as unknown as Fetcher;
  return { fetcher, llamadas: () => llamadas };
};

const canalConWaba = { data: { id: "canal-1", waba_id: "987654321", estado: "activo" }, error: null };

test("crear: se manda a Meta y RECIÉN con su respuesta se guarda la fila", async () => {
  const { admin, pedidos } = baseFalsa({
    "eos_wa_canales.select": canalConWaba,
    "rpc:eos_wa_leer_secreto_v185": { data: TOKEN, error: null },
    "eos_wa_plantillas.select": { data: null, error: null },
    "eos_wa_plantillas.insert": { data: { id: "p-1", estado: "en_revision" }, error: null },
  });
  const m = meta(200, { id: "tpl-meta-1", status: "PENDING" });

  const r = await crearPlantilla(admin, "u-1", "canal-1", datos(), m.fetcher);

  assert.ok(r.ok);
  assert.deepEqual(r.plantilla, { id: "p-1", estado: "en_revision" });
  assert.equal(m.llamadas(), 1);
  const fila = pedidos.find((p) => p.clave === "eos_wa_plantillas.insert")!.payload as Record<string, unknown>;
  assert.equal(fila.usuario_id, "u-1");
  assert.equal(fila.cantidad_variables, 2);
  assert.equal(fila.meta_template_id, "tpl-meta-1");
  assert.equal(fila.estado, "en_revision");
});

test("crear: si Meta la rechaza NO se guarda nada", async () => {
  const { admin, pedidos } = baseFalsa({
    "eos_wa_canales.select": canalConWaba,
    "rpc:eos_wa_leer_secreto_v185": { data: TOKEN, error: null },
    "eos_wa_plantillas.select": { data: null, error: null },
  });
  const r = await crearPlantilla(admin, "u-1", "canal-1", datos(), meta(400, { error: { code: 132007 } }).fetcher);

  assert.ok(!r.ok);
  assert.match(r.error, /políticas/);
  assert.ok(!pedidos.some((p) => p.clave === "eos_wa_plantillas.insert"));
});

test("crear: un nombre repetido se rechaza ANTES de molestar a Meta", async () => {
  const { admin } = baseFalsa({
    "eos_wa_canales.select": canalConWaba,
    "rpc:eos_wa_leer_secreto_v185": { data: TOKEN, error: null },
    "eos_wa_plantillas.select": { data: { id: "ya-esta" }, error: null },
  });
  const m = meta(200, { id: "x" });
  const r = await crearPlantilla(admin, "u-1", "canal-1", datos(), m.fetcher);

  assert.ok(!r.ok);
  assert.equal(r.estado, 409);
  assert.equal(m.llamadas(), 0);
});

test("crear: sin el ID de la cuenta de WhatsApp Business se explica qué falta", async () => {
  const { admin } = baseFalsa({ "eos_wa_canales.select": { data: { id: "canal-1", waba_id: null, estado: "activo" }, error: null } });
  const r = await crearPlantilla(admin, "u-1", "canal-1", datos(), meta(200, {}).fetcher);
  assert.ok(!r.ok);
  assert.match(r.error, /ID de la cuenta de WhatsApp Business/);
});

test("crear: un canal ajeno responde 404", async () => {
  const { admin } = baseFalsa({ "eos_wa_canales.select": { data: null, error: null } });
  const r = await crearPlantilla(admin, "u-1", "ajeno", datos(), meta(200, {}).fetcher);
  assert.ok(!r.ok && r.estado === 404);
});

test("crear: si Meta la aceptó pero no se pudo guardar, se avisa que use Sincronizar", async () => {
  const { admin } = baseFalsa({
    "eos_wa_canales.select": canalConWaba,
    "rpc:eos_wa_leer_secreto_v185": { data: TOKEN, error: null },
    "eos_wa_plantillas.select": { data: null, error: null },
    "eos_wa_plantillas.insert": { data: null, error: { message: "x" } },
  });
  const r = await crearPlantilla(admin, "u-1", "canal-1", datos(), meta(200, { id: "t", status: "PENDING" }).fetcher);
  assert.ok(!r.ok);
  assert.match(r.error, /Sincronizar/);
});

// ---------------------------------------------------------------- sincronizar

test("sincronizar: trae el estado de Meta y lo guarda", async () => {
  const { admin, pedidos } = baseFalsa({
    "eos_wa_plantillas.select": { data: { id: "p-1", nombre: "seguimiento_propuesta", canal_id: "canal-1" }, error: null },
    "eos_wa_canales.select": canalConWaba,
    "rpc:eos_wa_leer_secreto_v185": { data: TOKEN, error: null },
    "eos_wa_plantillas.update": { data: null, error: null },
  });

  const r = await sincronizarPlantilla(admin, "u-1", "p-1", meta(200, { data: [{ id: "tpl-9", name: "seguimiento_propuesta", status: "APPROVED" }] }).fetcher);

  assert.deepEqual(r, { ok: true, plantilla: { id: "p-1", estado: "aprobada" } });
  const c = pedidos.find((p) => p.clave === "eos_wa_plantillas.update")!;
  assert.equal((c.payload as { estado: string }).estado, "aprobada");
  assert.ok(c.filtros.some((f) => f.metodo === "eq" && f.args[0] === "usuario_id" && f.args[1] === "u-1"));
});

test("sincronizar: un rechazo guarda el motivo", async () => {
  const { admin, pedidos } = baseFalsa({
    "eos_wa_plantillas.select": { data: { id: "p-1", nombre: "x", canal_id: "canal-1" }, error: null },
    "eos_wa_canales.select": canalConWaba,
    "rpc:eos_wa_leer_secreto_v185": { data: TOKEN, error: null },
  });
  await sincronizarPlantilla(admin, "u-1", "p-1", meta(200, { data: [{ id: "1", name: "x", status: "REJECTED", rejected_reason: "INVALID_FORMAT" }] }).fetcher);

  const c = pedidos.find((p) => p.clave === "eos_wa_plantillas.update")!.payload as { estado: string; motivo_rechazo: string };
  assert.equal(c.estado, "rechazada");
  assert.equal(c.motivo_rechazo, "INVALID_FORMAT");
});

test("sincronizar: si Meta ya no la tiene, se dice", async () => {
  const { admin } = baseFalsa({
    "eos_wa_plantillas.select": { data: { id: "p-1", nombre: "x", canal_id: "canal-1" }, error: null },
    "eos_wa_canales.select": canalConWaba,
    "rpc:eos_wa_leer_secreto_v185": { data: TOKEN, error: null },
  });
  const r = await sincronizarPlantilla(admin, "u-1", "p-1", meta(200, { data: [] }).fetcher);
  assert.ok(!r.ok && r.estado === 404);
});

test("sincronizar: una plantilla ajena responde 404", async () => {
  const { admin } = baseFalsa({ "eos_wa_plantillas.select": { data: null, error: null } });
  const r = await sincronizarPlantilla(admin, "u-1", "ajena", meta(200, {}).fetcher);
  assert.ok(!r.ok && r.estado === 404);
});
