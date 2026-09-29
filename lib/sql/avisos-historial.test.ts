import assert from "node:assert/strict";
import { test } from "node:test";

import { baseDePrueba, migracion } from "./base-de-prueba.ts";

/** El tope de dos avisos por día y la historia que no se borra (v217). */

const U = "00000000-0000-0000-0000-000000000001";
const OTRA = "00000000-0000-0000-0000-000000000002";

async function base() {
  const db = await baseDePrueba();
  await db.exec(`create table public.usuarios (id uuid primary key);`);
  await db.exec(migracion("20260929191000"));
  await db.exec(`insert into public.usuarios values ('${U}'), ('${OTRA}');`);
  return db;
}

async function reservar(db: Awaited<ReturnType<typeof base>>, usuario: string, fecha: string, tipo: string) {
  const { rows } = await db.query<{ id: string | null }>(
    `select public.eos_reservar_aviso_v217($1, $2::date, 'negocio', $3, 'clave') as id`,
    [usuario, fecha, tipo],
  );
  return rows[0].id;
}

test("dos por día y por cuenta; el tercero queda anotado como sobre el tope", async () => {
  const db = await base();
  assert.ok(await reservar(db, U, "2026-10-01", "pagos_a_proveedores"));
  assert.ok(await reservar(db, U, "2026-10-01", "cobros_demorados"));
  assert.equal(await reservar(db, U, "2026-10-01", "inventario_bajo"), null);

  const { rows } = await db.query<{ tipo: string; resultado: string }>(
    `select tipo, resultado from public.eos_avisos_historial_v217 where usuario_id = $1 order by creado_en, tipo`,
    [U],
  );
  assert.deepEqual(
    rows.map((r) => `${r.tipo}:${r.resultado}`).sort(),
    ["cobros_demorados:reservado", "inventario_bajo:sobre_el_tope", "pagos_a_proveedores:reservado"],
  );
});

test("otro día y otra cuenta tienen su propio cupo; un aviso sin canal libera el lugar", async () => {
  const db = await base();
  const a = await reservar(db, U, "2026-10-01", "a");
  await reservar(db, U, "2026-10-01", "b");
  assert.ok(await reservar(db, U, "2026-10-02", "c"), "otro día");
  assert.ok(await reservar(db, OTRA, "2026-10-01", "d"), "otra cuenta");

  await db.query(`update public.eos_avisos_historial_v217 set resultado = 'sin_canal' where id = $1`, [a]);
  assert.ok(await reservar(db, U, "2026-10-01", "e"), "lo que no llegó no cuenta");
});

test("la historia se va con la cuenta, y nadie más que el servicio la ve", async () => {
  const db = await base();
  await reservar(db, U, "2026-10-01", "a");
  await db.exec(`delete from public.usuarios where id = '${U}'`);
  const { rows } = await db.query<{ n: number }>(`select count(*)::int as n from public.eos_avisos_historial_v217`);
  assert.equal(rows[0].n, 0);

  const permisos = await db.query<{ anon: boolean; auth: boolean; fn_anon: boolean; fn_servicio: boolean }>(`
    select
      has_table_privilege('anon', 'public.eos_avisos_historial_v217', 'select') as anon,
      has_table_privilege('authenticated', 'public.eos_avisos_historial_v217', 'select') as auth,
      has_function_privilege('anon', 'public.eos_reservar_aviso_v217(uuid, date, text, text, text, integer)', 'execute') as fn_anon,
      has_function_privilege('service_role', 'public.eos_reservar_aviso_v217(uuid, date, text, text, text, integer)', 'execute') as fn_servicio
  `);
  assert.deepEqual(permisos.rows[0], { anon: false, auth: false, fn_anon: false, fn_servicio: true });
});
