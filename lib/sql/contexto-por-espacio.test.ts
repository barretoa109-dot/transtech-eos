import assert from "node:assert/strict";
import { test } from "node:test";

import type { PGlite } from "@electric-sql/pglite";

import { baseDePrueba, migracion } from "./base-de-prueba.ts";

/**
 * El contexto del chat, acotado al espacio (v259), contra un Postgres de
 * verdad.
 *
 * ============================================================
 * QUÉ SOSTIENE ESTO
 * ============================================================
 *
 * El 11/11/2026, parado en "Mi negocio", EOS contestó "dame un resumen de mis
 * objetivos" con los ₲ 3.000.000 de la American Express de la persona y la
 * ampliación de la granja en el mismo párrafo. La tarjeta salía de la
 * posición —que se leía SIEMPRE con `ambito = 'personal'`, también desde el
 * negocio— y los objetivos de una consulta sin filtro de ámbito.
 *
 * Las pruebas de abajo son esa pantalla: lo de cada lado tiene que estar de
 * su lado, y lo del otro no puede aparecer de ninguna forma.
 *
 * Las tablas se crean con las columnas que la función toca y nada más: lo que
 * se prueba es el filtro por ámbito, no el esquema completo del ERP.
 */

const USUARIO = "00000000-0000-0000-0000-000000000001";
const OTRO = "00000000-0000-0000-0000-000000000002";

async function base(): Promise<PGlite> {
  const db = await baseDePrueba();

  await db.exec(`
    create table public.conversaciones (
      id uuid primary key default gen_random_uuid(),
      usuario_id uuid not null,
      titulo text,
      created_at timestamptz not null default now()
    );

    create table public.eos_memory (
      id uuid primary key default gen_random_uuid(),
      usuario_id uuid not null,
      conversacion_id uuid,
      titulo text not null,
      contenido text,
      importancia integer default 5,
      estado text default 'activo',
      updated_at timestamptz default now()
    );

    create table public.eos_movimientos_financieros (
      id uuid primary key default gen_random_uuid(),
      usuario_id uuid not null,
      fecha date not null,
      tipo text not null,
      monto numeric not null,
      moneda text not null default 'PYG',
      ambito text not null default 'personal'
    );

    create table public.eos_erp_ventas (
      id uuid primary key default gen_random_uuid(),
      usuario_id uuid not null,
      fecha date not null,
      estado text not null default 'cobrada',
      total numeric not null default 0,
      moneda text not null default 'PYG',
      movimiento_id uuid
    );

    create table public.eos_erp_compras (
      id uuid primary key default gen_random_uuid(),
      usuario_id uuid not null,
      estado text not null default 'pagada',
      total numeric not null default 0,
      moneda text not null default 'PYG',
      movimiento_id uuid
    );

    create table public.eos_erp_productos (
      id uuid primary key default gen_random_uuid(),
      usuario_id uuid not null,
      nombre text not null,
      precio_venta numeric not null default 0,
      moneda text not null default 'PYG',
      costo numeric,
      controla_stock boolean not null default false,
      stock_actual numeric not null default 0,
      stock_minimo numeric not null default 0,
      activo boolean not null default true
    );

    create table public.eos_erp_venta_items (
      id uuid primary key default gen_random_uuid(),
      venta_id uuid,
      producto_id uuid,
      descripcion text,
      cantidad numeric not null default 1
    );

    create table public.eos_crm_oportunidades (
      id uuid primary key default gen_random_uuid(),
      usuario_id uuid not null,
      etapa text not null default 'nueva',
      monto numeric default 0,
      moneda text not null default 'PYG',
      cerrada_en date
    );

    create table public.eos_crm_actividades (
      id uuid primary key default gen_random_uuid(),
      usuario_id uuid not null,
      hecha boolean not null default false,
      fecha date
    );

    create table public.eos_finanzas_cuentas (
      id uuid primary key default gen_random_uuid(),
      usuario_id uuid not null,
      nombre text not null,
      moneda text not null default 'PYG',
      saldo_declarado numeric,
      saldo_declarado_el date,
      activa boolean not null default true,
      ambito text not null default 'personal'
    );

    create table public.eos_finanzas_tarjetas (
      id uuid primary key default gen_random_uuid(),
      usuario_id uuid not null,
      nombre text,
      emisor text,
      moneda text not null default 'PYG',
      dia_cierre smallint,
      dia_vencimiento smallint,
      pago_total numeric,
      pago_minimo numeric,
      resumen_al date,
      activa boolean not null default true,
      ambito text not null default 'personal',
      created_at timestamptz default now()
    );

    create table public.eos_finanzas_deudas (
      id uuid primary key default gen_random_uuid(),
      usuario_id uuid not null,
      acreedor text not null,
      moneda text not null default 'PYG',
      saldo_declarado numeric,
      cuota_monto numeric,
      cuota_dia smallint,
      estado text default 'al_dia',
      ambito text not null default 'personal'
    );

    create table public.eos_goals (
      id uuid primary key default gen_random_uuid(),
      usuario_id uuid not null,
      titulo text not null,
      moneda text,
      valor_objetivo numeric,
      valor_actual numeric,
      fecha_limite date,
      estado text default 'activo',
      ambito text not null default 'personal'
    );

    -- La v259 también le agrega el ámbito a los mensajes que quedaron
    -- esperando a que vuelva la IA (v214), para que el reintento arme el
    -- contexto del mismo espacio.
    create table public.eos_mensajes_en_espera_v214 (
      id uuid primary key default gen_random_uuid(),
      usuario_id uuid not null,
      mensaje text not null
    );

    -- Los módulos se contratan aparte; acá siempre están, para que el bloque
    -- del ERP y el del CRM se armen y se pueda comprobar que NO viajan en
    -- Personal.
    create function public.eos_tiene_modulo(p_usuario_id uuid, p_codigo text)
    returns boolean language sql stable as $$ select true $$;
  `);

  // El ámbito de la conversación, tal cual lo agregó la v256: es de donde la
  // memoria hereda el suyo.
  await db.exec(migracion("20261107140000"));
  await db.exec(migracion("20261110191000"));

  return db;
}

