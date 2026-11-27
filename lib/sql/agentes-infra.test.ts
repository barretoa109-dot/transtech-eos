import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";

import type { PGlite } from "@electric-sql/pglite";

import { baseDePrueba, migracion } from "./base-de-prueba.ts";

/**
 * La infraestructura de los agentes (v267), contra un Postgres de verdad.
 *
 * Lo que se prueba acá son los criterios de aceptación que viven en la base:
 *   · ningún agente escribe en planes, módulos, pagos ni movimientos, ni
 *     siquiera llamando a una función SECURITY DEFINER vieja;
 *   · apagado no manda nada, aunque la corrida ya haya empezado;
 *   · nadie supera el tope semanal, sumando todos los agentes;
 *   · sin la versión aprobada por el dueño no arranca nada;
 *   · un agente no puede actuar por otro ni tocar su configuración.
 *
 * Cada agente entra con su propio rol: acá se simula con
 * `set session authorization`, que cambia `session_user` igual que un login.
 */

const PERSONA = "11111111-1111-4111-8111-111111111111";
const OTRA = "22222222-2222-4222-8222-222222222222";
const VERSION = "a1b2c3d4e5f6";

async function base(): Promise<PGlite> {
  const db = await baseDePrueba();
  // Lo mínimo de producción que importa para los permisos: tablas de plata y
  // de planes con los grants que Supabase les da a sus tres roles, y una
  // función SECURITY DEFINER vieja que nunca revocó a PUBLIC.
  await db.exec(`
    create table public.usuarios (id uuid primary key, email text);
    create table public.eos_usuario_modulos (usuario_id uuid, modulo text, estado text);
    create table public.eos_planes_armados (usuario_id uuid, precio integer);
    create table public.eos_paquetes (codigo text primary key, precio integer);
    create table public.solicitudes_pago (id serial primary key, usuario_id uuid, estado text);
    create table public.eos_finanzas_movimientos (id serial primary key, usuario_id uuid, monto numeric);
    grant all on all tables in schema public to anon, authenticated, service_role;

    create function public.eos_process_manual_payment_v42(p_usuario uuid)
    returns void language plpgsql security definer set search_path = '' as $$
    begin
      insert into public.solicitudes_pago (usuario_id, estado) values (p_usuario, 'aprobado');
      update public.eos_usuario_modulos set estado = 'activo' where usuario_id = p_usuario;
    end; $$;

    create function public.eos_ya_cerrada_v200() returns integer
    language sql security definer set search_path = '' as $$ select 1 $$;
    revoke all on function public.eos_ya_cerrada_v200() from public, anon, authenticated;
    grant execute on function public.eos_ya_cerrada_v200() to service_role;
  `);
  await db.exec(migracion("20261121151000"));
  return db;
}

async function como<T>(db: PGlite, rol: string | null, fn: () => Promise<T>): Promise<T> {
  await db.exec(`set session authorization ${rol ?? "postgres"}`);
  try {
    return await fn();
  } finally {
    // En PGlite `reset session authorization` no vuelve a postgres: se nombra.
    await db.exec("set session authorization postgres");
  }
}

async function falla(promesa: Promise<unknown>, patron: RegExp) {
  await assert.rejects(promesa, (e: unknown) => {
    assert.match(String((e as Error).message), patron);
    return true;
  });
}

async function valor<T>(db: PGlite, sql: string, args: unknown[] = []): Promise<T> {
  const r = await db.query<Record<string, T>>(sql, args);
  return Object.values(r.rows[0] ?? {})[0] as T;
}

/** Como el dueño: aprueba la versión y prende el agente. */
async function prender(db: PGlite, agente: string, version = VERSION) {
  await db.query("select public.eos_agentes_aprobar_v267($1, $2, 'dueño')", [agente, version]);
  await db.query("select public.eos_agentes_cambiar_v267($1, true, 'dueño')", [agente]);
}

async function empezar(db: PGlite, agente: string, version = VERSION) {
  return como(db, `agente_${agente}`, () =>
    valor<{ activo: boolean; run_id?: string; motivo?: string }>(
      db,
      "select agentes.empezar_run('cron', $1)",
      [version],
    ),
  );
}

async function autorizar(db: PGlite, agente: string, run: string, usuario = PERSONA, cuentaTope = true) {
  return como(db, `agente_${agente}`, () =>
    valor<string | null>(db, "select agentes.autorizar_envio($1, $2, 'email', 'prueba@1', $3)", [
      run,
      usuario,
      cuentaTope,
    ]),
  );
}

