import assert from "node:assert/strict";
import test from "node:test";

import { armarFondo } from "./fondoEmergencia.ts";

const BASE = {
  esencialPorMes: [3_000_000, 3_200_000, 2_900_000],
  sinReconocerPorMes: [100_000, 120_000, 90_000],
  fijos: [{ descripcion: "Alquiler", monto: 1_800_000 }],
  cuotas: [{ descripcion: "Cuota — Financiera Ueno", monto: 800_000 }],
  fondoActual: 3_000_000,
  mesesElegidos: null as number | null,
  ingresoRegular: null as boolean | null,
};

test("no elige por la persona: le muestra lo que cuesta cada opción", () => {
  const f = armarFondo(BASE);

  assert.equal(f.meses_elegidos, null);
  assert.equal(f.meta, null);
  assert.deepEqual(
    f.opciones.map((o) => o.meses),
    [3, 6, 12],
  );
  // Con 3.000.000 de gasto esencial, seis meses son 18.000.000.
  assert.equal(f.opciones[1].meta, 18_000_000);
  assert.equal(f.opciones[1].falta, 15_000_000);
  assert.equal(f.opciones[1].aporte_mensual, 1_250_000);
});

test("el gasto esencial sale de la mediana de lo que EOS vio salir", () => {
  const f = armarFondo(BASE);

  assert.equal(f.gasto_esencial, 3_000_000);
  assert.equal(f.base, "observado");
  // 3.000.000 apartados sobre 3.000.000 de gasto: aguanta un mes.
  assert.equal(f.meses_cubiertos, 1);
});

test("si lo declarado supera a lo observado, manda lo declarado", () => {
  /*
   * Ninguna de las dos fuentes está completa: lo observado no ve el efectivo y
   * lo declarado no cubre el supermercado. En un fondo de emergencia quedarse
   * corto es el error caro, porque el número existe justo para el mes en que
   * no entra plata.
   */
  const f = armarFondo({
    ...BASE,
    esencialPorMes: [1_500_000],
    fijos: [{ descripcion: "Alquiler", monto: 2_000_000 }],
    cuotas: [{ descripcion: "Cuota", monto: 800_000 }],
  });

  assert.equal(f.gasto_esencial, 2_800_000);
  assert.equal(f.base, "declarado");
  assert.equal(f.detalle.length, 2);
  assert.equal(f.detalle[0].etiqueta, "Alquiler");
});

test("cuando elige, aparecen la meta, el faltante y el aporte", () => {
  const f = armarFondo({ ...BASE, mesesElegidos: 6 });

  assert.equal(f.meta, 18_000_000);
  assert.equal(f.falta, 15_000_000);
  assert.equal(f.aporte_mensual, 1_250_000);
});

test("un fondo ya completo no pide más aportes", () => {
  const f = armarFondo({ ...BASE, fondoActual: 20_000_000, mesesElegidos: 6 });

  assert.equal(f.falta, 0);
  assert.equal(f.aporte_mensual, 0);
  assert.ok(f.meses_cubiertos !== null && f.meses_cubiertos > 6);
});

test("sin gasto esencial conocido no hay meta ni opciones, y se dice", () => {
  const f = armarFondo({
    ...BASE,
    esencialPorMes: [],
    fijos: [],
    cuotas: [],
    mesesElegidos: 6,
  });

  assert.equal(f.gasto_esencial, 0);
  assert.equal(f.meses_cubiertos, null);
  assert.deepEqual(f.opciones, []);
  assert.equal(f.meta, null);
  assert.equal(f.confianza.nivel, 0);
  assert.match(f.confianza.motivos.join(" "), /cuánto te cuesta un mes de vida/);
});

test("la sugerencia solo aparece con un dato que la sostenga, y trae su motivo", () => {
  // Sin saber si el ingreso es regular, EOS no sugiere nada: "los expertos
  // recomiendan seis meses" no es un hecho sobre esta persona.
  assert.equal(armarFondo(BASE).sugerencia, null);

  const variable = armarFondo({ ...BASE, ingresoRegular: false });
  assert.equal(variable.sugerencia?.meses, 6);
  assert.match(variable.sugerencia?.porque ?? "", /varían/);

  const parejo = armarFondo({ ...BASE, ingresoRegular: true });
  assert.equal(parejo.sugerencia?.meses, 3);
});

test("lo que no se supo clasificar se informa, no se reparte a ojo", () => {
  const f = armarFondo({ ...BASE, sinReconocerPorMes: [900_000, 1_000_000, 800_000] });

  // No se sumó al gasto esencial.
  assert.equal(f.gasto_esencial, 3_000_000);
  assert.equal(f.sin_reconocer, 900_000);
  // Pero pesa lo suficiente como para bajar la confianza y decirlo.
  assert.ok(f.confianza.nivel < 1);
  assert.match(f.confianza.motivos.join(" "), /clasificar/);
});

test("con poca historia lo dice en vez de presentar la mediana como firme", () => {
  const f = armarFondo({ ...BASE, esencialPorMes: [3_000_000], sinReconocerPorMes: [0] });

  assert.ok(f.confianza.nivel < 1);
  assert.match(f.confianza.motivos.join(" "), /un mes de historia/);
});
