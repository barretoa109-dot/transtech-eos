import assert from "node:assert/strict";
import { test } from "node:test";

import { baseDePrueba, migracion } from "./base-de-prueba.ts";

/** La tabla de mensajes en espera (v214), contra un Postgres de verdad. */

async function base() {
  const db = await baseDePrueba();
  await db.exec(`create table public.usuarios (id uuid primary key);`);
  await db.exec(migracion("20260929153000"));
  await db.exec(`insert into public.usuarios values ('00000000-0000-0000-0000-000000000001');`);
  return db;
}

test("guarda un mensaje con sus valores por defecto", async () => {
  const db = await base();
  const { rows } = await db.query<{ estado: string; intentos: number; espera: boolean }>(`
    insert into public.eos_mensajes_en_espera_v214 (usuario_id, origen, mensaje)
    values ('00000000-0000-0000-0000-000000000001', 'whatsapp', 'vendí 3 bolsas')
    returning estado, intentos, proximo_intento_at > now() as espera
  `);
  assert.deepEqual(rows[0], { estado: "esperando", intentos: 0, espera: true });
});

test("no acepta un mensaje vacío ni un estado inventado", async () => {
  const db = await base();
  await assert.rejects(
    db.query(`insert into public.eos_mensajes_en_espera_v214 (usuario_id, origen, mensaje)
              values ('00000000-0000-0000-0000-000000000001', 'whatsapp', '')`),
  );
  await assert.rejects(
    db.query(`insert into public.eos_mensajes_en_espera_v214 (usuario_id, origen, mensaje, estado)
              values ('00000000-0000-0000-0000-000000000001', 'whatsapp', 'x', 'perdido')`),
  );
});

test("borrar la cuenta borra sus mensajes en espera", async () => {
  const db = await base();
  await db.exec(`
    insert into public.eos_mensajes_en_espera_v214 (usuario_id, origen, mensaje)
    values ('00000000-0000-0000-0000-000000000001', 'eos-web', 'hola');
    delete from public.usuarios;
  `);
  const { rows } = await db.query<{ n: number }>(`select count(*)::int as n from public.eos_mensajes_en_espera_v214`);
  assert.equal(rows[0].n, 0);
});

test("solo el service role la ve: ni anon ni una sesión de usuario", async () => {
  const db = await base();
  const { rows } = await db.query<{ anon: boolean; auth: boolean; servicio: boolean; rls: boolean }>(`
    select
      has_table_privilege('anon', 'public.eos_mensajes_en_espera_v214', 'select') as anon,
      has_table_privilege('authenticated', 'public.eos_mensajes_en_espera_v214', 'select') as auth,
      has_table_privilege('service_role', 'public.eos_mensajes_en_espera_v214', 'insert') as servicio,
      (select relrowsecurity from pg_class where relname = 'eos_mensajes_en_espera_v214') as rls
  `);
  assert.deepEqual(rows[0], { anon: false, auth: false, servicio: true, rls: true });
});
