import assert from "node:assert/strict";
import { test } from "node:test";

import { baseDePrueba, migracion } from "./base-de-prueba.ts";

/**
 * La cotización (v239), contra un Postgres de verdad: una fila por par de
 * monedas, de lectura pública para cualquier sesión autenticada, nunca para
 * `anon`.
 */

async function base() {
  const db = await baseDePrueba();
  await db.exec(migracion("20261010010000"));
  return db;
}

test("guarda una cotización con su origen y su fecha", async () => {
  const db = await base();
  await db.exec(`
    insert into public.eos_cotizaciones (moneda_desde, moneda_hasta, valor)
    values ('USD', 'PYG', 7350.5)
  `);

  const { rows } = await db.query<{ valor: string; origen: string }>(
    `select valor, origen from public.eos_cotizaciones where moneda_desde = 'USD' and moneda_hasta = 'PYG'`,
  );

  assert.equal(Number(rows[0].valor), 7350.5);
  assert.equal(rows[0].origen, "google");
});

test("un valor en cero o negativo se rechaza", async () => {
  const db = await base();
  await assert.rejects(
    db.query(`insert into public.eos_cotizaciones (moneda_desde, moneda_hasta, valor) values ('USD', 'PYG', 0)`),
  );
  await assert.rejects(
    db.query(`insert into public.eos_cotizaciones (moneda_desde, moneda_hasta, valor) values ('USD', 'PYG', -1)`),
  );
});

test("actualizar el mismo par reemplaza la fila, no la duplica (upsert)", async () => {
  const db = await base();
  await db.exec(`
    insert into public.eos_cotizaciones (moneda_desde, moneda_hasta, valor) values ('USD', 'PYG', 7350.5)
    on conflict (moneda_desde, moneda_hasta) do update set valor = excluded.valor;
    insert into public.eos_cotizaciones (moneda_desde, moneda_hasta, valor) values ('USD', 'PYG', 7400)
    on conflict (moneda_desde, moneda_hasta) do update set valor = excluded.valor;
  `);

  const { rows } = await db.query<{ valor: string }>(`select valor from public.eos_cotizaciones`);
  assert.equal(rows.length, 1);
  assert.equal(Number(rows[0].valor), 7400);
});

test("la tabla tiene RLS encendida, como exige aislamiento_rls_e2e.sql contra producción", async () => {
  const db = await base();
  const { rows } = await db.query<{ relrowsecurity: boolean }>(
    `select relrowsecurity from pg_class where relname = 'eos_cotizaciones' and relnamespace = 'public'::regnamespace`,
  );
  assert.equal(rows[0].relrowsecurity, true);
});
