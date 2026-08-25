import assert from "node:assert/strict";
import { test } from "node:test";

import {
  aCSV,
  resumirEnPalabras,
  resumirPeriodo,
  type MovimientoDelPeriodo,
} from "./periodoFiscal.ts";

const RANGO = { desde: "2026-08-01", hasta: "2026-08-31" };

function mov(parcial: Partial<MovimientoDelPeriodo> = {}): MovimientoDelPeriodo {
  return {
    tipo: "gasto",
    monto: 100_000,
    moneda: "PYG",
    fecha: "2026-08-15",
    descripcion: "Compra",
    categoria: null,
    origen: "correo",
    documento_id: null,
    ...parcial,
  };
}

test("suma ingresos y gastos por separado", () => {
  const r = resumirPeriodo(
    [
      mov({ tipo: "ingreso", monto: 3_000_000 }),
      mov({ tipo: "ingreso", monto: 500_000 }),
      mov({ tipo: "gasto", monto: 1_200_000 }),
    ],
    RANGO,
  );

  assert.equal(r.ingresos.total, 3_500_000);
  assert.equal(r.ingresos.cantidad, 2);
  assert.equal(r.gastos.total, 1_200_000);
});

test("deja afuera lo que está fuera del período", () => {
  const r = resumirPeriodo(
    [mov({ fecha: "2026-07-31" }), mov({ fecha: "2026-09-01" }), mov({ fecha: "2026-08-01" })],
    RANGO,
  );

  assert.equal(r.gastos.cantidad, 1);
});

test("los compromisos NO entran: una declaración es sobre lo que pasó", () => {
  const r = resumirPeriodo([mov({ tipo: "compromiso", monto: 5_000_000 }), mov()], RANGO);

  assert.equal(r.movimientos.length, 1);
  assert.equal(r.gastos.total, 100_000);
});

test("dice cuánto NO tiene comprobante, que es lo primero que pide el contador", () => {
  const r = resumirPeriodo(
    [
      mov({ monto: 700_000, origen: "documento" }),
      mov({ monto: 300_000, origen: "correo" }),
    ],
    RANGO,
  );

  assert.equal(r.sin_respaldo.total, 300_000);
  assert.equal(r.sin_respaldo.cantidad, 1);
  assert.equal(r.sin_respaldo.proporcion, 0.3);
});

test("un aviso bancario NO cuenta como comprobante", () => {
  // Prueba que la plata se movió, no qué se compró. Para el contador no
  // reemplaza a una factura, y decir lo contrario le haría creer al usuario
  // que está cubierto cuando no lo está.
  const r = resumirPeriodo([mov({ origen: "correo" })], RANGO);

  assert.equal(r.sin_respaldo.cantidad, 1);
});

test("un movimiento con documento_id sí cuenta", () => {
  const r = resumirPeriodo([mov({ origen: "chat", documento_id: "doc-1" })], RANGO);

  assert.equal(r.sin_respaldo.cantidad, 0);
});

test("agrupa los gastos por categoría, de mayor a menor", () => {
  const r = resumirPeriodo(
    [
      mov({ monto: 200_000, categoria: "Combustible" }),
      mov({ monto: 900_000, categoria: "Proveedores" }),
      mov({ monto: 100_000, categoria: "Combustible" }),
      mov({ monto: 50_000, categoria: null }),
    ],
    RANGO,
  );

  assert.deepEqual(r.por_categoria, [
    { categoria: "Proveedores", total: 900_000, cantidad: 1 },
    { categoria: "Combustible", total: 300_000, cantidad: 2 },
    { categoria: "Sin categoría", total: 50_000, cantidad: 1 },
  ]);
});

test("cuenta de dónde salió cada dato", () => {
  const r = resumirPeriodo(
    [mov({ origen: "correo" }), mov({ origen: "correo" }), mov({ origen: "chat" })],
    RANGO,
  );

  assert.deepEqual(r.por_origen, [
    { origen: "correo", cantidad: 2 },
    { origen: "chat", cantidad: 1 },
  ]);
});

/* ==================== CSV ==================== */

test("el CSV usa punto y coma, que es lo que abre Excel en español", () => {
  // Con coma, el archivo se abre como una sola columna y el contador lo
  // devuelve sin mirarlo.
  const csv = aCSV(resumirPeriodo([mov()], RANGO));
  const [encabezado] = csv.split("\r\n");

  assert.ok(encabezado.includes(";"));
  assert.equal(encabezado.split(";")[0], "Fecha");
});

test("una descripción con punto y coma no rompe las columnas", () => {
  const csv = aCSV(resumirPeriodo([mov({ descripcion: 'Pago a "El Sol"; cuota 2' })], RANGO));
  const fila = csv.split("\r\n")[1];

  assert.ok(fila.includes('"Pago a ""El Sol""; cuota 2"'), fila);
});

test("el CSV marca fila por fila qué tiene comprobante", () => {
  const csv = aCSV(
    resumirPeriodo([mov({ origen: "documento" }), mov({ origen: "correo" })], RANGO),
  );

  assert.ok(csv.includes("documento"));
  assert.ok(csv.includes("sin comprobante"));
});

/* ==================== EN PALABRAS ==================== */

test("le dice al usuario qué le falta, sin hablar de impuestos", () => {
  // EOS no dice "declarás X": eso es criterio del contador.
  const texto = resumirEnPalabras(
    resumirPeriodo(
      [
        mov({ tipo: "ingreso", monto: 5_000_000, origen: "documento" }),
        mov({ tipo: "gasto", monto: 5_000_000, origen: "correo" }),
      ],
      RANGO,
    ),
  );

  assert.match(texto, /no tiene comprobante/);
  assert.match(texto, /50%/);
  assert.ok(!/declar/i.test(texto), texto);
});

test("si está todo respaldado lo dice y no alarma", () => {
  const texto = resumirEnPalabras(
    resumirPeriodo([mov({ origen: "documento" })], RANGO),
  );

  assert.match(texto, /Todo tiene comprobante/);
});

test("un período vacío se declara vacío en vez de mostrar ceros", () => {
  assert.match(resumirEnPalabras(resumirPeriodo([], RANGO)), /no tengo ningún movimiento/);
});
