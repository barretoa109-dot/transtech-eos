import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

const MIGRACION = fs.readFileSync(
  path.join(process.cwd(), "supabase", "migrations", "20261121120000_eos_prueba_de_un_mes_v264.sql"),
  "utf8",
);

test("la prueba es de 30 días del plan Full, con origen prueba", () => {
  assert.match(MIGRACION, /where codigo = 'full' and activo/);
  assert.match(MIGRACION, /eos_activar_modulo\(p_usuario_id, v_codigo, 30, 'prueba', null\)/);
});

test("una cuenta que ya tuvo módulos no recibe otra prueba", () => {
  assert.match(MIGRACION, /if exists \(select 1 from public\.eos_usuario_modulos where usuario_id = p_usuario_id\) then\s+return false;/);
});

test("si la prueba falla, la cuenta se crea igual", () => {
  assert.match(MIGRACION, /exception when others then\s+raise warning/);
});

test("la prueba cuenta para el cupo de mensajes y las cortesías no", () => {
  assert.match(MIGRACION, /um\.origen in \('pago', 'prueba'\)/);
  assert.doesNotMatch(MIGRACION, /'cortesia'\)/);
});