describe("v267: permisos de los agentes", () => {
  let db: PGlite;
  beforeEach(async () => {
    db = await base();
  });

  const AGENTES = ["reportes", "cobranza", "activacion", "soporte", "retencion", "contenido"];

  test("ningún agente lee ni escribe planes, módulos, pagos, movimientos ni usuarios", async () => {
    const tablas = [
      "usuarios",
      "eos_usuario_modulos",
      "eos_planes_armados",
      "eos_paquetes",
      "solicitudes_pago",
      "eos_finanzas_movimientos",
    ];
    for (const agente of AGENTES) {
      for (const tabla of tablas) {
        await como(db, `agente_${agente}`, async () => {
          await falla(db.query(`select * from public.${tabla}`), /permission denied/);
          await falla(db.query(`delete from public.${tabla}`), /permission denied/);
        });
      }
      await como(db, `agente_${agente}`, async () => {
        await falla(db.query("insert into public.eos_paquetes values ('x', 1)"), /permission denied/);
        await falla(db.query("update public.eos_paquetes set precio = 0"), /permission denied/);
        await falla(
          db.query("insert into public.eos_usuario_modulos values ($1, 'erp', 'activo')", [PERSONA]),
          /permission denied/,
        );
      });
    }
  });

  test("ningún agente ejecuta funciones de cobro viejas abiertas a PUBLIC", async () => {
    for (const agente of AGENTES) {
      await como(db, `agente_${agente}`, () =>
        falla(db.query("select public.eos_process_manual_payment_v42($1)", [PERSONA]), /permission denied/),
      );
    }
  });

  test("quien la llamaba antes la sigue pudiendo llamar", async () => {
    for (const rol of ["anon", "authenticated", "service_role"]) {
      assert.equal(
        await valor(db, "select has_function_privilege($1, 'public.eos_process_manual_payment_v42(uuid)', 'execute')", [
          rol,
        ]),
        true,
        rol,
      );
    }
    // Y lo que ya estaba cerrado sigue cerrado.
    assert.equal(
      await valor(db, "select has_function_privilege('anon', 'public.eos_ya_cerrada_v200()', 'execute')"),
      false,
    );
  });

  test("ningún agente toca su configuración, el tope ni las tablas de agentes", async () => {
    await como(db, "agente_cobranza", async () => {
      await falla(db.query("select public.eos_agentes_cambiar_v267('cobranza', true, 'yo')"), /permission denied/);
      await falla(db.query("select public.eos_agentes_aprobar_v267('cobranza', $1, 'yo')", [VERSION]), /permission denied/);
      await falla(db.query("select public.eos_agentes_tope_v267(50, 'yo')"), /permission denied/);
      await falla(db.query("select public.eos_agentes_emitir_v267('alta', 'x')"), /permission denied/);
      await falla(db.query("select * from agentes.agent_config"), /permission denied/);
      await falla(db.query("update agentes.agent_config set activo = true"), /permission denied/);
      await falla(db.query("update agentes.ajustes set tope_semanal = 50"), /permission denied/);
      await falla(db.query("select * from agentes.agent_messages"), /permission denied/);
    });
  });

  test("anon y authenticated no ven nada de los agentes", async () => {
    for (const rol of ["anon", "authenticated"]) {
      await como(db, rol, async () => {
        await falla(db.query("select * from agentes.escalations"), /permission denied/);
        await falla(db.query("select agentes.empezar_run('cron', $1)", [VERSION]), /permission denied/);
        await falla(db.query("select public.eos_agentes_panel_v267()"), /permission denied/);
      });
    }
  });

  test("quien no es un agente no puede usar las funciones de agente", async () => {
    await falla(db.query("select agentes.empezar_run('cron', $1)", [VERSION]), /EOS_AGENTE_DESCONOCIDO/);
  });
});

