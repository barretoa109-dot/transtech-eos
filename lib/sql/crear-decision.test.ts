import assert from "node:assert/strict";
import { test } from "node:test";

import { baseDePrueba, migracion } from "./base-de-prueba.ts";

/**
 * CREAR_DECISION (v236), contra un Postgres de verdad.
 *
 * Carga las migraciones reales de `eos_decisions` (v6, con su trigger de
 * `cerrada_at`) y la fecha de revisión por defecto (v179), sobre tablas
 * mínimas con los mismos tipos que producción. Así el trigger que completa
 * `fecha_revision` a 14 días corre de verdad, no una copia de su lógica.
 *
 * De la v236 solo se carga `eos_crm_crear_decision_v236`: el resto de ese
 * archivo reemplaza entero `eos_execute_internal_effect_v64`, la función de
 * 30 ramas que ejecuta TODAS las acciones del chat (ventas, stock,
 * contactos, tarjetas...). Stubear esa función completa en PGlite pediría
 * una tabla falsa por cada una de esas ramas, probando todo menos lo que
 * importa acá. Esa función se prueba como el resto del ejecutor: contra la
 * base real, en una transacción revertida (`supabase/pruebas/`).
 */

/** Solo la función nueva, no el resto del archivo de la migración v236. */
function soloLaFuncionDeDecision(): string {
  const texto = migracion("20261008130000");
  const inicio = texto.indexOf("create or replace function public.eos_crm_crear_decision_v236");
  const fin = texto.indexOf(
    "comment on function public.eos_crm_crear_decision_v236(uuid, uuid, jsonb) is",
  );
  if (inicio < 0 || fin < 0) throw new Error("no se encontró eos_crm_crear_decision_v236 en la migración");
  return texto.slice(inicio, fin);
}

const USUARIO = "00000000-0000-0000-0000-000000000001";
const COMANDO_1 = "00000000-0000-0000-0000-00000000a001";
const COMANDO_2 = "00000000-0000-0000-0000-00000000a002";

async function base() {
  const db = await baseDePrueba();
  await db.exec(`
    create table public.usuarios (id uuid primary key references auth.users(id));
    create table public.eos_projects (id uuid primary key);
    create table public.eos_goals (id uuid primary key);
    create table public.conversaciones (id uuid primary key);
    create table public.mensajes (id uuid primary key);
    create table public.eos_action_commands (id uuid primary key);

    insert into auth.users (id) values ('${USUARIO}');
    insert into public.usuarios (id) values ('${USUARIO}');
    insert into public.eos_action_commands (id) values ('${COMANDO_1}'), ('${COMANDO_2}');
  `);
  await db.exec(migracion("20260811133156")); // eos_decisions (v6)
  await db.exec(migracion("20260918190000")); // fecha_revision por defecto (v179)
  await db.exec(`
    alter table public.eos_decisions
      add column if not exists action_command_id uuid
        references public.eos_action_commands (id) on delete set null;
  `);
  await db.exec(migracion("20260930102000")); // eos_leer_monto con decimales (v223)
  await db.exec(soloLaFuncionDeDecision());
  return db;
}

type FilaDecision = {
  titulo: string;
  decision: string;
  razon: string | null;
  metrica: string | null;
  valor_base: string | null;
  valor_objetivo: string | null;
  fecha_decision: string;
  fecha_revision: string;
  fuente: string;
  action_command_id: string | null;
};

async function decision(db: Awaited<ReturnType<typeof base>>, id: string): Promise<FilaDecision> {
  const { rows } = await db.query<FilaDecision>(
    `select titulo, decision, razon, metrica, valor_base, valor_objetivo,
            (fecha_decision at time zone 'America/Asuncion')::date as fecha_decision,
            fecha_revision, fuente, action_command_id
     from public.eos_decisions where id = $1`,
    [id],
  );
  return rows[0];
}

test("decision es obligatoria", async () => {
  const db = await base();
  await assert.rejects(
    () => db.query(`select public.eos_crm_crear_decision_v236($1, $2, '{}'::jsonb)`, [USUARIO, COMANDO_1]),
    /EOS_ACCION_DECISION_SIN_TEXTO/,
  );
});