/** La misma persona, con plata y objetivos de los dos lados. */
async function conDatosDeLosDosLados(db: PGlite): Promise<void> {
  await db.exec(`
    insert into public.eos_movimientos_financieros (usuario_id, fecha, tipo, monto, ambito) values
      ('${USUARIO}', current_date, 'ingreso', 8000000, 'negocio'),
      ('${USUARIO}', current_date, 'gasto', 3000000, 'negocio'),
      ('${USUARIO}', current_date, 'ingreso', 4200000, 'personal'),
      ('${USUARIO}', current_date, 'gasto', 1300000, 'personal');

    insert into public.eos_finanzas_cuentas (usuario_id, nombre, saldo_declarado, saldo_declarado_el, ambito) values
      ('${USUARIO}', 'Ueno personal', 3000000, current_date, 'personal'),
      ('${USUARIO}', 'Caja de la granja', 11000000, current_date, 'negocio');

    insert into public.eos_finanzas_tarjetas (usuario_id, nombre, pago_total, dia_vencimiento, ambito) values
      ('${USUARIO}', 'American Express Itaú', 3000000, 5, 'personal'),
      ('${USUARIO}', 'Visa de la empresa', 900000, 12, 'negocio');

    insert into public.eos_finanzas_deudas (usuario_id, acreedor, saldo_declarado, ambito) values
      ('${USUARIO}', 'Préstamo del auto', 7000000, 'personal'),
      ('${USUARIO}', 'Proveedor de balanceado', 2500000, 'negocio');

    insert into public.eos_goals (usuario_id, titulo, ambito) values
      ('${USUARIO}', 'Saldar la American Express', 'personal'),
      ('${USUARIO}', 'Ampliar la granja a 30 lechones', 'negocio');

    insert into public.eos_erp_productos (usuario_id, nombre, precio_venta) values
      ('${USUARIO}', 'Lechón de 10 kg', 350000);

    insert into public.eos_erp_ventas (usuario_id, fecha, estado, total) values
      ('${USUARIO}', current_date, 'cobrada', 1750000);

    insert into public.eos_crm_oportunidades (usuario_id, etapa, monto) values
      ('${USUARIO}', 'propuesta', 5000000);
  `);
}