describe("v267: interruptor, versión aprobada y tope", () => {
  let db: PGlite;
  beforeEach(async () => {
    db = await base();
  });

  test("todos nacen apagados y apagado no anota ni manda nada", async () => {
    const config = await db.query<{ agente: string; activo: boolean }>(
      "select agente, activo from agentes.agent_config order by agente",
    );
    assert.equal(config.rows.length, 6);
    assert.ok(config.rows.every((c) => !c.activo));

    const r = await empezar(db, "cobranza");
    assert.deepEqual(r, { activo: false, motivo: "apagado" });
    assert.equal(await valor(db, "select count(*)::int from agentes.agent_runs"), 0);
  });

  test("prendido pero con una versión sin aprobar no arranca y escala una sola vez", async () => {
    await prender(db, "soporte");
    const r = await empezar(db, "soporte", "ffffffffffff");
    assert.equal(r.activo, false);
    assert.equal(r.motivo, "version_sin_aprobar");
    await empezar(db, "soporte", "ffffffffffff");

    const escalamientos = await db.query<{ prioridad: string }>(
      "select prioridad from agentes.escalations where agente = 'soporte'",
    );
    assert.equal(escalamientos.rows.length, 1);
    assert.equal(escalamientos.rows[0].prioridad, "urgente");
  });

  test("apagar a mitad de la corrida corta los envíos que faltan", async () => {
    await prender(db, "cobranza");
    const { run_id } = await empezar(db, "cobranza");
    assert.ok(run_id);
    assert.ok(await autorizar(db, "cobranza", run_id));

    await db.query("select public.eos_agentes_cambiar_v267('cobranza', false, 'dueño')");
    assert.equal(await autorizar(db, "cobranza", run_id, OTRA), null);
    assert.equal(
      await valor(db, "select estado from agentes.agent_messages where usuario_id = $1", [OTRA]),
      "bloqueado_apagado",
    );
  });

  test("una nueva versión aprobada deja afuera a la corrida con la versión vieja", async () => {
    await prender(db, "cobranza");
    const { run_id } = await empezar(db, "cobranza");
    await db.query("select public.eos_agentes_aprobar_v267('cobranza', 'bbbbbbbbbbbb', 'dueño')");
    assert.equal(await autorizar(db, "cobranza", run_id!), null);
  });

  test("el tope semanal suma a todos los agentes y no deja pasar el quinto", async () => {
    await prender(db, "cobranza");
    await prender(db, "activacion");
    const cobranza = (await empezar(db, "cobranza")).run_id!;
    const activacion = (await empezar(db, "activacion")).run_id!;

    assert.ok(await autorizar(db, "cobranza", cobranza));
    assert.ok(await autorizar(db, "cobranza", cobranza));
    assert.ok(await autorizar(db, "activacion", activacion));
    assert.ok(await autorizar(db, "activacion", activacion));
    assert.equal(await autorizar(db, "activacion", activacion), null);
    assert.equal(await autorizar(db, "cobranza", cobranza), null);

    // Otra persona tiene su propio cupo.
    assert.ok(await autorizar(db, "cobranza", cobranza, OTRA));

    assert.equal(
      await valor(
        db,
        "select count(*)::int from agentes.agent_messages where usuario_id = $1 and estado = 'bloqueado_tope'",
        [PERSONA],
      ),
      2,
    );
  });

  test("solo Soporte contesta fuera del tope; los demás no pueden saltarlo", async () => {
    await db.query("select public.eos_agentes_tope_v267(1, 'dueño')");
    await prender(db, "cobranza");
    await prender(db, "soporte");
    const cobranza = (await empezar(db, "cobranza")).run_id!;
    const soporte = (await empezar(db, "soporte")).run_id!;

    assert.ok(await autorizar(db, "cobranza", cobranza));
    assert.equal(await autorizar(db, "cobranza", cobranza, PERSONA, false), null);
    assert.ok(await autorizar(db, "soporte", soporte, PERSONA, false));
    // Y Soporte por iniciativa propia sí cuenta.
    assert.equal(await autorizar(db, "soporte", soporte, PERSONA, true), null);
  });

  test("un mensaje fallado deja de contar para el tope", async () => {
    await db.query("select public.eos_agentes_tope_v267(1, 'dueño')");
    await prender(db, "cobranza");
    const run = (await empezar(db, "cobranza")).run_id!;
    const id = await autorizar(db, "cobranza", run);
    assert.ok(id);
    assert.equal(await autorizar(db, "cobranza", run), null);

    await como(db, "agente_cobranza", () =>
      db.query("select agentes.marcar_entrega($1, 'fallado', null, 'rebotó')", [id]),
    );
    assert.ok(await autorizar(db, "cobranza", run));
  });

  test("el tope por corrida también frena", async () => {
    await db.query("update agentes.agent_config set limites = '{\"mensajes_por_corrida\": 1}' where agente = 'cobranza'");
    await prender(db, "cobranza");
    const run = (await empezar(db, "cobranza")).run_id!;
    assert.ok(await autorizar(db, "cobranza", run));
    assert.equal(await autorizar(db, "cobranza", run, OTRA), null);
  });
});

