import assert from "node:assert/strict";
import { test } from "node:test";

import type { PGlite } from "@electric-sql/pglite";

import { baseDePrueba, migracion } from "./base-de-prueba.ts";

/**
 * Un objetivo pedido por chat no se cae por cómo vino escrito un monto o una
 * fecha (v211).
 *
 * El 22/09/2026 una cuenta real pidió un objetivo en guaraníes y terminó en
 * EOS_INTERNAL_EFFECT_GOAL_FAILED: `eos_process_goal_command()` convierte el
 * payload con casts directos (`::numeric`, `::date`, `::smallint`) y
 * "3.000.000" o "31/12/2026" los revientan.
 *
 * La función real depende de media base (objetivos, hitos, contexto maestro),
 * así que acá se reproducen SOLO sus conversiones, copiadas de la v2 y la v144,
 * con el mismo "atrapar y marcar error". Si esas conversiones cambian allá,
 * este trigger de prueba tiene que cambiar igual.
 */

async function baseConObjetivos(conV211: boolean): Promise<PGlite> {
  const db = await baseDePrueba();
  await db.exec(`
    create table public.eos_goal_commands (
      id serial primary key, accion text default 'CREAR_OBJETIVO', payload jsonb,
      estado text default 'pendiente', error text);
    create table public.eos_goals (
      id serial primary key, valor_inicial numeric, valor_actual numeric, valor_objetivo numeric,
      prioridad smallint, fecha_inicio date, fecha_limite date, progreso int, confianza numeric,
      meses_cobertura smallint);
    create table public.eos_goal_milestones (peso numeric, orden smallint, fecha_limite date);

    create function public.procesar_como_v2() returns trigger language plpgsql as $$
    declare datos jsonb := new.payload; h jsonb;
    begin
      insert into public.eos_goals (valor_inicial, valor_actual, valor_objetivo, prioridad,
        fecha_inicio, fecha_limite, progreso, confianza, meses_cobertura) values (
        nullif(datos ->> 'valor_inicial', '')::numeric,
        nullif(datos ->> 'valor_actual', '')::numeric,
        nullif(datos ->> 'valor_objetivo', '')::numeric,
        greatest(1, least(5, coalesce(nullif(datos ->> 'prioridad', '')::smallint, 3))),
        coalesce(nullif(datos ->> 'fecha_inicio', '')::date, current_date),
        nullif(datos ->> 'fecha_limite', '')::date,
        greatest(0, least(100, coalesce(nullif(datos ->> 'progreso', '')::integer, 0))),
        greatest(0, least(1, coalesce(nullif(datos ->> 'confianza', '')::numeric, 1))),
        nullif(datos ->> 'meses_cobertura', '')::smallint);
      for h in select value from jsonb_array_elements(
        case when jsonb_typeof(datos -> 'hitos') = 'array' then datos -> 'hitos' else '[]'::jsonb end) loop
        insert into public.eos_goal_milestones values (
          greatest(0.0001, coalesce(nullif(h ->> 'peso', '')::numeric, 1)),
          coalesce(nullif(h ->> 'orden', '')::smallint, 0),
          nullif(h ->> 'fecha_limite', '')::date);
      end loop;
      update public.eos_goal_commands set estado = 'procesado' where id = new.id;
      return new;
    exception when others then
      update public.eos_goal_commands set estado = 'error', error = sqlerrm where id = new.id;
      return new;
    end $$;

    create trigger eos_goal_command_process_after_insert after insert on public.eos_goal_commands
      for each row execute function public.procesar_como_v2();
  `);
  if (conV211) await db.exec(migracion("20260929150000"));
  return db;
}

