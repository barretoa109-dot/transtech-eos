import assert from "node:assert/strict";
import { test } from "node:test";

import { baseDePrueba, migracion } from "./base-de-prueba.ts";

/**
 * Cuándo una cuenta real empieza a usar Personal (v235), contra un Postgres
 * de verdad.
 *
 * El riesgo real de este cambio no es el CTE en sí -- es el filtro
 * `ambito = 'personal'`: cuentas, tarjetas, deudas y fijos son tablas
 * compartidas con el negocio desde la v136/v143, así que una tarjeta de
 * EMPRESA no puede contarse como que la persona activó Personal.
 */

async function base() {
  const db = await baseDePrueba();
  await db.exec(`
    alter table auth.users add column created_at timestamptz;
    create table public.usuarios (id uuid primary key, plan text, created_at timestamptz);
    create table public.eos_cuentas_v172 (usuario_id uuid primary key, tipo text);
    create table public.eos_onboarding (usuario_id uuid, completado_en timestamptz);
    create table public.mensajes (usuario_id uuid, rol text, origen text, created_at timestamp);
    create table public.eos_action_commands (
      usuario_id uuid, estado text, created_at timestamptz, completed_at timestamptz);
    create table public.eos_movimientos_financieros (usuario_id uuid, created_at timestamptz);
    create table public.eos_erp_ventas (usuario_id uuid, creado_en timestamptz, estado text);
    create table public.eos_erp_productos (usuario_id uuid, creado_en timestamptz);
    create table public.eos_memory (usuario_id uuid, created_at timestamptz);
    create table public.eos_goals (usuario_id uuid, created_at timestamptz);
    create table public.eos_daily_briefings (usuario_id uuid, created_at timestamptz);
    create table public.eos_whatsapp_vinculos_v162 (usuario_id uuid, verificado_at timestamptz);
    create table public.solicitudes_pago (usuario_id uuid, estado text, pagado_at timestamptz);
    create table public.eos_finanzas_cuentas (
      usuario_id uuid, ambito text, created_at timestamptz);
    create table public.eos_finanzas_tarjetas (
      usuario_id uuid, ambito text, created_at timestamptz);
    create table public.eos_finanzas_fijos (
      usuario_id uuid, ambito text, created_at timestamptz);
    create table public.eos_finanzas_deudas (
      usuario_id uuid, ambito text, created_at timestamptz);
  `);
  await db.exec(migracion("20261008120000"));
  return db;
}

const marta = "00000000-0000-0000-0000-000000000001"; // declaró cuenta y tarjeta de Personal
const soloNegocio = "00000000-0000-0000-0000-000000000002"; // solo tarjeta de la empresa
const ninguna = "00000000-0000-0000-0000-000000000003"; // no tocó Personal

test("una cuenta y una tarjeta personales quedan con su primera fecha", async () => {
  const db = await base();
  await db.exec(`
    insert into public.eos_cuentas_v172 values ('${marta}', 'real'), ('${soloNegocio}', 'real'), ('${ninguna}', 'real');

    insert into public.eos_finanzas_cuentas values
      ('${marta}', 'personal', '2026-10-01T10:00:00Z'),
      ('${marta}', 'personal', '2026-10-03T10:00:00Z'); -- segunda cuenta: no cambia el PRIMER hito

    insert into public.eos_finanzas_tarjetas values
      ('${marta}', 'personal', '2026-10-02T10:00:00Z'),
      ('${soloNegocio}', 'negocio', '2026-10-01T10:00:00Z');
  `);

  const filas = await db.query<{
    usuario_id: string;
    primera_cuenta_personal: string | null;
    primera_tarjeta_personal: string | null;
    primer_fijo_personal: string | null;
    primera_deuda_personal: string | null;
  }>(
    `select usuario_id, primera_cuenta_personal, primera_tarjeta_personal,
            primer_fijo_personal, primera_deuda_personal
     from public.eos_analitica_usuario_v172 order by usuario_id`,
  );

  const porId = new Map(filas.rows.map((f) => [f.usuario_id, f]));

  assert.equal(
    new Date(porId.get(marta)!.primera_cuenta_personal!).toISOString(),
    "2026-10-01T10:00:00.000Z",
  );
  assert.equal(
    new Date(porId.get(marta)!.primera_tarjeta_personal!).toISOString(),
    "2026-10-02T10:00:00.000Z",
  );
  assert.equal(porId.get(marta)?.primer_fijo_personal, null);
  assert.equal(porId.get(marta)?.primera_deuda_personal, null);

  // la tarjeta es de NEGOCIO: no cuenta como que la persona activó Personal.
  assert.equal(porId.get(soloNegocio)?.primera_tarjeta_personal, null);

  assert.equal(porId.get(ninguna)?.primera_cuenta_personal, null);
  assert.equal(porId.get(ninguna)?.primera_tarjeta_personal, null);
});

test("no toca activado_v1 ni las columnas de negocio ya existentes", async () => {
  const db = await base();
  await db.exec(`
    insert into public.eos_cuentas_v172 values ('${marta}', 'real');
    insert into public.eos_action_commands values ('${marta}', 'completada', '2026-10-01T10:00:00Z', '2026-10-01T10:00:00Z');
    insert into public.eos_memory values ('${marta}', '2026-10-01T10:00:00Z');
    insert into public.mensajes values
      ('${marta}', 'usuario', 'eos-web', '2026-10-01 10:00:00'),
      ('${marta}', 'usuario', 'eos-web', '2026-10-02 10:00:00');
    insert into public.eos_movimientos_financieros values ('${marta}', '2026-10-01T10:00:00Z');
  `);

  const { rows } = await db.query<{ activado_v1: boolean; primer_movimiento: string }>(
    `select activado_v1, primer_movimiento from public.eos_analitica_usuario_v172 where usuario_id = '${marta}'`,
  );

  assert.equal(rows[0].activado_v1, true);
  assert.equal(new Date(rows[0].primer_movimiento).toISOString(), "2026-10-01T10:00:00.000Z");
});