async function contexto(db: PGlite, ambito: string | null): Promise<Record<string, unknown>> {
  const { rows } = await db.query<{ c: Record<string, unknown> }>(
    `select public.eos_contexto_del_espacio($1::uuid, $2::text) as c`,
    [USUARIO, ambito],
  );
  return rows[0].c;
}

function textoDe(valor: unknown): string {
  return JSON.stringify(valor ?? {});
}

test("parado en el negocio no viaja NADA de la plata de la persona", async () => {
  const db = await base();
  await conDatosDeLosDosLados(db);

  const c = await contexto(db, "negocio");
  const todo = textoDe(c);

  // Lo que la pantalla del 11/11/2026 mostraba mezclado.
  assert.doesNotMatch(todo, /American Express/);
  assert.doesNotMatch(todo, /Saldar la American Express/);
  assert.doesNotMatch(todo, /Ueno personal/);
  assert.doesNotMatch(todo, /Préstamo del auto/);
  assert.doesNotMatch(todo, /4200000/);

  // Y lo del negocio sigue entero.
  assert.match(todo, /Visa de la empresa/);
  assert.match(todo, /Caja de la granja/);
  assert.match(todo, /Ampliar la granja/);
  assert.match(todo, /Proveedor de balanceado/);
  assert.match(todo, /Lechón de 10 kg/);

  assert.equal(c.ambito, "negocio");
  // El bloque "VOS, personal" no existe en el negocio.
  assert.deepEqual(c.personal, []);
});

test("parado en Personal no viajan ni el catálogo ni las ventas", async () => {
  const db = await base();
  await conDatosDeLosDosLados(db);

  const c = await contexto(db, "personal");
  const todo = textoDe(c);

  assert.doesNotMatch(todo, /Lechón de 10 kg/);
  assert.doesNotMatch(todo, /Caja de la granja/);
  assert.doesNotMatch(todo, /Visa de la empresa/);
  assert.doesNotMatch(todo, /Ampliar la granja/);

  assert.match(todo, /American Express/);
  assert.match(todo, /Ueno personal/);
  assert.match(todo, /Saldar la American Express/);

  assert.equal(c.ambito, "personal");
  // El ERP y el CRM no se arman siquiera: son del otro espacio.
  assert.equal(c.erp, undefined);
  assert.equal(c.crm, undefined);
  assert.deepEqual(c.finanzas, []);
});

test("sin espacio —WhatsApp— sigue llegando todo junto, como hasta la v258", async () => {
  const db = await base();
  await conDatosDeLosDosLados(db);

  const c = await contexto(db, null);
  const todo = textoDe(c);

  assert.match(todo, /American Express/);
  assert.match(todo, /Ampliar la granja/);
  assert.match(todo, /Saldar la American Express/);
  assert.match(todo, /Lechón de 10 kg/);

  // Sin ámbito declarado la posición es la de la persona, como siempre.
  assert.match(todo, /Ueno personal/);
  assert.doesNotMatch(todo, /Caja de la granja/);

  // Y no se afirma ningún espacio: el TypeScript lo mira para no escribir un
  // encabezado que diría una cosa sobre datos que dicen otra.
  assert.equal(c.ambito, undefined);
});

test("la firma de siempre devuelve exactamente lo de antes", async () => {
  const db = await base();
  await conDatosDeLosDosLados(db);

  const { rows } = await db.query<{ iguales: boolean }>(
    `select public.eos_contexto_negocio($1::uuid) = public.eos_contexto_del_espacio($1::uuid, null::text) as iguales`,
    [USUARIO],
  );

  assert.equal(rows[0].iguales, true);
});

test("un ámbito que no existe no esconde datos: contesta como sin espacio", async () => {
  const db = await base();
  await conDatosDeLosDosLados(db);

  const { rows } = await db.query<{ iguales: boolean }>(
    `select public.eos_contexto_del_espacio($1::uuid, 'marciano') = public.eos_contexto_del_espacio($1::uuid, null::text) as iguales`,
    [USUARIO],
  );

  assert.equal(rows[0].iguales, true);
});

