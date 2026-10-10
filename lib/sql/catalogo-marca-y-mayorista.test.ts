import assert from "node:assert/strict";
import { test } from "node:test";

import { baseDePrueba, migracion } from "./base-de-prueba.ts";

/**
 * Marca y precio mayorista en el catálogo (v238), contra un Postgres de
 * verdad. Las dos son aditivas: una fila que ya existía sin ellas sigue
 * leyéndose igual.
 */

async function base() {
  const db = await baseDePrueba();
  await db.exec(`
    create table public.eos_erp_productos (
      id uuid primary key default gen_random_uuid(),
      usuario_id uuid not null,
      codigo text,
      nombre text not null,
      precio_venta numeric(16,2) not null default 0,
      activo boolean not null default true
    );
  `);
  await db.exec(migracion("20261010000000"));
  return db;
}

const usuario = "00000000-0000-0000-0000-000000000001";

test("un producto viejo, sin marca ni mayorista, sigue leyéndose igual", async () => {
  const db = await base();
  await db.exec(`insert into public.eos_erp_productos (usuario_id, nombre, precio_venta) values ('${usuario}', 'Remera básica', 50000)`);

  const { rows } = await db.query<{ marca: string | null; precio_mayorista: string | null }>(
    `select marca, precio_mayorista from public.eos_erp_productos where nombre = 'Remera básica'`,
  );

  assert.equal(rows[0].marca, null);
  assert.equal(rows[0].precio_mayorista, null);
});

test("marca y mayorista se guardan cuando se cargan", async () => {
  const db = await base();
  await db.exec(`
    insert into public.eos_erp_productos (usuario_id, nombre, precio_venta, marca, precio_mayorista)
    values ('${usuario}', 'Remera básica', 50000, 'Topper', 35000)
  `);

  const { rows } = await db.query<{ marca: string; precio_mayorista: string }>(
    `select marca, precio_mayorista from public.eos_erp_productos where nombre = 'Remera básica'`,
  );

  assert.equal(rows[0].marca, "Topper");
  assert.equal(Number(rows[0].precio_mayorista), 35000);
});

test("una marca vacía o demasiado larga se rechaza, igual que categoria", async () => {
  const db = await base();

  await assert.rejects(
    db.query(`insert into public.eos_erp_productos (usuario_id, nombre, precio_venta, marca) values ('${usuario}', 'X', 1, '')`),
  );
  await assert.rejects(
    db.query(
      `insert into public.eos_erp_productos (usuario_id, nombre, precio_venta, marca) values ('${usuario}', 'X', 1, '${"a".repeat(61)}')`,
    ),
  );
});

test("un precio mayorista negativo se rechaza", async () => {
  const db = await base();

  await assert.rejects(
    db.query(`insert into public.eos_erp_productos (usuario_id, nombre, precio_venta, precio_mayorista) values ('${usuario}', 'X', 1, -1)`),
  );
});
