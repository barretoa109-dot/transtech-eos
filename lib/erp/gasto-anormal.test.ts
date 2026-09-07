import test from "node:test";
import assert from "node:assert/strict";

import {
  detectarGastosAnormales,
  redactarGastoAnormal,
  REGLAS,
  type GastoHistorico,
} from "./gasto-anormal.ts";

const HOY = "2026-09-15";

let contador = 0;

function gasto(p: Partial<GastoHistorico> = {}): GastoHistorico {
  contador += 1;
  return {
    id: p.id ?? `g${String(contador).padStart(3, "0")}`,
    fecha: "2026-09-10",
    monto: 200_000,
    moneda: "PYG",
    categoria: "insumos",
    descripcion: "compra",
    ...p,
  };
}

/**
 * Un historial creíble: seis gastos de insumos repartidos en tres meses
 * anteriores, todos alrededor de doscientos mil. Es el mínimo que el detector
 * exige para opinar.
 */
function historialNormal(categoria = "insumos"): GastoHistorico[] {
  const fechas = [
    "2026-06-05", "2026-06-20",
    "2026-07-08", "2026-07-22",
    "2026-08-11", "2026-08-27",
  ];

  return fechas.map((fecha, i) =>
    gasto({ id: `h${i}`, fecha, categoria, monto: 180_000 + i * 10_000 }),
  );
}

const formatear = (m: number, c: string) => `${c} ${m.toLocaleString("es-PY")}`;

test("sin historial suficiente no opina", () => {
  // Un usuario nuevo recibiría un aviso por cada gasto de su primera semana.
  const hallazgos = detectarGastosAnormales({
    hoy: HOY,
    gastos: [
      gasto({ fecha: "2026-09-01", monto: 100_000 }),
      gasto({ fecha: "2026-09-10", monto: 5_000_000 }),
    ],
  });

  assert.deepEqual(hallazgos, []);
});

test("seis gastos pero en un solo mes tampoco alcanza", () => {
  const mismoMes = Array.from({ length: 6 }, (_, i) =>
    gasto({ id: `m${i}`, fecha: `2026-08-0${i + 1}`, monto: 200_000 }),
  );

  const hallazgos = detectarGastosAnormales({
    hoy: HOY,
    gastos: [...mismoMes, gasto({ fecha: "2026-09-10", monto: 5_000_000 })],
  });

  assert.deepEqual(hallazgos, []);
});

test("un gasto muy por encima de lo habitual sí se avisa", () => {
  const hallazgos = detectarGastosAnormales({
    hoy: HOY,
    gastos: [...historialNormal(), gasto({ id: "raro", fecha: "2026-09-10", monto: 4_000_000 })],
  });

  assert.equal(hallazgos.length, 1);
  assert.equal(hallazgos[0].clave, "raro");
  assert.equal(hallazgos[0].monto, 4_000_000);
  assert.equal(hallazgos[0].gastos_comparados, 6);
  assert.equal(hallazgos[0].meses_comparados, 3);
});

test("un gasto apenas más grande que lo habitual NO se avisa", () => {
  // Tres veces la mediana no alcanza: el tope es cuatro. Un detector que se
  // dispara con el triple avisa todos los meses y deja de leerse.
  const habitual = 205_000;
  const hallazgos = detectarGastosAnormales({
    hoy: HOY,
    gastos: [...historialNormal(), gasto({ fecha: "2026-09-10", monto: habitual * 3 })],
  });

  assert.deepEqual(hallazgos, []);
});

test("EL SEGURO ANUAL: el primer año se avisa, el segundo no", () => {
  /*
   * Es el caso que tuvo este detector apagado hasta ahora. La condición 4 —sin
   * precedente— es la que lo resuelve, y solo a partir del segundo pago: el
   * primero es indistinguible de un gasto anormal de verdad, y el detector no
   * pretende lo contrario.
   */
  const base = historialNormal("seguros");

  const primerAnio = detectarGastosAnormales({
    hoy: "2026-09-15",
    gastos: [...base, gasto({ id: "seguro-2026", fecha: "2026-09-10", monto: 4_000_000, categoria: "seguros" })],
  });

  assert.equal(primerAnio.length, 1, "el primero no se puede distinguir y se avisa");

  const segundoAnio = detectarGastosAnormales({
    hoy: "2027-09-15",
    ventanaDias: 30,
    gastos: [
      ...base,
      gasto({ id: "seguro-2026", fecha: "2026-09-10", monto: 4_000_000, categoria: "seguros" }),
      gasto({ id: "seguro-2027", fecha: "2027-09-10", monto: 4_400_000, categoria: "seguros" }),
    ],
  });

  assert.deepEqual(segundoAnio, [], "con el precedente del año pasado ya no es noticia");
});

test("el precedente vale aunque el monto no sea idéntico", () => {
  // El seguro del año siguiente casi nunca cuesta lo mismo. Exigir igualdad
  // haría que el precedente no sirva para nada.
  const base = historialNormal("seguros");

  const hallazgos = detectarGastosAnormales({
    hoy: "2027-09-15",
    gastos: [
      ...base,
      gasto({ id: "a", fecha: "2026-09-10", monto: 3_000_000, categoria: "seguros" }),
      gasto({ id: "b", fecha: "2027-09-10", monto: 5_000_000, categoria: "seguros" }),
    ],
  });

  assert.deepEqual(hallazgos, []);
});

