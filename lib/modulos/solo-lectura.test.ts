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
