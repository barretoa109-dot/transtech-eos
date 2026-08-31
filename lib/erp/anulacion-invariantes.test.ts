import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const MIGRACION = readFileSync(
  new URL("../../supabase/migrations/20260829005319_eos_erp_anulacion_invariantes_v88.sql", import.meta.url),
  "utf8",
);

test("mantiene las firmas públicas compatibles y limita la ejecución al servidor", () => {
  for (const nombre of ["venta", "compra"]) {
    assert.match(
      MIGRACION,
      new RegExp(`eos_erp_anular_${nombre}\\(\\s*p_usuario_id uuid,\\s*p_${nombre}_id uuid,\\s*p_motivo text default null`, "m"),
    );
    assert.match(MIGRACION, new RegExp(`grant execute on function public\\.eos_erp_anular_${nombre}\\(uuid, uuid, text\\) to service_role`));
  }
  assert.match(MIGRACION, /auth\.role\(\) is distinct from 'service_role'/);
  assert.match(MIGRACION, /EOS_ACTOR_REQUERIDO/);
  assert.match(MIGRACION, /EOS_ANULACION_MOTIVO_REQUERIDO/);
});

test("la doble ejecución queda protegida por lock, estado y auditoría única", () => {
  assert.match(MIGRACION, /for update;/i);
  assert.match(MIGRACION, /if v_venta\.estado = 'anulada' then/);
  assert.match(MIGRACION, /if v_compra\.estado = 'anulada' then/);
  assert.match(MIGRACION, /unique index[\s\S]+\(venta_id\) where venta_id is not null/i);
  assert.match(MIGRACION, /unique index[\s\S]+\(compra_id\) where compra_id is not null/i);
});

test("verifica todos los documentos fiscales y sólo cancela borradores", () => {
  assert.match(MIGRACION, /d\.estado not in \('borrador', 'cancelado'\)/);
  assert.match(MIGRACION, /where venta_id = v_venta\.id and usuario_id = p_usuario_id and estado = 'borrador'/);
  assert.doesNotMatch(MIGRACION, /eos_fe_documentos[\s\S]{0,180}limit 1/i);
});

test("agrupa líneas repetidas y decide el costo con compras posteriores y edición manual", () => {
  assert.match(MIGRACION, /sum\(cantidad\)::numeric\(16,3\)/);
  assert.match(MIGRACION, /array_agg\(costo_anterior order by orden asc, id asc\)/);
  assert.match(MIGRACION, /array_agg\(precio_unitario order by orden desc, id desc\)/);
  assert.match(MIGRACION, /v_ultima_compra_id is distinct from v_compra\.id/);
  assert.match(MIGRACION, /is distinct from v_item\.ultimo_precio_compra/);
});

test("revierte stock y dinero en la transacción y fecha los rastros en Paraguay", () => {
  assert.match(MIGRACION, /stock_actual \+ v_item\.cantidad/);
  assert.match(MIGRACION, /stock_actual - v_item\.cantidad/);
  assert.match(MIGRACION, /delete from public\.eos_movimientos_financieros/g);
  assert.match(MIGRACION, /now\(\) at time zone 'America\/Asuncion'/);
  assert.match(MIGRACION, /where id = v_venta\.movimiento_id and m?\.?usuario_id = p_usuario_id/);
  assert.match(MIGRACION, /where id = v_compra\.movimiento_id and m?\.?usuario_id = p_usuario_id/);
});

test("todas las relaciones sensibles quedan filtradas por tenant", () => {
  for (const tabla of [
    "eos_erp_ventas",
    "eos_erp_compras",
    "eos_erp_productos",
    "eos_fe_documentos",
    "eos_movimientos_financieros",
  ]) {
    assert.match(
      MIGRACION,
      new RegExp(`(?:from|update|delete from) public\\.${tabla}[\\s\\S]{0,180}usuario_id = p_usuario_id`, "i"),
      `falta el aislamiento explícito de ${tabla}`,
    );
  }
  assert.match(MIGRACION, /using \(\(select auth\.uid\(\)\) = usuario_id\)/);
});