test("un precedente demasiado chico no alcanza para callar el aviso", () => {
  // Si lo más grande de la categoría fue la quinta parte, esto sigue siendo
  // algo que no se parece a nada.
  const base = historialNormal("seguros");

  const hallazgos = detectarGastosAnormales({
    hoy: "2027-09-15",
    gastos: [
      ...base,
      gasto({ id: "a", fecha: "2026-09-10", monto: 900_000, categoria: "seguros" }),
      gasto({ id: "b", fecha: "2027-09-10", monto: 5_000_000, categoria: "seguros" }),
    ],
  });

  assert.equal(hallazgos.length, 1);
  assert.equal(hallazgos[0].clave, "b");
});

test("un gasto declarado como fijo no sorprende a nadie", () => {
  const hallazgos = detectarGastosAnormales({
    hoy: HOY,
    gastos: [...historialNormal("seguros"), gasto({ fecha: "2026-09-10", monto: 4_000_000, categoria: "seguros" })],
    fijos: [{ categoria: "Seguros", descripcion: null }],
  });

  assert.deepEqual(hallazgos, []);
});

test("el fijo se reconoce sin importar acentos ni mayúsculas", () => {
  const hallazgos = detectarGastosAnormales({
    hoy: HOY,
    gastos: [
      ...historialNormal("logistica"),
      gasto({ fecha: "2026-09-10", monto: 4_000_000, categoria: "Logística" }),
    ],
    fijos: [{ categoria: "logistica", descripcion: null }],
  });

  assert.deepEqual(hallazgos, []);
});

test("un movimiento marcado como recurrente no se avisa", () => {
  const hallazgos = detectarGastosAnormales({
    hoy: HOY,
    gastos: [
      ...historialNormal(),
      gasto({ fecha: "2026-09-10", monto: 4_000_000, recurrente: true }),
    ],
  });

  assert.deepEqual(hallazgos, []);
});

test("un número enorme en una categoría diminuta no mueve la aguja del mes", () => {
  /*
   * Cien mil guaraníes en una categoría cuya mediana es mil es "raro" y no le
   * cambia nada a nadie. Avisarlo es gastar la atención del usuario.
   */
  const chicos = [
    "2026-06-05", "2026-06-20", "2026-07-08",
    "2026-07-22", "2026-08-11", "2026-08-27",
  ].map((fecha, i) => gasto({ id: `c${i}`, fecha, categoria: "peaje", monto: 1_000 }));

  const hallazgos = detectarGastosAnormales({
    hoy: HOY,
    gastos: [
      ...chicos,
      gasto({ id: "peaje-raro", fecha: "2026-09-10", categoria: "peaje", monto: 100_000 }),
      // El resto del mes: el peaje raro queda muy por debajo del 15%.
      gasto({ id: "grande", fecha: "2026-09-11", categoria: "alquiler", monto: 5_000_000 }),
    ],
  });

  assert.deepEqual(hallazgos, []);
});

test("solo se avisan los gastos de la ventana, no todo el historial", () => {
  // Sin ventana, cada vez que alguien abre el panel recibiría los sustos de
  // hace dos años.
  const hallazgos = detectarGastosAnormales({
    hoy: HOY,
    gastos: [...historialNormal(), gasto({ id: "viejo", fecha: "2026-06-25", monto: 9_000_000 })],
  });

  assert.deepEqual(hallazgos, []);
});

test("cada moneda se compara contra la suya", () => {
  // Trescientos dólares no son raros porque los guaraníes ronden los 200.000.
  const hallazgos = detectarGastosAnormales({
    hoy: HOY,
    gastos: [...historialNormal(), gasto({ fecha: "2026-09-10", monto: 300, moneda: "USD" })],
  });

  assert.deepEqual(hallazgos, []);
});

test("solo mira los gastos anteriores, nunca los que vinieron después", () => {
  /*
   * Si mirara todo el historial, el mismo gasto daría un resultado distinto
   * según cuándo se corra el detector: mañana habría más datos "previos" que
   * el día que ocurrió. Un aviso que aparece y desaparece solo no se puede
   * explicar.
   */
  const conPosterior = detectarGastosAnormales({
    hoy: HOY,
    gastos: [
      ...historialNormal(),
      gasto({ id: "raro", fecha: "2026-09-10", monto: 4_000_000 }),
      gasto({ id: "otro-grande", fecha: "2026-09-12", monto: 4_200_000 }),
    ],
  });

  // El primero se avisa (no tenía precedente); el segundo ya lo tiene.
  assert.deepEqual(conPosterior.map((h) => h.clave), ["raro"]);
});

test("el aviso dice contra qué se comparó", () => {
  const [hallazgo] = detectarGastosAnormales({
    hoy: HOY,
    gastos: [
      ...historialNormal(),
      gasto({ id: "raro", fecha: "2026-09-10", monto: 4_000_000, descripcion: "Compra de vitrinas" }),
    ],
  });

  const texto = redactarGastoAnormal(hallazgo, formatear);

  assert.match(texto, /Compra de vitrinas/);
  assert.match(texto, /insumos/);
  assert.match(texto, /6 gastos en 3 meses/);
  // Sin esto, el aviso obliga a ir a buscar el historial a mano.
  assert.match(texto, /mayor hasta ahora/);
  assert.match(texto, /gasto fijo/);
});

test("las reglas son las declaradas, no otras", () => {
  // Si alguien las afloja para que un caso pase, que quede el commit.
  assert.equal(REGLAS.mesesMinimos, 3);
  assert.equal(REGLAS.gastosMinimos, 6);
  assert.equal(REGLAS.factor, 4);
  assert.equal(REGLAS.precedente, 0.5);
  assert.equal(REGLAS.parteDelMes, 0.15);
});
