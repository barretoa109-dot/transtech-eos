import assert from "node:assert/strict";
import test from "node:test";
import { calcular } from "../motor.ts";
import {
  DEFINICIONES_CRM,
  OPORTUNIDADES_ESTANCADAS,
  PIPELINE_PONDERADO,
  TASA_CONVERSION,
  VALOR_PIPELINE,
} from "./crm.ts";
import type { ActividadHecho, Hechos, OportunidadHecho } from "../tipos.ts";

const AGOSTO = { desde: "2026-08-01", hasta: "2026-08-31" };

function oportunidad(p: Partial<OportunidadHecho> & { id: string }): OportunidadHecho {
  return {
    id: p.id,
    etapa: p.etapa ?? "nueva",
    monto: p.monto ?? 1_000_000,
    moneda: p.moneda ?? "PYG",
    creado_en: p.creado_en ?? "2026-08-01",
    cerrada_en: p.cerrada_en ?? null,
  };
}

test("cada definición se declara instantanea salvo la tasa de conversión", () => {
  const instantaneas = DEFINICIONES_CRM.filter((d) => d.id !== "tasa_conversion");
  for (const def of instantaneas) assert.equal(def.instantanea, true);
  assert.equal(TASA_CONVERSION.instantanea, undefined);
});

test("valor_pipeline suma solo lo abierto, por moneda, igual que el embudo", () => {
  const hechos: Hechos = {
    oportunidades: [
      oportunidad({ id: "o1", etapa: "propuesta", monto: 5_000_000 }),
      oportunidad({ id: "o2", etapa: "ganada", monto: 3_000_000 }), // no cuenta: ya cerró
      oportunidad({ id: "o3", etapa: "nueva", monto: 1_000_000, moneda: "USD" }),
    ],
  };

  const resultados = calcular([VALOR_PIPELINE], hechos, AGOSTO);
  const pyg = resultados.find((r) => r.moneda === "PYG");
  const usd = resultados.find((r) => r.moneda === "USD");

  assert.equal(pyg?.valor, 5_000_000);
  assert.equal(usd?.valor, 1_000_000);
});

test("pipeline_ponderado pesa por probabilidad de etapa", () => {
  const hechos: Hechos = {
    oportunidades: [oportunidad({ id: "o1", etapa: "propuesta", monto: 1_000_000 })],
  };
  const [r] = calcular([PIPELINE_PONDERADO], hechos, AGOSTO);
  // "propuesta" pesa 0.5 en lib/crm/embudo.ts.
  assert.equal(r.valor, 500_000);
});

test("una foto del pipeline no se compara contra el período anterior", () => {
  const hechos: Hechos = {
    oportunidades: [oportunidad({ id: "o1", etapa: "nueva", monto: 1_000_000 })],
  };
  const [r] = calcular([VALOR_PIPELINE], hechos, AGOSTO);
  assert.equal(r.anterior, null);
  assert.equal(r.tendencia, "desconocida");
});

test("tasa_conversion cuenta lo cerrado en el período, y sí se compara contra el anterior", () => {
  const hechos: Hechos = {
    oportunidades: [
      oportunidad({ id: "o1", etapa: "ganada", cerrada_en: "2026-08-10" }),
      oportunidad({ id: "o2", etapa: "ganada", cerrada_en: "2026-08-15" }),
      oportunidad({ id: "o3", etapa: "perdida", cerrada_en: "2026-08-20" }),
      oportunidad({ id: "o4", etapa: "perdida", cerrada_en: "2026-07-05" }), // mes anterior
    ],
  };
  const [r] = calcular([TASA_CONVERSION], hechos, AGOSTO);
  // Agosto: 2 ganadas, 1 perdida -> 66,67%.
  assert.equal(Math.round((r.valor ?? 0) * 100) / 100, 66.67);
  // Julio: 0 ganadas, 1 perdida -> 0%.
  assert.equal(r.anterior, 0);
});

test("sin nada cerrado en el período, dice por qué en vez de un cero", () => {
  const hechos: Hechos = {
    oportunidades: [oportunidad({ id: "o1", etapa: "nueva" })],
  };
  const resultados = calcular([TASA_CONVERSION], hechos, AGOSTO);
  assert.deepEqual(resultados, []); // ninguna oportunidad se cerró nunca: no hay moneda que informar
});

test("oportunidades_estancadas cuenta desde la última actividad hecha, o desde que se creó si no hubo ninguna", () => {
  const actividades: ActividadHecho[] = [
    { oportunidad_id: "o1", fecha: "2026-08-25", hecha: true }, // 6 días antes del 31: al día
    { oportunidad_id: "o2", fecha: "2026-08-01", hecha: true }, // 30 días antes: estancada
    { oportunidad_id: "o2", fecha: "2026-08-05", hecha: false }, // no cuenta: no está hecha
  ];
  const hechos: Hechos = {
    oportunidades: [
      oportunidad({ id: "o1", etapa: "contactado", creado_en: "2026-01-01" }),
      oportunidad({ id: "o2", etapa: "propuesta", creado_en: "2026-01-01" }),
      // o3 nunca tuvo actividad: cuenta desde que se creó.
      oportunidad({ id: "o3", etapa: "nueva", creado_en: "2026-06-01" }),
      // o4 está ganada: no es candidata aunque esté vieja.
      oportunidad({ id: "o4", etapa: "ganada", creado_en: "2026-01-01" }),
    ],
    actividades,
  };

  const [r] = calcular([OPORTUNIDADES_ESTANCADAS], hechos, AGOSTO);
  assert.equal(r.valor, 2); // o2 y o3
});

test("sin actividades cargadas todavía, igual se puede calcular: no es un insumo obligatorio vacío", () => {
  const hechos: Hechos = {
    oportunidades: [oportunidad({ id: "o1", etapa: "nueva", creado_en: "2026-01-01" })],
    actividades: [],
  };
  const [r] = calcular([OPORTUNIDADES_ESTANCADAS], hechos, AGOSTO);
  assert.equal(r.valor, 1);
});
