import assert from "node:assert/strict";
import fs from "node:fs";
import { beforeEach, describe, test } from "node:test";

import type { PGlite } from "@electric-sql/pglite";

import { baseDePrueba, migracion } from "../sql/base-de-prueba.ts";
import { AGENTES, type Agente } from "./agentes.ts";
import { costoUsd } from "./costo.ts";
import { correrAgente, type Llamar } from "./runtime.ts";
import { calcularTodas, textoDelGenerado } from "./versiones.ts";
import { VERSIONES } from "./versiones.generado.ts";

/**
 * `correrAgente` contra la base de la v267 de verdad, entrando con el rol de
 * cada agente. Es el camino que va a usar cada agente en producción, salvo el
 * driver (acá PGlite en vez de postgres.js).
 */

const PERSONA = "11111111-1111-4111-8111-111111111111";
const VERSION = "abcdefabcdef";

function llamarComo(db: PGlite, agente: Agente): Llamar {
  return async (funcion, args) => {
    await db.exec(`set session authorization agente_${agente}`);
    try {
      const marcas = args.map((_, i) => `$${i + 1}`).join(", ");
      const r = await db.query<{ r: unknown }>(
        `select agentes.${funcion}(${marcas}) as r`,
        args.map((a) => (a !== null && typeof a === "object" ? JSON.stringify(a) : a)),
      );
      return r.rows[0]?.r ?? null;
    } finally {
      await db.exec("set session authorization postgres");
    }
  };
}

async function base() {
  const db = await baseDePrueba();
  await db.exec(migracion("20261121151000"));
  return db;
}

async function prender(db: PGlite, agente: Agente) {
  await db.query("select public.eos_agentes_aprobar_v267($1, $2, 'dueño')", [agente, VERSION]);
  await db.query("select public.eos_agentes_cambiar_v267($1, true, 'dueño')", [agente]);
}

