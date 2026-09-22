import assert from "node:assert/strict";
import { test } from "node:test";

import type { EstadoObjetivo } from "../finanzas/objetivos.ts";
import {
  CONSEJOS_FINANCIEROS,
  lineaDeConsejoFinanciero,
  lineaDeObjetivo,
  lineaPersonal,
  objetivoPrincipal,
} from "./consejoDeObjetivo.ts";

const base: EstadoObjetivo = {
  id: "o1",
  titulo: "Auto nuevo",
  clase: "general",
  moneda: "PYG",
  prioridad: 1,
  objetivo: 30_000_000,
  actual: 9_000_000,
  origen: "declarado",
  actual_al: "2026-09-01",
  falta: 21_000_000,
  progreso: 30,
  hasta: "2026-12-31",
  dias_restantes: 90,
  aportes_restantes: 3,
  aporte_necesario: 7_000_000,
  aporte_original: 5_000_000,
  aporte_real: 3_000_000,
  desvio: -4_000_000,
  llegada_estimada: null,
  estado: "atrasado",
  confianza: { nivel: 1, motivos: [] },
};

test("atrasado con los dos números dice exactamente cuánto hace falta apartar y cuánto se viene apartando", () => {
  const linea = lineaDeObjetivo(base);
  assert.match(linea, /Auto nuevo/);
  assert.match(linea, /30%/);
  assert.match(linea, /₲ 7\.000\.000/);
  assert.match(linea, /₲ 3\.000\.000/);
});

test("en ritmo no asusta: dice que alcanza con seguir así", () => {
  const linea = lineaDeObjetivo({ ...base, estado: "en_ritmo", aporte_necesario: 5_000_000 });
  assert.match(linea, /en ritmo/);
  assert.match(linea, /₲ 5\.000\.000/);
});

test("cumplido felicita y no habla de plata que falta", () => {
  const linea = lineaDeObjetivo({ ...base, estado: "cumplido", actual: 30_000_000, falta: 0 });
  assert.match(linea, /Ya llegaste/);
  assert.doesNotMatch(linea, /falta/i);
});

test("vencido no culpa: aclara que no se perdió lo ahorrado", () => {
  const linea = lineaDeObjetivo({ ...base, estado: "vencido" });
  assert.match(linea, /No se perdió nada/);
});

test("sin fecha invita a ponerle una, sin inventar un ritmo que no se puede calcular", () => {
  const linea = lineaDeObjetivo({ ...base, estado: "sin_fecha", hasta: null, aporte_necesario: null });
  assert.match(linea, /Ponerle una fecha/);
});

test("el consejo financiero rota por ciclo y nunca sale vacío", () => {
  const vistos = new Set<string>();
  for (let c = 0; c < CONSEJOS_FINANCIEROS.length; c += 1) {
    const linea = lineaDeConsejoFinanciero(c);
    assert.ok(linea.length > 10);
    vistos.add(linea);
  }
  assert.equal(vistos.size, CONSEJOS_FINANCIEROS.length);
  // Da la vuelta: el ciclo siguiente al último repite el primero.
  assert.equal(lineaDeConsejoFinanciero(CONSEJOS_FINANCIEROS.length), lineaDeConsejoFinanciero(0));
});

/* ------------------------------------------------------------------------ */
/* objetivoPrincipal / lineaPersonal, contra un cliente falso.               */
/* ------------------------------------------------------------------------ */

function clienteFalso(filas: Record<string, unknown>[]) {
  return {
    from(tabla: string) {
      const filtros: Record<string, unknown> = {};
      const q = {
        select: () => q,
        eq: (col: string, valor: unknown) => {
          filtros[col] = valor;
          return q;
        },
        order: () => q,
        limit: () => q,
        maybeSingle: async () => {
          if (tabla !== "eos_goals") return { data: null, error: null };
          const candidatas = filas.filter((f) =>
            Object.entries(filtros).every(([k, v]) => f[k] === v),
          );
          candidatas.sort((a, b) => Number(a.prioridad ?? 3) - Number(b.prioridad ?? 3));
          return { data: candidatas[0] ?? null, error: null };
        },
      };
      return q;
    },
  } as never;
}

test("sin ningún objetivo activo, cae al consejo del ciclo", async () => {
  const estado = await objetivoPrincipal(clienteFalso([]), "u1", "2026-09-21");
  assert.equal(estado, null);

  const linea = await lineaPersonal(clienteFalso([]), "u1", "2026-09-21", 4);
  assert.equal(linea, lineaDeConsejoFinanciero(4));
});

test("con un objetivo activo, la línea personal habla de él y no del consejo genérico", async () => {
  const fila = {
    id: "g1",
    usuario_id: "u1",
    ambito: "personal",
    estado: "activo",
    tipo_medicion: "monetario",
    titulo: "Fondo de emergencia",
    clase: "fondo_emergencia",
    moneda: "PYG",
    prioridad: 1,
    valor_objetivo: 10_000_000,
    valor_inicial: 0,
    valor_actual: 10_000_000,
    fecha_inicio: "2026-06-01",
    fecha_limite: "2026-08-01",
    ultima_actualizacion_at: "2026-09-01",
  };

  const linea = await lineaPersonal(clienteFalso([fila]), "u1", "2026-09-21", 4);
  assert.match(linea, /Fondo de emergencia/);
  assert.ok(!CONSEJOS_FINANCIEROS.includes(linea));
});

test("un objetivo con valor_objetivo en cero no se usa: no hay contra qué medir el progreso", async () => {
  const fila = {
    usuario_id: "u1",
    ambito: "personal",
    estado: "activo",
    tipo_medicion: "monetario",
    titulo: "Sin monto",
    clase: "general",
    moneda: "PYG",
    prioridad: 1,
    valor_objetivo: 0,
    valor_inicial: 0,
    valor_actual: 0,
    fecha_inicio: "2026-06-01",
    fecha_limite: null,
    ultima_actualizacion_at: null,
  };

  const estado = await objetivoPrincipal(clienteFalso([fila]), "u1", "2026-09-21");
  assert.equal(estado, null);
});

test("el objetivo de otra persona no aparece", async () => {
  const fila = {
    usuario_id: "u2",
    ambito: "personal",
    estado: "activo",
    tipo_medicion: "monetario",
    titulo: "Ajeno",
    clase: "general",
    moneda: "PYG",
    prioridad: 1,
    valor_objetivo: 1_000_000,
    valor_inicial: 0,
    valor_actual: 0,
    fecha_inicio: "2026-06-01",
    fecha_limite: null,
    ultima_actualizacion_at: null,
  };

  const estado = await objetivoPrincipal(clienteFalso([fila]), "u1", "2026-09-21");
  assert.equal(estado, null);
});
