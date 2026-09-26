import assert from "node:assert/strict";
import { test } from "node:test";

import { calcularArmado, type ModuloCatalogo } from "./armado.ts";
import {
  PRESETS,
  esCodigoPreset,
  presetsDisponibles,
  presetsVisibles,
  seleccionIgualAPreset,
} from "./presets.ts";
import { MODULOS } from "./catalogo.ts";

function modulo(codigo: string, precio: number, extra: Partial<ModuloCatalogo> = {}): ModuloCatalogo {
  return {
    codigo,
    nombre: codigo,
    descripcion: null,
    precio_mensual_pyg: precio,
    precio_anual_pyg: precio * 10,
    grupo: null,
    limite_mensajes: null,
    requiere: [],
    orden: 100,
    ...extra,
  };
}

// La vitrina vigente (v201): de conversaciones solo queda EOS Conversacional, a Gs. 80.000.
const CATALOGO: ModuloCatalogo[] = [
  modulo("conversaciones_full", 80_000, { grupo: "conversaciones", limite_mensajes: -1, orden: 12 }),
  modulo("dashboard", 20_000, { orden: 20 }),
  modulo("briefing", 25_000, { orden: 30 }),
  modulo("facturacion", 40_000, { orden: 75 }),
  modulo("erp", 120_000, { orden: 80 }),
  modulo("crm", 90_000, { orden: 90 }),
];

test("los tres presets salen con el mismo precio que el armador", () => {
  const presets = presetsDisponibles(CATALOGO);
  assert.deepEqual(
    presets.map((p) => p.codigo),
    ["empezar", "negocio", "negocio_completo"],
  );
  for (const p of presets) {
    assert.equal(p.total, calcularArmado([...p.modulos], CATALOGO).total);
  }
  assert.equal(presets[0].total, 80_000);
  assert.equal(presets[1].total, 220_000);
});

test("el anual se calcula con la misma regla del armador", () => {
  const [empezar] = presetsDisponibles(CATALOGO, "anual");
  assert.equal(empezar.total, 800_000);
});

test("un preset al que le falta un módulo en el catálogo no se ofrece", () => {
  const sinErp = CATALOGO.filter((m) => m.codigo !== "erp");
  const codigos = presetsDisponibles(sinErp).map((p) => p.codigo);
  assert.deepEqual(codigos, ["empezar"]);
});

test("sin catálogo no hay presets", () => {
  assert.deepEqual(presetsDisponibles([]), []);
});

test("todos los códigos de los presets existen en el juego de llaves", () => {
  const llaves = new Set([...Object.keys(MODULOS), "conversaciones_full"]);
  for (const p of PRESETS) {
    for (const c of p.modulos) assert.ok(llaves.has(c), `${p.codigo}: ${c} no existe`);
  }
});

test("reconoce si la selección sigue siendo la del preset o se editó", () => {
  assert.equal(seleccionIgualAPreset(["erp", "dashboard", "conversaciones_full"], "negocio", CATALOGO), true);
  assert.equal(seleccionIgualAPreset(["conversaciones_full", "dashboard"], "negocio", CATALOGO), false);
  assert.equal(
    seleccionIgualAPreset(["conversaciones_full", "dashboard", "erp", "crm"], "negocio", CATALOGO),
    false,
  );
});

test("solo acepta códigos de preset conocidos", () => {
  assert.equal(esCodigoPreset("negocio"), true);
  assert.equal(esCodigoPreset("enterprise"), false);
  assert.equal(esCodigoPreset(42), false);
});

test("la bandera arranca apagada y solo se prende con 1", () => {
  assert.equal(presetsVisibles(undefined), false);
  assert.equal(presetsVisibles(""), false);
  assert.equal(presetsVisibles("true"), false);
  assert.equal(presetsVisibles("1"), true);
});