test("el ámbito no abre la puerta a la plata de otro", async () => {
  const db = await base();
  await conDatosDeLosDosLados(db);
  await db.exec(
    `insert into public.eos_goals (usuario_id, titulo, ambito) values ('${OTRO}', 'Objetivo ajeno', 'negocio')`,
  );

  const c = await contexto(db, "negocio");

  assert.doesNotMatch(textoDe(c), /Objetivo ajeno/);
});

// ============================================================
// La memoria, que es la otra mitad del problema
// ============================================================
//
// `eos_memory` es texto libre y viaja entero en cada mensaje: "quiero saldar
// los 3 millones de la Amex" es una memoria, no un objetivo. Desde la v259
// nace con el ámbito de la conversación donde se guardó.

test("una memoria nace con el ámbito de la conversación donde se guardó", async () => {
  const db = await base();
  await db.exec(`
    insert into public.conversaciones (id, usuario_id, ambito) values
      ('00000000-0000-0000-0000-0000000000aa', '${USUARIO}', 'negocio'),
      ('00000000-0000-0000-0000-0000000000bb', '${USUARIO}', 'personal');

    insert into public.eos_memory (usuario_id, conversacion_id, titulo) values
      ('${USUARIO}', '00000000-0000-0000-0000-0000000000aa', 'Compra 30 lechones por mes'),
      ('${USUARIO}', '00000000-0000-0000-0000-0000000000bb', 'Quiere saldar la Amex');
  `);

  const { rows } = await db.query<{ titulo: string; ambito: string | null }>(
    `select titulo, ambito from public.eos_memory order by titulo`,
  );

  assert.deepEqual(rows, [
    { titulo: "Compra 30 lechones por mes", ambito: "negocio" },
    { titulo: "Quiere saldar la Amex", ambito: "personal" },
  ]);
});

test("sin conversación la memoria queda sin ámbito, y así se ve en los dos lados", async () => {
  const db = await base();
  await db.exec(
    `insert into public.eos_memory (usuario_id, titulo) values ('${USUARIO}', 'Le dicen Guto')`,
  );

  const { rows } = await db.query<{ ambito: string | null }>(
    `select ambito from public.eos_memory`,
  );

  assert.equal(rows[0].ambito, null);
});

test("un ámbito declarado a mano le gana al de la conversación", async () => {
  const db = await base();
  await db.exec(`
    insert into public.conversaciones (id, usuario_id, ambito) values
      ('00000000-0000-0000-0000-0000000000aa', '${USUARIO}', 'personal');

    insert into public.eos_memory (usuario_id, conversacion_id, titulo, ambito) values
      ('${USUARIO}', '00000000-0000-0000-0000-0000000000aa', 'Lo del local', 'negocio');
  `);

  const { rows } = await db.query<{ ambito: string }>(`select ambito from public.eos_memory`);

  assert.equal(rows[0].ambito, "negocio");
});

test("la memoria no acepta un ámbito inventado", async () => {
  const db = await base();

  await assert.rejects(
    db.query(
      `insert into public.eos_memory (usuario_id, titulo, ambito) values ('${USUARIO}', 'X', 'marciano')`,
    ),
  );
});

test("el mensaje que quedó esperando guarda su espacio, y no uno inventado", async () => {
  const db = await base();

  await db.exec(
    `insert into public.eos_mensajes_en_espera_v214 (usuario_id, mensaje, ambito) values ('${USUARIO}', 'cuánto me queda', 'negocio')`,
  );
  await db.exec(
    `insert into public.eos_mensajes_en_espera_v214 (usuario_id, mensaje) values ('${USUARIO}', 'vendí 3 bolsas')`,
  );

  const { rows } = await db.query<{ ambito: string | null }>(
    `select ambito from public.eos_mensajes_en_espera_v214 order by mensaje`,
  );

  // El del negocio vuelve a su espacio; el de un canal sin espacios, a ninguno.
  assert.deepEqual(rows, [{ ambito: "negocio" }, { ambito: null }]);

  await assert.rejects(
    db.query(
      `insert into public.eos_mensajes_en_espera_v214 (usuario_id, mensaje, ambito) values ('${USUARIO}', 'x', 'marciano')`,
    ),
  );
});
