import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { test } from "node:test";

const MIGRACION = fs.readFileSync(
  path.join(process.cwd(), "supabase", "migrations", "20261121130000_eos_roles_solo_lectura_v265.sql"),
  "utf8",
);

test("los roles de solo mirar son contabilidad y solo_lectura", () => {
  assert.match(MIGRACION, /m\.rol in \('contabilidad', 'solo_lectura'\)/);
});

test("el chat frena las acciones del negocio de esos roles", () => {
  assert.match(MIGRACION, /raise exception 'EOS_ACCION_SOLO_LECTURA'/);
  for (const accion of ["REGISTRAR_VENTA", "ANULAR_VENTA", "REGISTRAR_COMPRA", "AJUSTAR_STOCK"]) {
    assert.ok(MIGRACION.includes(`'${accion}'`), accion);
  }
});

test("toda ruta del negocio que escribe pasa por la puerta de escritura", () => {
  const archivos = execSync(
    "grep -rlE 'export async function (POST|PUT|PATCH|DELETE)' app/api/erp app/api/crm app/api/empresa/cajas app/api/facturacion",
    { encoding: "utf8" },
  )
    .split("\n")
    .filter(Boolean);

  assert.ok(archivos.length > 20);

  for (const archivo of archivos) {
    const texto = fs.readFileSync(archivo, "utf8");
    for (const bloque of texto.split(/(?=export async function )/)) {
      const metodo = bloque.match(/^export async function (POST|PUT|PATCH|DELETE)\b/);
      if (!metodo) continue;
      assert.match(bloque, /exigir(Algun)?ModuloParaEscribir\(/, `${archivo} ${metodo[1]}`);
    }
  }
});

test("ninguna migración posterior pisa la puerta del ejecutor sin el control de rol", () => {
  const carpeta = path.join(process.cwd(), "supabase", "migrations");
  const posteriores = fs
    .readdirSync(carpeta)
    .filter((a) => a.endsWith(".sql") && a > "20261121130000")
    .sort();

  for (const archivo of posteriores) {
    const sql = fs.readFileSync(path.join(carpeta, archivo), "utf8");
    if (!/CREATE OR REPLACE FUNCTION public\.eos_execute_internal_effect_v64\s*\(/i.test(sql)) continue;
    assert.match(
      sql,
      /eos_rol_solo_lectura_v265/,
      `${archivo} redefine eos_execute_internal_effect_v64 sin el control de rol. ` +
        "Las ramas nuevas van en eos_execute_internal_effect_v64_base_v265 (ver la v265).",
    );
  }
});
