import assert from "node:assert/strict";
import test from "node:test";

import { armarPresupuesto, diasDelMes } from "./presupuesto.ts";

const BASE = {
  hoy: "2026-09-15",
  ingresoEsperado: 5_000_000,
  obligaciones: [
    { descripcion: "Alquiler", monto: 1_800_000 },
    { descripcion: "Cuota del auto", monto: 300_000 },
  ],
  porcentajeAhorro: 16,
  gastosDelMes: [] as number[],
  totalesPorMes: [] as number[],
};

test("el presupuesto sale de lo que EOS ya sabe, sin pedirle nada al usuario", () => {
  const p = armarPresupuesto(BASE);

  assert.equal(p.ingreso_esperado, 5_000_000);
  assert.equal(p.obligaciones, 2_100_000);
  assert.equal(p.ahorro, 800_000);
  // 5.000.000 − 2.100.000 − 800.000
  assert.equal(p.para_el_dia_a_dia, 2_100_000);
});

test("el ahorro sale del ingreso, no de lo que sobra", () => {
  /*
   * Si saliera de lo que sobra, nunca sobraría nada: las obligaciones se
   * comerían el ahorro todos los meses y el objetivo no avanzaría jamás. Es la
   * misma regla que usa el disponible real.
   */
  const apretado = armarPresupuesto({ ...BASE, obligaciones: [{ descripcion: "Alquiler", monto: 4_500_000 }] });

  assert.equal(apretado.ahorro, 800_000);
  assert.equal(apretado.para_el_dia_a_dia, -300_000);
});

test("el margen sale de lo que la persona suele gastar, no de un porcentaje inventado", () => {
  const p = armarPresupuesto({ ...BASE, totalesPorMes: [1_900_000, 1_700_000, 1_800_000] });

  assert.equal(p.gasto_habitual, 1_800_000);
  // 2.100.000 para el día a día − 1.800.000 que suele gastar
  assert.equal(p.margen, 300_000);
});

test("sin historial no hay margen, y no se inventa uno", () => {
  /*
   * Un margen inventado es peor que ninguno: alguien podría gastar hasta el
   * límite creyendo que tiene un colchón que nadie calculó.
   */
  const p = armarPresupuesto(BASE);

  assert.equal(p.gasto_habitual, null);
  assert.equal(p.margen, null);
  assert.match(p.confianza.motivos.join(" "), /cuánto gastás normalmente/);
});

test("el hábito usa la mediana: un mes con una compra grande no lo arrastra", () => {
  // Tres meses normales y uno con un pasaje. El promedio daría 2.475.000 y
  // haría creer que esa persona gasta mucho más de lo que gasta.
  const p = armarPresupuesto({
    ...BASE,
    totalesPorMes: [1_800_000, 1_900_000, 1_800_000, 4_400_000],
  });

  assert.equal(p.gasto_habitual, 1_850_000);
});

test("el ritmo se mide sobre los días vividos, no sobre los del mes", () => {
  /*
   * Dividir por 30 el día 15 diría que esa persona gasta la mitad de lo que
   * gasta, y la proyección de cierre saldría siempre optimista.
   */
  const p = armarPresupuesto({ ...BASE, gastosDelMes: [900_000] });

  assert.equal(p.dias_transcurridos, 15);
  assert.equal(p.dias_restantes, 15);
  assert.equal(p.ritmo_diario, 60_000);
  // 900.000 llevados + 60.000 por día durante los 15 que faltan
  assert.equal(p.proyeccion_cierre, 1_800_000);
});

test("avisa cuando el ritmo actual no entra en lo que hay", () => {
  const holgado = armarPresupuesto({ ...BASE, gastosDelMes: [900_000] });
  assert.equal(holgado.alcanza, true);

  // Mismo mes, mismo día, gastando el triple.
  const apurado = armarPresupuesto({ ...BASE, gastosDelMes: [2_700_000] });
  assert.equal(apurado.proyeccion_cierre, 5_400_000);
  // Hay 4.200.000 para gastar (5.000.000 menos el ahorro): no entra.
  assert.equal(apurado.alcanza, false);
});

test("una devolución baja lo consumido y con eso el ritmo", () => {
  // El otro lado de la v141: los negativos restan solos también acá.
  const p = armarPresupuesto({ ...BASE, gastosDelMes: [900_000, -200_000] });

  assert.equal(p.consumido, 700_000);
  assert.equal(p.ritmo_diario, 46_666.67);
});

test("los primeros días del mes la confianza baja, porque la proyección salta", () => {
  /*
   * Un gasto de 300.000 el día 2 proyecta un cierre de 4.500.000 que no va a
   * pasar. El número se muestra igual —esconderlo sería peor— pero con la
   * advertencia al lado.
   */
  const temprano = armarPresupuesto({ ...BASE, hoy: "2026-09-02", gastosDelMes: [300_000] });

  assert.ok(temprano.confianza.nivel < 1);
  assert.match(temprano.confianza.motivos.join(" "), /recién empieza/);
});

test("sin ingreso conocido lo dice en vez de presupuestar sobre cero", () => {
  const p = armarPresupuesto({ ...BASE, ingresoEsperado: 0 });

  assert.ok(p.confianza.nivel <= 0.5);
  assert.match(p.confianza.motivos.join(" "), /cuánto cobrás/);
});

test("los meses cortos y los bisiestos salen del calendario, no de una tabla", () => {
  assert.equal(diasDelMes("2026-02-10").total, 28);
  assert.equal(diasDelMes("2028-02-10").total, 29);
  assert.equal(diasDelMes("2026-04-30").total, 30);
  assert.equal(diasDelMes("2026-12-31").restantes, 0);
});