test("sin título, lo recorta de la decisión (a 80); fecha_revision cae a +14 días por el trigger de la v179", async () => {
  const db = await base();
  const larga =
    "Subir el precio del combo familiar de 150.000 a 175.000 a partir del primer lunes de noviembre, " +
    "avisando a los clientes frecuentes por WhatsApp una semana antes del cambio";
  const { rows } = await db.query<{ eos_crm_crear_decision_v236: { id: string } }>(
    `select public.eos_crm_crear_decision_v236($1, $2, $3::jsonb)`,
    [USUARIO, COMANDO_1, JSON.stringify({ decision: larga })],
  );
  const id = rows[0].eos_crm_crear_decision_v236.id;
  const fila = await decision(db, id);

  assert.equal(fila.titulo, larga.slice(0, 80));
  assert.equal(fila.titulo.length, 80);
  assert.equal(fila.decision, larga); // la decisión completa, sin recortar
  assert.equal(fila.fuente, "chat");
  assert.equal(fila.action_command_id, COMANDO_1);

  const base14 = new Date(fila.fecha_decision);
  const revision = new Date(fila.fecha_revision);
  const dias = Math.round((revision.getTime() - base14.getTime()) / 86_400_000);
  assert.equal(dias, 14);
});

test("con título explícito, no se lo recorta de la decisión", async () => {
  const db = await base();
  const { rows } = await db.query<{ eos_crm_crear_decision_v236: { id: string } }>(
    `select public.eos_crm_crear_decision_v236($1, $2, $3::jsonb)`,
    [
      USUARIO,
      COMANDO_1,
      JSON.stringify({ titulo: "Precio del combo", decision: "Subir el precio del combo a 150.000" }),
    ],
  );
  const fila = await decision(db, rows[0].eos_crm_crear_decision_v236.id);
  assert.equal(fila.titulo, "Precio del combo");
});

test("metrica, valor_base y valor_objetivo se guardan cuando vienen; ausentes quedan null, no cero", async () => {
  const db = await base();
  const { rows } = await db.query<{ eos_crm_crear_decision_v236: { id: string; con_metrica: boolean } }>(
    `select public.eos_crm_crear_decision_v236($1, $2, $3::jsonb)`,
    [
      USUARIO,
      COMANDO_1,
      JSON.stringify({
        decision: "Bajar el costo de flete por kilómetro",
        metrica: "costo de flete por km",
        valor_base: "2500",
        valor_objetivo: "2000",
      }),
    ],
  );
  assert.equal(rows[0].eos_crm_crear_decision_v236.con_metrica, true);

  const fila = await decision(db, rows[0].eos_crm_crear_decision_v236.id);
  assert.equal(Number(fila.valor_base), 2500);
  assert.equal(Number(fila.valor_objetivo), 2000);

  const { rows: sinMetrica } = await db.query<{ eos_crm_crear_decision_v236: { id: string } }>(
    `select public.eos_crm_crear_decision_v236($1, $2, $3::jsonb)`,
    [USUARIO, COMANDO_2, JSON.stringify({ decision: "Dejar de vender al fiado los fines de semana" })],
  );
  const filaSinMetrica = await decision(db, sinMetrica[0].eos_crm_crear_decision_v236.id);
  assert.equal(filaSinMetrica.valor_base, null);
  assert.equal(filaSinMetrica.valor_objetivo, null);
  assert.equal(filaSinMetrica.metrica, null);
});

test("una fecha_revision explícita no se pisa con el default de 14 días", async () => {
  const db = await base();
  const { rows } = await db.query<{ eos_crm_crear_decision_v236: { id: string } }>(
    `select public.eos_crm_crear_decision_v236($1, $2, $3::jsonb)`,
    [
      USUARIO,
      COMANDO_1,
      JSON.stringify({ decision: "Esperar al verano para subir el precio del helado", fecha_revision: "2026-12-01" }),
    ],
  );
  const fila = await decision(db, rows[0].eos_crm_crear_decision_v236.id);
  assert.equal(new Date(fila.fecha_revision).toISOString().slice(0, 10), "2026-12-01");
});
