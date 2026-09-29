import assert from "node:assert/strict";
import { test } from "node:test";

import { baseDePrueba, migracion } from "./base-de-prueba.ts";

/**
 * El tablero de los viernes (v213), contra un Postgres de verdad.
 *
 * Las tablas y la vista de analítica se reemplazan por tablas mínimas con los
 * MISMOS tipos que producción (mensajes.created_at es timestamp sin zona; lo
 * demás, con zona): un error de zona horaria corre la semana tres horas y no
 * se ve leyendo el SQL.
 */

const HASTA = "2026-10-02T11:00:00Z";

async function base() {
  const db = await baseDePrueba();
  await db.exec(`
    create table public.eos_analitica_usuario_v172 (
      usuario_id uuid primary key, tipo text, registro timestamptz, primera_accion_ok timestamptz);
    create table public.eos_action_commands (usuario_id uuid, estado text, created_at timestamptz);
    create table public.mensajes (usuario_id uuid, rol text, origen text, created_at timestamp);
    create table public.eos_usuario_modulos (
      usuario_id uuid, origen text, estado text, vencimiento timestamptz);
    create table public.eos_message_usage_v40 (
      usuario_id uuid, status text, created_at timestamptz, consumed_at timestamptz);
  `);
  await db.exec(migracion("20260929152000"));

  const vieja = "00000000-0000-0000-0000-000000000001"; // registrada hace 60 días, sigue
  const nueva = "00000000-0000-0000-0000-000000000002"; // registrada hace 3 días, activó en 2 h
  const dormida = "00000000-0000-0000-0000-000000000003"; // hace 40 días, no hizo nada esta semana
  const qa = "00000000-0000-0000-0000-000000000004"; // cuenta de QA: no cuenta nunca

  await db.exec(`
    insert into public.eos_analitica_usuario_v172 values
      ('${vieja}', 'real', '${HASTA}'::timestamptz - interval '60 days', '${HASTA}'::timestamptz - interval '59 days'),
      ('${nueva}', 'real', '${HASTA}'::timestamptz - interval '3 days', '${HASTA}'::timestamptz - interval '3 days' + interval '2 hours'),
      ('${dormida}', 'real', '${HASTA}'::timestamptz - interval '40 days', null),
      ('${qa}', 'qa', '${HASTA}'::timestamptz - interval '2 days', '${HASTA}'::timestamptz - interval '2 days');

    insert into public.eos_action_commands values
      ('${vieja}', 'completada', '${HASTA}'::timestamptz - interval '1 day'),
      ('${vieja}', 'completada', '${HASTA}'::timestamptz - interval '2 days'),
      ('${vieja}', 'error', '${HASTA}'::timestamptz - interval '2 days'),
      ('${vieja}', 'completada', '${HASTA}'::timestamptz - interval '9 days'),
      ('${nueva}', 'completada', '${HASTA}'::timestamptz - interval '3 days' + interval '2 hours'),
      ('${qa}', 'error', '${HASTA}'::timestamptz - interval '1 day');

    -- 10:30 UTC del 2/10 cae adentro; 11:30 UTC del 2/10 cae afuera.
    insert into public.mensajes values
      ('${vieja}', 'usuario', 'whatsapp', '2026-10-02 10:30:00'),
      ('${vieja}', 'eos', 'whatsapp', '2026-10-02 10:30:05'),
      ('${nueva}', 'usuario', 'eos-web', '2026-09-29 12:00:00'),
      ('${nueva}', 'usuario', 'eos-web', '2026-10-02 11:30:00');

    insert into public.eos_usuario_modulos values
      ('${vieja}', 'pago', 'activo', '${HASTA}'::timestamptz + interval '20 days'),
      ('${nueva}', 'cortesia', 'activo', null),
      ('${dormida}', 'pago', 'activo', '${HASTA}'::timestamptz - interval '1 day');

    insert into public.eos_message_usage_v40 values
      ('${vieja}', 'consumed', '${HASTA}'::timestamptz - interval '1 day', '${HASTA}'::timestamptz - interval '1 day' + interval '4 seconds'),
      ('${vieja}', 'consumed', '${HASTA}'::timestamptz - interval '2 days', '${HASTA}'::timestamptz - interval '2 days' + interval '6 seconds'),
      ('${nueva}', 'released', '${HASTA}'::timestamptz - interval '1 day', null);
  `);
  return db;
}

test("los números de la semana, solo de cuentas reales", async () => {
  const db = await base();
  const { rows } = await db.query<{ t: Record<string, unknown> }>(
    `select public.eos_tablero_semanal_v213($1::timestamptz) as t`,
    [HASTA],
  );
  const t = rows[0].t;

  assert.equal(t.reales, 3);
  assert.equal(t.nuevas, 1, "solo la registrada hace 3 días");
  assert.equal(t.cohorte_24h, 1);
  assert.equal(t.activadas_24h, 1, "activó a las 2 horas");
  assert.equal(t.activas, 2);
  assert.equal(t.acciones_ok, 3, "la de hace 9 días queda afuera");
  assert.equal(t.acciones_error, 1, "el error de QA no cuenta");
  assert.equal(t.pagando, 1, "cortesía y un pago vencido no cuentan");
  assert.equal(t.base_30d, 2);
  assert.equal(t.retenidas_30d, 1, "la dormida no volvió");
  assert.equal(t.mensajes, 2, "el de las 11:30 UTC cae afuera de la semana");
  assert.equal(t.mensajes_whatsapp, 1);
  assert.equal(Number(t.latencia_p50_ms), 5000);
});

test("no se puede llamar como anon ni como usuario", async () => {
  const db = await base();
  const { rows } = await db.query<{ anon: boolean; auth: boolean; servicio: boolean }>(`
    select
      has_function_privilege('anon', 'public.eos_tablero_semanal_v213(timestamptz)', 'execute') as anon,
      has_function_privilege('authenticated', 'public.eos_tablero_semanal_v213(timestamptz)', 'execute') as auth,
      has_function_privilege('service_role', 'public.eos_tablero_semanal_v213(timestamptz)', 'execute') as servicio
  `);
  assert.deepEqual(rows[0], { anon: false, auth: false, servicio: true });
});
