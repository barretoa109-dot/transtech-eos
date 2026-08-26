import assert from "node:assert/strict";
import { test } from "node:test";

import { clasificar, desglosarGastos, type MovimientoGasto } from "./destinos.ts";

function gasto(descripcion: string | null, monto: number, extra: Partial<MovimientoGasto> = {}): MovimientoGasto {
  return { monto, fecha: "2026-08-12", descripcion, ...extra };
}

test("reconoce los servicios como los escribe un banco paraguayo", () => {
  assert.equal(clasificar("PAGO ANDE 08/2026"), "servicios");
  assert.equal(clasificar("Débito automático ESSAP"), "servicios");
  assert.equal(clasificar("TIGO HOGAR - internet"), "servicios");
});

test("ignora las tildes y las mayúsculas", () => {
  // El mismo comercio llega escrito de tres formas distintas según el correo.
  assert.equal(clasificar("FARMACIA PUNTO"), "salud");
  assert.equal(clasificar("Clínica del Sur"), "salud");
  assert.equal(clasificar("CLINICA DEL SUR"), "salud");
});

test("la cuota del colegio es educación, no una deuda", () => {
  // Las dos reglas contienen "cuota". El orden de REGLAS es lo que decide, y
  // equivocarse acá le diría al usuario que se endeuda cuando está educando.
  assert.equal(clasificar("Cuota escolar agosto"), "educacion");
  assert.equal(clasificar("Cuota préstamo personal"), "deudas");
});

test("no clasifica de más: lo que no entiende va a 'otros'", () => {
  // Preferimos un pendiente visible a una respuesta falsa.
  assert.equal(clasificar("TRANSF A JUAN P"), "otros");
  assert.equal(clasificar("compra 4521"), "otros");
  assert.equal(clasificar(null), "otros");
});

test("una palabra suelta no arrastra al gasto entero", () => {
  // "banco" o "pago" aparecen en casi toda descripción bancaria: si fueran
  // patrones, todo caería en el mismo rubro y el desglose no diría nada.
  assert.equal(clasificar("PAGO EN BANCO CONTINENTAL"), "otros");
});

test("la categoría cargada le gana a adivinar del texto", () => {
  // Cuando una integración traiga el rubro real, esa es mejor información.
  assert.equal(clasificar("COMPRA 8891", "mercado"), "mercado");
});

test("una categoría desconocida no se inventa un destino", () => {
  assert.equal(clasificar("TIGO HOGAR", "rubro_raro_del_banco"), "servicios");
  assert.equal(clasificar("COMPRA 8891", "rubro_raro_del_banco"), "otros");
});

test("suma por destino y calcula el peso de cada uno", () => {
  const desglose = desglosarGastos([
    gasto("PAGO ANDE", 300_000),
    gasto("ESSAP agosto", 100_000),
    gasto("Alquiler agosto", 600_000),
  ]);

  assert.equal(desglose.total, 1_000_000);
  assert.equal(desglose.cantidad, 3);

  const [primero, segundo] = desglose.destinos;
  assert.equal(primero.clave, "vivienda");
  assert.equal(primero.total, 600_000);
  assert.equal(primero.porcentaje, 60);
  assert.equal(segundo.clave, "servicios");
  assert.equal(segundo.total, 400_000);
  assert.equal(segundo.cantidad, 2);
});

test("'sin reconocer' va último aunque sea el más grande", () => {
  // Es una tarea pendiente de EOS, no un rubro de gasto del usuario.
  const desglose = desglosarGastos([gasto("TRANSF 8821", 5_000_000), gasto("PAGO ANDE", 200_000)]);

  assert.equal(desglose.destinos[0].clave, "servicios");
  assert.equal(desglose.destinos.at(-1)?.clave, "otros");
  assert.equal(desglose.sin_reconocer, 5_000_000);
});

test("compara contra el período anterior por destino", () => {
  const desglose = desglosarGastos(
    [gasto("PAGO ANDE", 500_000)],
    [gasto("PAGO ANDE", 300_000), gasto("Alquiler julio", 600_000)],
  );

  const servicios = desglose.destinos.find((d) => d.clave === "servicios");
  assert.equal(servicios?.antes, 300_000);
});

test("sin período anterior no inventa una comparación", () => {
  // Mostrar "bajó 100%" contra un mes que no existe sería mentir.
  const desglose = desglosarGastos([gasto("PAGO ANDE", 500_000)]);
  assert.equal(desglose.destinos[0].antes, null);
});

test("un importe roto no ensucia el desglose entero", () => {
  const desglose = desglosarGastos([
    gasto("PAGO ANDE", Number.NaN),
    gasto("Alquiler", -50_000),
    gasto("Alquiler agosto", 600_000),
  ]);

  assert.equal(desglose.total, 600_000);
  assert.equal(desglose.cantidad, 1);
});

test("un mes sin gastos devuelve un desglose vacío, no un error", () => {
  const desglose = desglosarGastos([]);
  assert.deepEqual(desglose, { total: 0, cantidad: 0, sin_reconocer: 0, destinos: [] });
});
