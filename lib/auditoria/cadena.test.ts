import assert from "node:assert/strict";
import { test } from "node:test";

import type { PGlite } from "@electric-sql/pglite";

import { baseDePrueba, comoUsuario, migracion } from "../sql/base-de-prueba.ts";

/**
 * La bitácora de auditoría detecta que alguien la tocó.
 *
 * `eos_auditoria_v60` es la evidencia de que EOS no miente: cada fila lleva el
 * hash de la anterior y `eos_auditoria_verificar_v60()` recorre la cadena y
 * devuelve el primer eslabón roto. Hasta el 29/09/2026 esa promesa no tenía una
 * sola prueba: escribía bien, pero nadie había comprobado que DETECTA. Acá se
 * rompe a propósito de cada forma que la migración dice cubrir.
 *
 * Para romperla hay que apagar el trigger append-only, que es exactamente lo
 * que la v60 admite que puede hacer un superusuario. Lo que se prueba es que,
 * aun así, la manipulación queda a la vista.
 */

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

async function bitacoraConTresFilas(): Promise<PGlite> {
  const db = await baseDePrueba();
  await db.exec(migracion("20260823180000"));
  await db.query("insert into auth.users (id) values ($1), ($2)", [A, B]);
  for (const resumen of ["Venta de 2 remeras", "Compra de 10 cajas", "Cobro de Juan"]) {
    await db.query(
      "insert into public.eos_auditoria_v60 (usuario_id, evento, origen, resumen, detalle) values ($1, 'accion_autorizada', 'chat', $2, '{}')",
      [A, resumen],
    );
  }
  return db;
}

async function verificar(db: PGlite, usuario = A) {
  await comoUsuario(db, usuario);
  const { rows } = await db.query<{ ok: boolean; revisados: number; primer_roto: number | null; motivo: string | null }>(
    "select ok, revisados::int, primer_roto::int, motivo from public.eos_auditoria_verificar_v60()",
  );
  return rows[0];
}

async function sinCandado(db: PGlite, sql: string, params: unknown[] = []) {
  await db.exec("alter table public.eos_auditoria_v60 disable trigger eos_auditoria_solo_agregar_trg");
  await db.query(sql, params);
  await db.exec("alter table public.eos_auditoria_v60 enable trigger eos_auditoria_solo_agregar_trg");
}

test("una cadena intacta verifica completa", async () => {
  const db = await bitacoraConTresFilas();
  assert.deepEqual(await verificar(db), { ok: true, revisados: 3, primer_roto: null, motivo: null });
});

test("cada persona verifica solo su cadena", async () => {
  const db = await bitacoraConTresFilas();
  assert.deepEqual(await verificar(db, B), { ok: true, revisados: 0, primer_roto: null, motivo: null });
});

test("quien escribe no elige número, fecha ni sello", async () => {
  const db = await bitacoraConTresFilas();
  await db.query(
    `insert into public.eos_auditoria_v60 (usuario_id, numero, evento, origen, resumen, hash_previo, hash, created_at)
     values ($1, 99, 'accion_autorizada', 'chat', 'antedatada', 'inventado', 'inventado', '2020-01-01')`,
    [A],
  );
  const { rows } = await db.query<{ numero: number; anio: number; hash: string }>(
    "select numero::int, extract(year from created_at)::int as anio, hash from public.eos_auditoria_v60 where resumen = 'antedatada'",
  );
  assert.equal(rows[0].numero, 4);
  assert.notEqual(rows[0].anio, 2020);
  assert.notEqual(rows[0].hash, "inventado");
  assert.equal((await verificar(db)).ok, true);
});

test("editar o borrar se rechaza aunque venga del dueño de la tabla", async () => {
  const db = await bitacoraConTresFilas();
  await assert.rejects(db.query("update public.eos_auditoria_v60 set resumen = 'otra cosa' where numero = 2"), /append-only/);
  await assert.rejects(db.query("delete from public.eos_auditoria_v60 where numero = 2"), /append-only/);
});

test("cambiar el contenido de una fila vieja se detecta en esa fila", async () => {
  const db = await bitacoraConTresFilas();
  await sinCandado(db, "update public.eos_auditoria_v60 set resumen = 'Compra de 1 caja' where numero = 2");
  assert.deepEqual(await verificar(db), {
    ok: false,
    revisados: 1,
    primer_roto: 2,
    motivo: "el contenido no coincide con su sello",
  });
});

test("borrar una fila del medio deja el hueco a la vista", async () => {
  const db = await bitacoraConTresFilas();
  await sinCandado(db, "delete from public.eos_auditoria_v60 where numero = 2");
  assert.deepEqual(await verificar(db), {
    ok: false,
    revisados: 1,
    primer_roto: 3,
    motivo: "falta el registro número 2",
  });
});

test("volver a sellar la fila tocada no alcanza: la siguiente ya no engancha", async () => {
  const db = await bitacoraConTresFilas();
  await sinCandado(
    db,
    `update public.eos_auditoria_v60
        set resumen = 'Compra de 1 caja',
            hash = public.eos_auditoria_hash_v60(numero, usuario_id, evento, origen, 'Compra de 1 caja', detalle, referencia, created_at, hash_previo)
      where numero = 2`,
  );
  assert.deepEqual(await verificar(db), {
    ok: false,
    revisados: 2,
    primer_roto: 3,
    motivo: "no engancha con el registro anterior",
  });
});
