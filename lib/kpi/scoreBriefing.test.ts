import assert from "node:assert/strict";
import test from "node:test";
import { leerSeriesDeScore, sincronizarScoreDeBriefings } from "./scoreBriefing.ts";

/**
 * Un cliente de Supabase de mentira: guarda filas por tabla y entiende los
 * filtros que usa `scoreBriefing.ts`. Alcanza para comprobar el recorrido
 * completo —leer la historia, puntuar, escribir en los briefings— sin base.
 */
function clienteFalso(tablas: Record<string, Record<string, unknown>[]>) {
  const updates: { tabla: string; valores: Record<string, unknown>; filtros: [string, unknown][] }[] = [];

  function consulta(tabla: string) {
    const filtros: ((f: Record<string, unknown>) => boolean)[] = [];
    const eqs: [string, unknown][] = [];
    let rango: [number, number] | null = null;
    let actualizar: Record<string, unknown> | null = null;

    const q = {
      select: () => q,
      update: (v: Record<string, unknown>) => ((actualizar = v), q),
      eq: (c: string, v: unknown) => (eqs.push([c, v]), filtros.push((f) => f[c] === v), q),
      in: (c: string, v: unknown[]) => (filtros.push((f) => v.includes(f[c])), q),
      gte: (c: string, v: string) => (filtros.push((f) => String(f[c]) >= v), q),
      lte: (c: string, v: string) => (filtros.push((f) => String(f[c]) <= v), q),
      order: () => q,
      limit: () => q,
      range: (a: number, b: number) => ((rango = [a, b]), q),
      then: (ok: (r: { data: unknown; error: null }) => unknown) => {
        if (actualizar) {
          updates.push({ tabla, valores: actualizar, filtros: eqs });
          return Promise.resolve(ok({ data: null, error: null }));
        }
        let filas = (tablas[tabla] ?? []).filter((f) => filtros.every((p) => p(f)));
        if (rango) filas = filas.slice(rango[0], rango[1] + 1);
        return Promise.resolve(ok({ data: filas, error: null }));
      },
    };
    return q;
  }

  return { cliente: { from: consulta }, updates };
}

const USUARIO = "u1";

function foto(fecha: string, indicador: string, estado: string, usuario = USUARIO) {
  return { usuario_id: usuario, fecha, indicador, estado, moneda: "PYG", confianza: 1 };
}

test("arma el score personal de cada día desde la historia y lo escribe en los briefings en 0", async () => {
  const { cliente, updates } = clienteFalso({
    eos_kpi_historia_v105: [
      foto("2026-09-24", "pers_disponible_real", "alerta"),
      foto("2026-09-25", "pers_disponible_real", "bien"),
      foto("2026-09-25", "pers_utilizacion_tarjetas", "atencion"),
      // De otra cuenta: no puede colarse.
      foto("2026-09-25", "pers_disponible_real", "alerta", "otro"),
    ],
    eos_daily_briefings: [
      { id: "b24", usuario_id: USUARIO, briefing_date: "2026-09-24", score: 0 },
      { id: "b25", usuario_id: USUARIO, briefing_date: "2026-09-25", score: 0 },
      { id: "b23", usuario_id: USUARIO, briefing_date: "2026-09-23", score: 0 },
    ],
  });

  const series = await leerSeriesDeScore(cliente, USUARIO, "2026-01-01");
  assert.equal(series.filas, 3);
  assert.deepEqual(series.negocio, []);
  // 24: colchón en alerta (20). 25: colchón bien (100) y tarjetas en atención (55) → 78.
  assert.deepEqual(series.personal, [
    { fecha: "2026-09-24", score: 20 },
    { fecha: "2026-09-25", score: 78 },
  ]);

  await sincronizarScoreDeBriefings(cliente, USUARIO, series);

  // El 23 no tiene foto: no se toca. Los otros dos se corrigen, filtrados por la cuenta.
  assert.deepEqual(
    updates.map((u) => [u.valores.score, u.filtros]),
    [
      [20, [["id", "b24"], ["usuario_id", USUARIO]]],
      [78, [["id", "b25"], ["usuario_id", USUARIO]]],
    ],
  );
});

test("no reescribe un briefing que ya tiene el score correcto", async () => {
  const { cliente, updates } = clienteFalso({
    eos_kpi_historia_v105: [foto("2026-09-25", "pers_disponible_real", "bien")],
    eos_daily_briefings: [{ id: "b25", usuario_id: USUARIO, briefing_date: "2026-09-25", score: 100 }],
  });

  await sincronizarScoreDeBriefings(cliente, USUARIO, await leerSeriesDeScore(cliente, USUARIO, "2026-01-01"));
  assert.equal(updates.length, 0);
});

test("sin fotos puntuables no hay series y no se escribe nada", async () => {
  const { cliente, updates } = clienteFalso({
    eos_kpi_historia_v105: [foto("2026-09-25", "margen_bruto", "sin_datos")],
    eos_daily_briefings: [{ id: "b25", usuario_id: USUARIO, briefing_date: "2026-09-25", score: 0 }],
  });

  const series = await leerSeriesDeScore(cliente, USUARIO, "2026-01-01");
  assert.deepEqual([series.negocio, series.personal], [[], []]);
  await sincronizarScoreDeBriefings(cliente, USUARIO, series);
  assert.equal(updates.length, 0);
});
