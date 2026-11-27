import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";

import type { PGlite } from "@electric-sql/pglite";

import { baseDePrueba, migracion } from "./base-de-prueba.ts";

/**
 * v268: los avisos automáticos de siempre (push de franjas, correo
 * motivacional, primera semana) comparten el tope con los agentes.
 */

const PERSONA = "11111111-1111-4111-8111-111111111111";
const VERSION = "abcdefabcdef";

async function base(): Promise<PGlite> {
  const db = await baseDePrueba();
  await db.exec(migracion("20261121151000"));
  await db.exec(migracion("20261121152000"));
  return db;
}

async function sistema(db: PGlite, plantilla = "push/manana", espaciar = 0): Promise<string | null> {
  const r = await db.query<{ id: string | null }>(
    "select public.eos_agentes_autorizar_sistema_v268($1, 'push', $2, $3) as id",
    [PERSONA, plantilla, espaciar],
  );
  return r.rows[0].id;
}

/** Corre el tiempo para atrás: deja un mensaje del sistema N días en el pasado. */
async function envejecer(db: PGlite, id: string, dias: number) {
  await db.query("update agentes.agent_messages set creado_en = now() - make_interval(days => $2) where id = $1", [id, dias]);
}

async function cobranzaManda(db: PGlite): Promise<string | null> {
  await db.exec("set session authorization agente_cobranza");
  try {
    const inicio = await db.query<{ r: { run_id: string } }>("select agentes.empezar_run('cron', $1) as r", [VERSION]);
    const r = await db.query<{ id: string | null }>(
      "select agentes.autorizar_envio($1, $2, 'email', 'cobranza/dia0') as id",
      [inicio.rows[0].r.run_id, PERSONA],
    );
    return r.rows[0].id;
  } finally {
    await db.exec("set session authorization postgres");
  }
}

describe("v268: el sistema dentro del tope", () => {
  let db: PGlite;
  beforeEach(async () => {
    db = await base();
  });

  test("nace prendido, con techo 2 dentro del tope de 4", async () => {
    const r = await db.query<{ activo: boolean; tope_semanal: number; tope_sistema: number }>(
      "select c.activo, a.tope_semanal, a.tope_sistema from agentes.agent_config c, agentes.ajustes a where c.agente = 'sistema'",
    );
    assert.deepEqual(r.rows[0], { activo: true, tope_semanal: 4, tope_sistema: 2 });
  });

  test("el sistema no pasa de su techo y deja lugar para los agentes", async () => {
    assert.ok(await sistema(db));
    assert.ok(await sistema(db));
    assert.equal(await sistema(db), null);

    await db.query("select public.eos_agentes_aprobar_v267('cobranza', $1, 'dueño')", [VERSION]);
    await db.query("select public.eos_agentes_cambiar_v267('cobranza', true, 'dueño')");
    assert.ok(await cobranzaManda(db));
    assert.ok(await cobranzaManda(db));
    // 2 del sistema + 2 de Cobranza = 4: el tope total.
    assert.equal(await cobranzaManda(db), null);
  });

  test("si los agentes ya usaron el tope, el sistema tampoco manda", async () => {
    await db.query("select public.eos_agentes_aprobar_v267('cobranza', $1, 'dueño')", [VERSION]);
    await db.query("select public.eos_agentes_cambiar_v267('cobranza', true, 'dueño')");
    for (let i = 0; i < 4; i++) assert.ok(await cobranzaManda(db));
    assert.equal(await sistema(db), null);
    assert.equal(
      await db.query<{ detalle: string }>("select detalle from agentes.agent_messages where agente = 'sistema'").then((r) => r.rows[0].detalle),
      "tope semanal",
    );
  });

  test("lo motivacional sale espaciado: no dos en 3 días", async () => {
    const primero = await sistema(db, "push/manana", 3);
    assert.ok(primero);
    assert.equal(await sistema(db, "correo/motivacional/0", 3), null);

    await envejecer(db, primero!, 3);
    assert.ok(await sistema(db, "correo/motivacional/0", 3));
  });

  test("lo de la primera semana no se espacia, pero cuenta", async () => {
    assert.ok(await sistema(db, "correo/primeros-dias/dia1"));
    assert.ok(await sistema(db, "correo/primeros-dias/dia3"));
    assert.equal(await sistema(db, "push/manana", 3), null);
  });

  test("un aviso fallado deja de contar", async () => {
    const id = await sistema(db);
    await sistema(db);
    assert.equal(await sistema(db), null);
    await db.query("select public.eos_agentes_entrega_sistema_v268($1, 'fallado', 'APNs')", [id]);
    assert.ok(await sistema(db));
  });

  test("apagar el sistema corta todo sin deploy", async () => {
    await db.query("select public.eos_agentes_cambiar_v267('sistema', false, 'dueño')");
    assert.equal(await sistema(db), null);
    assert.equal(
      await db.query<{ estado: string }>("select estado from agentes.agent_messages").then((r) => r.rows[0].estado),
      "bloqueado_apagado",
    );
  });

  test("solo service_role usa la puerta del sistema; ningún agente ni anon", async () => {
    for (const rol of ["anon", "authenticated", "agente_cobranza", "agente_soporte"]) {
      await db.exec(`set session authorization ${rol}`);
      try {
        await assert.rejects(
          db.query("select public.eos_agentes_autorizar_sistema_v268($1, 'push', 'x')", [PERSONA]),
          /permission denied/,
          rol,
        );
        await assert.rejects(db.query("select public.eos_agentes_tope_sistema_v268(50, 'yo')"), /permission denied/, rol);
      } finally {
        await db.exec("set session authorization postgres");
      }
    }
    assert.equal(
      (await db.query<{ ok: boolean }>(
        "select has_function_privilege('service_role', 'public.eos_agentes_autorizar_sistema_v268(uuid, text, text, integer)', 'execute') as ok",
      )).rows[0].ok,
      true,
    );
  });

  test("el panel muestra el techo del sistema y al sistema al final", async () => {
    await db.query("select public.eos_agentes_tope_sistema_v268(1, 'dueño')");
    const panel = (await db.query<{ p: { tope_sistema: number; agentes: { agente: string }[] } }>(
      "select public.eos_agentes_panel_v267() as p",
    )).rows[0].p;
    assert.equal(panel.tope_sistema, 1);
    assert.equal(panel.agentes.at(-1)?.agente, "sistema");
    assert.equal(panel.agentes.length, 7);
  });
});