describe("v267: un agente no actúa por otro", () => {
  let db: PGlite;
  beforeEach(async () => {
    db = await base();
  });

  test("no usa la corrida, los mensajes ni los eventos de otro agente", async () => {
    await prender(db, "cobranza");
    await prender(db, "activacion");
    const run = (await empezar(db, "cobranza")).run_id!;
    const mensaje = await autorizar(db, "cobranza", run);

    await como(db, "agente_activacion", async () => {
      await falla(db.query("select agentes.autorizar_envio($1, $2, 'email', 'x@1')", [run, PERSONA]), /EOS_AGENTE_RUN_AJENO/);
      await falla(db.query("select agentes.marcar_entrega($1, 'enviado')", [mensaje]), /EOS_AGENTE_MENSAJE_AJENO/);
      await falla(db.query("select agentes.terminar_run($1)", [run]), /EOS_AGENTE_RUN_AJENO/);
      await falla(db.query("select agentes.escalar($1, null, 'motivo ajeno', 'normal')", [run]), /EOS_AGENTE_RUN_AJENO/);
    });
  });

  test("cada evento va a la cola de quien lo escucha, una sola vez", async () => {
    assert.equal(await valor(db, "select public.eos_agentes_emitir_v267('pago_acreditado', 'pago:1', $1)", [PERSONA]), 1);
    assert.equal(await valor(db, "select public.eos_agentes_emitir_v267('pago_acreditado', 'pago:1', $1)", [PERSONA]), 0);

    const cobranza = await como(db, "agente_cobranza", () =>
      db.query<{ id: string; tipo: string }>("select id, tipo from agentes.tomar_eventos(10)"),
    );
    assert.equal(cobranza.rows.length, 1);
    assert.equal(cobranza.rows[0].tipo, "pago_acreditado");

    const activacion = await como(db, "agente_activacion", () =>
      db.query("select * from agentes.tomar_eventos(10)"),
    );
    assert.equal(activacion.rows.length, 0);

    // Tomado y no cerrado: no se entrega dos veces en la misma ventana.
    const otra = await como(db, "agente_cobranza", () => db.query("select * from agentes.tomar_eventos(10)"));
    assert.equal(otra.rows.length, 0);

    await como(db, "agente_activacion", () =>
      falla(db.query("select agentes.cerrar_evento($1)", [cobranza.rows[0].id]), /EOS_AGENTE_EVENTO_AJENO/),
    );
    await como(db, "agente_cobranza", () => db.query("select agentes.cerrar_evento($1)", [cobranza.rows[0].id]));
    assert.ok(await valor(db, "select procesado_en from agentes.eventos where id = $1", [cobranza.rows[0].id]));
  });

  test("terminar la corrida anota costo y duración, y después no se puede mandar", async () => {
    await prender(db, "soporte");
    const run = (await empezar(db, "soporte")).run_id!;
    await como(db, "agente_soporte", () =>
      db.query("select agentes.terminar_run($1, '{\"respondidas\": 1}', 'claude-sonnet-5-5', 1000, 200, 5000, 0.0071)", [run]),
    );
    const fila = await db.query<{ costo_usd: string; duracion_ms: number; modelo: string }>(
      "select costo_usd, duracion_ms, modelo from agentes.agent_runs where id = $1",
      [run],
    );
    assert.equal(Number(fila.rows[0].costo_usd), 0.0071);
    assert.equal(fila.rows[0].modelo, "claude-sonnet-5-5");
    assert.ok(fila.rows[0].duracion_ms >= 0);

    await como(db, "agente_soporte", async () => {
      await falla(db.query("select agentes.autorizar_envio($1, $2, 'email', 'x@1')", [run, PERSONA]), /EOS_AGENTE_RUN_TERMINADO/);
      assert.equal(Number(await valor(db, "select agentes.gasto_del_mes()")), 0.0071);
    });
  });

  test("el mismo caso abierto no se escala dos veces", async () => {
    await prender(db, "soporte");
    const run = (await empezar(db, "soporte")).run_id!;
    const [a, b] = await como(db, "agente_soporte", async () => [
      await valor<string>(db, "select agentes.escalar($1, $2, 'Pregunta fuera de la base', 'normal')", [run, PERSONA]),
      await valor<string>(db, "select agentes.escalar($1, $2, 'Pregunta fuera de la base', 'normal')", [run, PERSONA]),
    ]);
    assert.equal(a, b);

    const pendientes = await valor<unknown[]>(db, "select public.eos_agentes_por_avisar_v267(false)");
    assert.equal(pendientes.length, 1);
    await db.query("select public.eos_agentes_avisados_v267(array[$1]::uuid[], false)", [a]);
    assert.equal((await valor<unknown[]>(db, "select public.eos_agentes_por_avisar_v267(false)")).length, 0);

    await db.query("select public.eos_agentes_resolver_v267($1, 'Respondido por correo', 'dueño')", [a]);
    const panel = await valor<{ escalamientos: unknown[] }>(db, "select public.eos_agentes_panel_v267()");
    assert.equal(panel.escalamientos.length, 0);
  });
});
