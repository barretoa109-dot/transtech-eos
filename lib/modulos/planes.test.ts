import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { MESES_DEL_ANUAL } from "./armado.ts";
import { MODULOS } from "./catalogo.ts";
import { MENSAJES_GRATIS_POR_DIA, PLANES, esCodigoPlan, planPorCodigo, precioDelPlan } from "./planes.ts";

const leer = (archivo: string) =>
  fs.readFileSync(path.join(process.cwd(), "supabase", "migrations", archivo), "utf8");

const MIGRACION = leer("20261120120000_eos_planes_cerrados_v263.sql");
const INICIAL = leer("20261121150000_eos_plan_inicial_v266.sql");

/**
 * Las filas de `eos_paquetes` como quedan después de la v263 y la v266,
 * leídas del texto de las migraciones.
 */
function semillas() {
  const filas = new Map<string, { modulos: string[]; mensual: number; anual: number }>();
  const patron = /\('([a-z_]+)',\s*'[^']*',\s*'[^']*',\s*array\[([^\]]+)\],\s*(\d+),\s*(\d+),\s*\d+\)/g;

  for (const sql of [MIGRACION, INICIAL]) {
    for (const m of sql.matchAll(patron)) {
      filas.set(m[1], {
        modulos: [...m[2].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]),
        mensual: Number(m[3]),
        anual: Number(m[4]),
      });
    }
  }

  // La v266 le suma `equipo` a Emprendedor y Full.
  const suma = INICIAL.match(/set modulos = modulos \|\| array\['equipo'\]\s+where codigo in \(([^)]*)\)/);
  assert.ok(suma, "la v266 tiene que sumarle equipo a los planes con equipo");
  for (const m of suma[1].matchAll(/'([a-z_]+)'/g)) filas.get(m[1])?.modulos.push("equipo");

  return filas;
}

test("los precios y módulos de la pantalla son los mismos que cobra la base", () => {
  const filas = semillas();
  assert.equal(filas.size, PLANES.length);

  for (const plan of PLANES) {
    const fila = filas.get(plan.codigo);
    assert.ok(fila, `falta ${plan.codigo} en la migración`);
    assert.equal(fila.mensual, plan.precio_mensual_pyg, plan.codigo);
    assert.equal(fila.anual, plan.precio_anual_pyg, plan.codigo);
    assert.deepEqual([...fila.modulos].sort(), [...plan.modulos].sort(), plan.codigo);
  }
});

test("los precios que pidió el dueño", () => {
  assert.equal(planPorCodigo("finanzas_personales")?.precio_mensual_pyg, 50_000);
  assert.equal(planPorCodigo("inicial")?.precio_mensual_pyg, 70_000);
  assert.equal(planPorCodigo("emprendedor")?.precio_mensual_pyg, 100_000);
  assert.equal(planPorCodigo("full")?.precio_mensual_pyg, 130_000);
  assert.equal(MENSAJES_GRATIS_POR_DIA, 10);
  assert.match(MIGRACION, /set limite_mensajes = 10\s+where codigo = 'free'/);
});

test("el anual sale diez meses", () => {
  for (const plan of PLANES) {
    assert.equal(precioDelPlan(plan, "anual"), plan.precio_mensual_pyg * MESES_DEL_ANUAL);
  }
});

test("Full es la suma de los módulos de los otros dos", () => {
  const union = new Set([
    ...planPorCodigo("finanzas_personales")!.modulos,
    ...planPorCodigo("emprendedor")!.modulos,
  ]);
  assert.deepEqual([...union].sort(), [...planPorCodigo("full")!.modulos].sort());
});

test("Finanzas Personales no trae nada del negocio", () => {
  const personal = planPorCodigo("finanzas_personales")!.modulos;
  for (const negocio of ["erp", "crm", "facturacion"]) {
    assert.ok(!personal.includes(negocio), negocio);
  }
});

test("todo módulo de un plan existe en el catálogo", () => {
  for (const plan of PLANES) {
    for (const codigo of plan.modulos) {
      const base = codigo.startsWith("conversaciones") ? "conversaciones" : codigo;
      assert.ok(Object.hasOwn(MODULOS, base), `${plan.codigo}: ${codigo}`);
    }
  }
});

test("ningún plan promete no tener tope", () => {
  const textos = PLANES.flatMap((p) => [p.nombre, p.para, ...p.incluye]).join(" ").toLowerCase();
  for (const prohibida of ["ilimitad", "sin tope", "sin límite", "sin limite"]) {
    assert.ok(!textos.includes(prohibida), prohibida);
  }
});

test("solo los tres códigos son planes", () => {
  assert.ok(esCodigoPlan("full"));
  assert.ok(!esCodigoPlan("negocio"));
  assert.ok(!esCodigoPlan(undefined));
});

test("Emprendedor Inicial es Emprendedor sin equipo, sin CRM y sin comprobantes", () => {
  const inicial = new Set(planPorCodigo("inicial")!.modulos);
  const emprendedor = planPorCodigo("emprendedor")!.modulos;

  for (const codigo of inicial) assert.ok(emprendedor.includes(codigo), codigo);
  for (const fuera of ["equipo", "crm", "facturacion"]) assert.ok(!inicial.has(fuera), fuera);
  assert.ok(inicial.has("erp"));
});

test("sumar equipo pide el módulo, invitar al contador no", () => {
  const ruta = fs.readFileSync(path.join(process.cwd(), "app", "api", "empresa", "miembros", "route.ts"), "utf8");
  const roles = ruta.match(/const ROLES_DE_TRABAJO = new Set\(\[([^\]]*)\]\)/);
  assert.ok(roles, "falta la lista de roles de trabajo");
  assert.ok(!roles[1].includes("contabilidad"));
  assert.ok(!roles[1].includes("solo_lectura"));
  assert.match(ruta, /verificarModulo\("equipo"\)/);
  // Tanto al invitar como al cambiar de rol.
  assert.equal([...ruta.matchAll(/await puedeSumarEquipo\(rol\)/g)].length, 2);
});