async function crear(db: PGlite, payload: unknown) {
  await db.query("insert into public.eos_goal_commands (payload) values ($1)", [payload]);
  const comando = (await db.query<{ estado: string; error: string | null }>(
    "select estado, error from public.eos_goal_commands order by id desc limit 1",
  )).rows[0];
  const objetivo = (await db.query<Record<string, unknown>>(
    `select valor_inicial::float, valor_actual::float, valor_objetivo::float, prioridad::int,
            fecha_inicio::text, fecha_limite::text, progreso::int, confianza::float, meses_cobertura::int
       from public.eos_goals order by id desc limit 1`,
  )).rows[0];
  return { comando, objetivo };
}

const CASOS: [string, Record<string, unknown>, Record<string, unknown>][] = [
  ["punto de miles", { valor_objetivo: "3.000.000", valor_inicial: "Gs. 500.000" }, { valor_objetivo: 3000000, valor_inicial: 500000 }],
  ["millones y mil", { valor_objetivo: "3 millones", valor_actual: "500 mil" }, { valor_objetivo: 3000000, valor_actual: 500000 }],
  ["coma decimal", { valor_objetivo: "3,5 millones", confianza: "0,8" }, { valor_objetivo: 3500000, confianza: 0.8 }],
  ["coma de miles", { valor_objetivo: "3,000,000" }, { valor_objetivo: 3000000 }],
  ["punto decimal y de miles", { valor_objetivo: "1.5", valor_actual: "1.500" }, { valor_objetivo: 1.5, valor_actual: 1500 }],
  ["día/mes/año", { fecha_limite: "31/12/2026", fecha_inicio: "2026-10-01" }, { fecha_limite: "2026-12-31", fecha_inicio: "2026-10-01" }],
  ["lo ilegible cae al valor por defecto", { fecha_limite: "31/02/2026", prioridad: "alta", progreso: "10%" }, { fecha_limite: null, prioridad: 3, progreso: 10 }],
  ["meses de cobertura", { meses_cobertura: "6 meses" }, { meses_cobertura: 6 }],
];

test("sin la v211, los montos y fechas escritos a la paraguaya rompen el objetivo", async () => {
  const db = await baseConObjetivos(false);
  let errores = 0;
  for (const [, payload] of CASOS) {
    if ((await crear(db, payload)).comando.estado === "error") errores++;
  }
  // Si esto deja de fallar, cambió la función real o este reflejo de ella.
  assert.ok(errores >= 6, `solo ${errores} de ${CASOS.length} fallaron sin la v211`);
});

for (const [nombre, payload, esperado] of CASOS) {
  test(`con la v211: ${nombre}`, async () => {
    const db = await baseConObjetivos(true);
    const { comando, objetivo } = await crear(db, payload);
    assert.equal(comando.estado, "procesado", comando.error ?? "");
    for (const [campo, valor] of Object.entries(esperado)) {
      assert.equal(objetivo[campo], valor, campo);
    }
  });
}

test("con la v211: los hitos también se normalizan, y un peso ilegible usa el de siempre", async () => {
  const db = await baseConObjetivos(true);
  const { comando } = await crear(db, {
    hitos: [
      { titulo: "a", peso: "1,5", orden: "2", fecha_limite: "15/11/2026" },
      { titulo: "b", peso: "mucho" },
    ],
  });
  assert.equal(comando.estado, "procesado", comando.error ?? "");
  const { rows } = await db.query<{ peso: number; orden: number; fecha_limite: string | null }>(
    "select peso::float, orden::int, fecha_limite::text from public.eos_goal_milestones order by orden desc",
  );
  assert.deepEqual(rows, [
    { peso: 1.5, orden: 2, fecha_limite: "2026-11-15" },
    { peso: 1, orden: 0, fecha_limite: null },
  ]);
});

test("con la v211: nadie de afuera puede llamar a las funciones", async () => {
  const db = await baseConObjetivos(true);
  for (const rol of ["anon", "authenticated"]) {
    const { rows } = await db.query<{ puede: boolean }>(
      "select has_function_privilege($1, 'public.eos_goal_numero_v211(text)', 'execute') as puede",
      [rol],
    );
    assert.equal(rows[0].puede, false, rol);
  }
});