describe("correrAgente", () => {
  let db: PGlite;
  beforeEach(async () => {
    db = await base();
  });

  test("apagado no llama al trabajo", async () => {
    let corrio = false;
    const r = await correrAgente(
      { agente: "cobranza", llamar: llamarComo(db, "cobranza"), version: VERSION, disparador: "cron" },
      async () => {
        corrio = true;
      },
    );
    assert.deepEqual(r, { estado: "apagado" });
    assert.equal(corrio, false);
  });

  test("manda, anota la entrega y el costo; lo que no autoriza la base no se manda", async () => {
    await db.query("select public.eos_agentes_tope_v267(1, 'dueño')");
    await prender(db, "soporte");
    const mandados: string[] = [];

    const r = await correrAgente(
      { agente: "soporte", llamar: llamarComo(db, "soporte"), version: VERSION, disparador: "evento" },
      async (ctx) => {
        ctx.anotarUso("claude-sonnet-5-5", { input_tokens: 1000, output_tokens: 400, cache_read_input_tokens: 15000 });
        const primero = await ctx.enviar({
          usuarioId: PERSONA,
          canal: "email",
          plantilla: "soporte/respuesta",
          mandar: async () => {
            mandados.push("primero");
            return { ok: true, proveedorId: "re_1" };
          },
        });
        const segundo = await ctx.enviar({
          usuarioId: PERSONA,
          canal: "email",
          plantilla: "soporte/seguimiento",
          mandar: async () => {
            mandados.push("segundo");
            return { ok: true };
          },
        });
        return { primero, segundo };
      },
    );

    assert.equal(r.estado, "ok");
    assert.deepEqual(r.estado === "ok" && r.salida, { primero: "enviado", segundo: "no_autorizado" });
    assert.deepEqual(mandados, ["primero"]);

    const mensajes = await db.query<{ estado: string; proveedor_id: string | null }>(
      "select estado, proveedor_id from agentes.agent_messages order by creado_en",
    );
    assert.deepEqual(
      mensajes.rows.map((m) => m.estado),
      ["enviado", "bloqueado_tope"],
    );
    assert.equal(mensajes.rows[0].proveedor_id, "re_1");

    const corrida = await db.query<{ costo_usd: string; tokens_cache: number; terminado_en: string | null }>(
      "select costo_usd, tokens_cache, terminado_en from agentes.agent_runs",
    );
    assert.equal(Number(corrida.rows[0].costo_usd), costoUsd("claude-sonnet-5-5", { input_tokens: 1000, output_tokens: 400, cache_read_input_tokens: 15000 }));
    assert.equal(corrida.rows[0].tokens_cache, 15000);
    assert.ok(corrida.rows[0].terminado_en);
  });

  test("si el proveedor falla, el mensaje queda fallado y no gasta cupo", async () => {
    await db.query("select public.eos_agentes_tope_v267(1, 'dueño')");
    await prender(db, "cobranza");
    const r = await correrAgente(
      { agente: "cobranza", llamar: llamarComo(db, "cobranza"), version: VERSION, disparador: "cron" },
      async (ctx) => [
        await ctx.enviar({
          usuarioId: PERSONA,
          canal: "email",
          plantilla: "cobranza/dia0",
          mandar: async () => {
            throw new Error("Resend caído");
          },
        }),
        await ctx.enviar({ usuarioId: PERSONA, canal: "email", plantilla: "cobranza/dia0", mandar: async () => ({ ok: true }) }),
      ],
    );
    assert.deepEqual(r.estado === "ok" && r.salida, ["fallado", "enviado"]);
  });

  test("un error del trabajo queda anotado y escalado una sola vez", async () => {
    await prender(db, "reportes");
    for (let i = 0; i < 2; i++) {
      const r = await correrAgente(
        { agente: "reportes", llamar: llamarComo(db, "reportes"), version: VERSION, disparador: "cron" },
        async () => {
          throw new Error("la vista no existe");
        },
      );
      assert.equal(r.estado, "error");
    }
    assert.equal(
      (await db.query("select 1 from agentes.agent_runs where error = 'la vista no existe'")).rows.length,
      2,
    );
    assert.equal((await db.query("select 1 from agentes.escalations where agente = 'reportes'")).rows.length, 1);
  });

  test("sin la versión aprobada no corre", async () => {
    await prender(db, "activacion");
    const r = await correrAgente(
      { agente: "activacion", llamar: llamarComo(db, "activacion"), version: "000000000000", disparador: "cron" },
      async () => assert.fail("no tenía que correr"),
    );
    assert.equal(r.estado, "version_sin_aprobar");
  });

  test("puedeGastar respeta el tope de gasto del mes", async () => {
    await db.query("update agentes.agent_config set limites = '{\"gasto_usd_mes\": 0.01}' where agente = 'contenido'");
    await prender(db, "contenido");
    const r = await correrAgente(
      { agente: "contenido", llamar: llamarComo(db, "contenido"), version: VERSION, disparador: "cron" },
      async (ctx) => {
        const antes = await ctx.puedeGastar();
        ctx.anotarUso("claude-opus-5-5", { input_tokens: 5000, output_tokens: 3000 });
        return { antes, despues: await ctx.puedeGastar() };
      },
    );
    assert.deepEqual(r.estado === "ok" && r.salida, { antes: true, despues: false });
  });
});

describe("la lista de agentes y sus versiones", () => {
  test("coincide con la v267: mismas filas y mismos roles", () => {
    const sql = migracion("20261121151000");
    for (const agente of AGENTES) {
      assert.match(sql, new RegExp(`'agente_${agente}'`), agente);
      assert.match(sql, new RegExp(`\\('${agente}',`), agente);
    }
  });

  test("versiones.generado.ts está al día con agentes/ (correr npm run agentes:versiones)", () => {
    const actual = fs.readFileSync(new URL("./versiones.generado.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");
    assert.equal(actual, textoDelGenerado(calcularTodas()));
    assert.deepEqual(VERSIONES, calcularTodas());
  });

  test("cada versión es un hash que la base acepta", () => {
    for (const v of Object.values(VERSIONES)) assert.match(v, /^[a-f0-9]{16}$/);
  });
});

describe("costoUsd", () => {
  test("cobra entrada, salida y caché a su precio", () => {
    // 1M de entrada + 1M de salida en Sonnet 5.5 = 2 + 10.
    assert.equal(costoUsd("claude-sonnet-5-5", { input_tokens: 1_000_000, output_tokens: 1_000_000 }), 12);
    assert.equal(costoUsd("claude-haiku-5-5", { cache_read_input_tokens: 1_000_000 }), 0.01);
    assert.equal(costoUsd("claude-opus-5-5", { cache_creation_input_tokens: 1_000_000 }), 5);
  });

  test("Batches cuesta la mitad y un modelo desconocido se cobra como el más caro", () => {
    assert.equal(costoUsd("claude-opus-5-5", { output_tokens: 1_000_000 }, { lote: true }), 10);
    assert.equal(costoUsd("modelo-nuevo", { output_tokens: 1_000_000 }), 20);
  });
});
