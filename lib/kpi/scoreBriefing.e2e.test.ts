import assert from "node:assert/strict";
import test from "node:test";
import { asegurarFotoDeHoy, leerSeriesDeScore, sincronizarScoreDeBriefings } from "./scoreBriefing.ts";
import { politicasDesdeCuentas } from "../finanzas/capturarPulso.ts";

/**
 * El caso real que seguía en 0: una cuenta SIN Constitución Financiera, con el
 * saldo de sus cuentas personales cargado, una tarjeta y movimientos, y un
 * negocio sin ventas. El recorrido completo —foto de hoy, serie, escritura en
 * el briefing— tiene que terminar en un score distinto de 0.
 */

type Fila = Record<string, unknown>;

function base(tablas: Record<string, Fila[]>) {
  function consulta(tabla: string) {
    const filtros: ((f: Fila) => boolean)[] = [];
    let rango: [number, number] | null = null;
    let tope: number | null = null;
    let accion: { tipo: "update"; valores: Fila } | { tipo: "upsert"; filas: Fila[]; claves: string[] } | null = null;

    const q = {
      select: () => proxy,
      update: (valores: Fila) => ((accion = { tipo: "update", valores }), proxy),
      upsert: (filas: Fila[], o: { onConflict: string }) => (
        (accion = { tipo: "upsert", filas, claves: o.onConflict.split(",") }), proxy
      ),
      eq: (c: string, v: unknown) => (filtros.push((f) => f[c] === v), proxy),
      neq: (c: string, v: unknown) => (filtros.push((f) => f[c] !== v), proxy),
      in: (c: string, v: unknown[]) => (filtros.push((f) => v.includes(f[c])), proxy),
      gte: (c: string, v: string) => (filtros.push((f) => String(f[c]) >= v), proxy),
      lte: (c: string, v: string) => (filtros.push((f) => String(f[c]) <= v), proxy),
      order: () => proxy,
      limit: (n: number) => ((tope = n), proxy),
      range: (a: number, b: number) => ((rango = [a, b]), proxy),
      maybeSingle: () => proxy,
      then(ok: (r: { data: unknown; error: null }) => unknown) {
        const lista = (tablas[tabla] ??= []);
        const a = accion as typeof accion;
        if (a?.tipo === "upsert") {
          for (const nueva of a.filas) {
            const i = lista.findIndex((f) => a.claves.every((k) => f[k] === nueva[k]));
            if (i >= 0) lista[i] = { ...lista[i], ...nueva };
            else lista.push({ ...nueva });
          }
          return Promise.resolve(ok({ data: null, error: null }));
        }
        const elegidas = lista.filter((f) => filtros.every((p) => p(f)));
        if (a?.tipo === "update") {
          for (const f of elegidas) Object.assign(f, a.valores);
          return Promise.resolve(ok({ data: null, error: null }));
        }
        let data = elegidas;
        if (rango) data = data.slice(rango[0], rango[1] + 1);
        if (tope !== null) data = data.slice(0, tope);
        return Promise.resolve(ok({ data, error: null }));
      },
    };
    // Cualquier otro filtro (`or`, `not`, `is`…) lo usan solo las lecturas del
    // negocio, cuyas tablas están vacías en este caso: se aceptan y no filtran.
    const proxy: typeof q = new Proxy(q, {
      get: (t, k) => (k in t ? (t as Record<string | symbol, unknown>)[k] : () => proxy),
    });
    return proxy;
  }
  // Las funciones de la base (ventas, compras…) de un negocio sin movimiento: vacías.
  return { from: consulta, rpc: () => Promise.resolve({ data: [], error: null }) };
}

const U = "augusto";
const HOY = "2026-09-25";

test("sin Constitución pero con saldo en sus cuentas, el briefing deja de estar en 0", async () => {
  const tablas: Record<string, Fila[]> = {
    eos_usuario_modulos: [{ usuario_id: U, modulo_codigo: "erp", estado: "activo" }],
    eos_finanzas_politica: [],
    eos_finanzas_cuentas: [
      { usuario_id: U, ambito: "personal", activa: true, moneda: "PYG", saldo_declarado: 12_000_000, saldo_declarado_el: "2026-09-20" },
    ],
    eos_finanzas_tarjetas: [
      {
        id: "t1", usuario_id: U, ambito: "personal", activa: true, emisor: "Green", nombre: "Green",
        moneda: "PYG", linea_total: 10_000_000, saldo_utilizado: 9_500_000, saldo_al: "2026-09-20",
        dia_cierre: 25, dia_vencimiento: 6, pago_minimo: 500_000, pago_total: 9_500_000, resumen_al: "2026-09-01",
      },
    ],
    eos_movimientos_financieros: [
      { usuario_id: U, ambito: "personal", tipo: "ingreso", monto: 8_000_000, fecha: "2026-09-05", descripcion: "Sueldo" },
      { usuario_id: U, ambito: "personal", tipo: "gasto", monto: 2_000_000, fecha: "2026-09-10", descripcion: "Súper" },
    ],
    eos_daily_briefings: [
      { id: "b25", usuario_id: U, briefing_date: HOY, score: 0 },
      { id: "b24", usuario_id: U, briefing_date: "2026-09-24", score: 0 },
    ],
  };
  const admin = base(tablas);

  const diag = await asegurarFotoDeHoy(admin, U, HOY);
  assert.equal(diag.personal.habilitado, true, "las cuentas con saldo tienen que contar como Personal habilitado");
  assert.deepEqual(diag.personal.errores, []);
  assert.equal(diag.foto_hoy, "sacada");

  const series = await leerSeriesDeScore(admin, U, "2026-01-01");
  assert.equal(series.personal.length, 1, "tiene que haber un punto personal para hoy");
  assert.equal(series.personal[0].fecha, HOY);
  assert.ok(series.personal[0].score > 0, `el score personal no puede ser 0 (fue ${series.personal[0].score})`);

  await sincronizarScoreDeBriefings(admin, U, series);
  const hoy = tablas.eos_daily_briefings.find((b) => b.id === "b25")!;
  const ayer = tablas.eos_daily_briefings.find((b) => b.id === "b24")!;
  assert.equal(hoy.score, series.personal[0].score, "el briefing de hoy guarda el score real");
  assert.equal(ayer.score, 0, "el de ayer no tiene foto: no se inventa");
});

test("la política desde cuentas usa el saldo declarado y la declaración más reciente, sin reserva ni ahorro", () => {
  const [p] = politicasDesdeCuentas(
    [
      { usuario_id: U, moneda: "PYG", saldo_declarado: 3_000_000, saldo_declarado_el: "2026-09-10" },
      { usuario_id: U, moneda: "PYG", saldo_declarado: 2_000_000, saldo_declarado_el: "2026-09-18T10:00:00Z" },
      { usuario_id: U, moneda: "USD", saldo_declarado: 100, saldo_declarado_el: "2026-09-01" },
      { usuario_id: U, moneda: "PYG", saldo_declarado: null, saldo_declarado_el: null },
    ],
    HOY,
  );
  assert.deepEqual(p, {
    usuario_id: U,
    moneda: "PYG",
    saldo_inicial: 5_000_000,
    saldo_inicial_fecha: "2026-09-18",
    reserva_minima: 0,
    porcentaje_ahorro: 0,
    desde_cuentas: true,
  });
});

test("sin saldo declarado no se fotografía: sería una alarma falsa", () => {
  assert.deepEqual(politicasDesdeCuentas([{ usuario_id: U, moneda: "PYG", saldo_declarado: null }], HOY), []);
});
