import assert from "node:assert/strict";
import { test } from "node:test";

import { armarPanorama, tramoHastaElProximoIngreso } from "./panorama.ts";
import { detectarRiesgo } from "./riesgo.ts";
import type { Deuda } from "./deudas.ts";

const HOY = "2026-08-24";
const HASTA = "2026-10-08";

function base() {
  return {
    hoy: HOY,
    hasta: HASTA,
    saldoInicial: 5_000_000,
    saldoInicialFecha: "2026-08-01",
    reservaMinima: 1_000_000,
    movimientos: [],
    conciliaciones: [],
    fijos: [],
    deudas: [],
  };
}

const PRESTAMO: Deuda = {
  acreedor: "Banco Itaú",
  tipo: "prestamo",
  moneda: "PYG",
  saldo_declarado: 6_000_000,
  saldo_declarado_el: "2026-08-01",
  cuota_monto: 500_000,
  cuota_dia: 5,
  cuotas_totales: 12,
  cuotas_pagadas: 0,
  vence_el: null,
  estado: "al_dia",
  preocupa: false,
};

test("las cuotas de las deudas entran a la línea de tiempo", () => {
  const panorama = armarPanorama({ ...base(), deudas: [PRESTAMO] });

  const fechas = panorama.egresos.map((e) => e.fecha);
  assert.deepEqual(fechas, ["2026-09-05", "2026-10-05"]);
  assert.equal(panorama.egresos[0].monto, 500_000);
});

test("los fijos declarados también entran, aunque nunca se hayan visto", () => {
  const panorama = armarPanorama({
    ...base(),
    fijos: [{ tipo: "gasto", descripcion: "Alquiler", monto: 2_000_000, dia_del_mes: 1 }],
  });

  assert.ok(panorama.egresos.some((e) => e.descripcion === "Alquiler" && e.monto === 2_000_000));
});

test("un ingreso fijo declarado queda del lado de los ingresos", () => {
  const panorama = armarPanorama({
    ...base(),
    fijos: [{ tipo: "ingreso", descripcion: "Sueldo", monto: 4_000_000, dia_del_mes: 30 }],
  });

  assert.equal(panorama.egresos.length, 0);
  assert.ok(panorama.ingresos.some((i) => i.monto === 4_000_000));
});

test("la cuota NO se cuenta dos veces si además está anotada como compromiso", () => {
  // Es el escenario real: el débito llega por correo y además la deuda la
  // proyecta. Contarla dos veces produciría una alerta que no corresponde.
  const panorama = armarPanorama({
    ...base(),
    deudas: [PRESTAMO],
    movimientos: [
      { tipo: "compromiso", monto: 500_000, fecha: "2026-09-05", descripcion: "DEB.AUT.PRESTAMO" },
    ],
  });

  const enSeptiembre = panorama.egresos.filter((e) => e.fecha.startsWith("2026-09"));
  assert.equal(enSeptiembre.length, 1);
});

test("el saldo de partida descuenta lo que ya salió", () => {
  const panorama = armarPanorama({
    ...base(),
    movimientos: [
      { tipo: "gasto", monto: 1_500_000, fecha: "2026-08-10", descripcion: "Compra" },
      { tipo: "ingreso", monto: 200_000, fecha: "2026-08-12", descripcion: "Cobro" },
    ],
  });

  assert.equal(panorama.saldoActual, 5_000_000 - 1_500_000 + 200_000);
});

test("de punta a punta: declara un alquiler que no va a poder pagar y EOS lo ve", () => {
  // El caso que la hoja de ruta pone como ejemplo, armado con datos reales
  // del modelo: saldo bajo, alquiler declarado, sueldo que entra después.
  const panorama = armarPanorama({
    ...base(),
    saldoInicial: 1_500_000,
    reservaMinima: 0,
    fijos: [
      { tipo: "gasto", descripcion: "Alquiler", monto: 2_000_000, dia_del_mes: 28 },
      { tipo: "ingreso", descripcion: "Sueldo", monto: 4_500_000, dia_del_mes: 30 },
    ],
  });

  const riesgo = detectarRiesgo({
    hoy: HOY,
    saldoActual: panorama.saldoActual,
    reservaMinima: panorama.reservaMinima,
    egresos: panorama.egresos,
    ingresos: panorama.ingresos,
  });

  assert.equal(riesgo?.fecha, "2026-08-28");
  assert.equal(riesgo?.faltante, 500_000);
  assert.equal(riesgo?.alivio?.dias_tarde, 2);
});

test("de punta a punta: con el sueldo antes del alquiler, no hay aviso", () => {
  const panorama = armarPanorama({
    ...base(),
    saldoInicial: 1_500_000,
    reservaMinima: 0,
    fijos: [
      { tipo: "gasto", descripcion: "Alquiler", monto: 2_000_000, dia_del_mes: 28 },
      { tipo: "ingreso", descripcion: "Sueldo", monto: 4_500_000, dia_del_mes: 26 },
    ],
  });

  const riesgo = detectarRiesgo({
    hoy: HOY,
    saldoActual: panorama.saldoActual,
    reservaMinima: panorama.reservaMinima,
    egresos: panorama.egresos,
    ingresos: panorama.ingresos,
  });

  assert.equal(riesgo, null);
});

test("cada egreso dice de dónde salió", () => {
  // El panel muestra los tres grupos por separado, y para eso necesita poder
  // distinguirlos DESPUÉS de que se mezclaron en la línea de tiempo. Sin la
  // etiqueta habría que rehacer el armado afuera, que es exactamente el
  // problema que este módulo vino a resolver.
  const panorama = armarPanorama({
    ...base(),
    deudas: [PRESTAMO],
    fijos: [{ tipo: "gasto", descripcion: "Alquiler", monto: 2_000_000, dia_del_mes: 1 }],
    movimientos: [
      { tipo: "compromiso", monto: 300_000, fecha: "2026-09-20", descripcion: "Seguro del auto" },
    ],
  });

  const fuentes = new Map(panorama.egresos.map((e) => [e.descripcion, e.fuente]));

  assert.equal(fuentes.get("Alquiler"), "previsible");
  assert.equal(fuentes.get("Seguro del auto"), "anotado");
  assert.equal(fuentes.get("Cuota 1 de 12 — Banco Itaú"), "cuota");

  // Ninguno puede quedar sin etiqueta: un egreso sin fuente desaparecería de
  // los tres grupos del panel y el total dejaría de cerrar contra el saldo.
  assert.ok(panorama.egresos.every((e) => e.fuente));
});

test("lo que el panel descuenta es lo mismo que la alerta simula", () => {
  // La regresión que este módulo cierra: mientras el panel sumaba lo suyo y la
  // alerta lo suyo, el panel no contaba las cuotas. El usuario leía "estás
  // bien" en una pantalla y "el 28 no te alcanza" en la otra.
  const panorama = armarPanorama({
    ...base(),
    saldoInicial: 2_000_000,
    reservaMinima: 0,
    deudas: [PRESTAMO],
  });

  const totalDescontado = panorama.egresos.reduce((t, e) => t + e.monto, 0);
  const porGrupos = (["anotado", "previsible", "cuota"] as const).reduce(
    (t, fuente) =>
      t + panorama.egresos.filter((e) => e.fuente === fuente).reduce((s, e) => s + e.monto, 0),
    0,
  );

  assert.equal(porGrupos, totalDescontado);
  assert.ok(totalDescontado > 0, "la deuda tiene que aparecer en el descuento");
});

test("la conciliación viaja con el panorama, no se recalcula afuera", () => {
  const panorama = armarPanorama({
    ...base(),
    movimientos: [
      { tipo: "gasto", monto: 800_000, fecha: "2026-08-10", descripcion: "Compra" },
      { tipo: "ingreso", monto: 300_000, fecha: "2026-08-12", descripcion: "Cobro" },
    ],
  });

  assert.equal(panorama.aplicado.gastos, 800_000);
  assert.equal(panorama.aplicado.ingresos, 300_000);
  assert.equal(panorama.conciliacion.base, 5_000_000);
});

test("una cuota ya pagada hace días no se vuelve a proyectar", () => {
  /*
   * Encontrado el 8 de septiembre de 2026 verificando el presupuesto contra
   * datos reales: se registró "pagué la cuota de Ueno" el día 8 y el
   * calendario la seguía mostrando pendiente el 10, porque los compromisos
   * anotados solo miraban movimientos con fecha FUTURA.
   *
   * Es el error que este módulo tiene prohibido causar: la misma plata
   * descontada dos veces, una como gasto hecho y otra como compromiso por
   * venir. A alguien endeudado eso le dice que está peor de lo que está.
   */
  const panorama = armarPanorama({
    hoy: "2026-09-08",
    hasta: "2026-09-30",
    saldoInicial: 3_000_000,
    saldoInicialFecha: "2026-09-01",
    reservaMinima: 0,
    movimientos: [
      { tipo: "gasto", monto: 800_000, fecha: "2026-09-08", descripcion: "Pago de deuda — Ueno" },
    ],
    conciliaciones: [],
    fijos: [],
    deudas: [
      {
        acreedor: "Ueno",
        tipo: "prestamo",
        moneda: "PYG",
        saldo_declarado: 7_200_000,
        cuota_monto: 800_000,
        cuota_dia: 10,
        cuotas_totales: null,
        cuotas_pagadas: 1,
        vence_el: null,
        estado: "al_dia",
      } as never,
    ],
  });

  const cuotasDeSeptiembre = panorama.egresos.filter(
    (e) => e.fuente === "cuota" && e.fecha.startsWith("2026-09"),
  );

  assert.equal(
    cuotasDeSeptiembre.length,
    0,
    "la cuota de septiembre ya se pagó el 8 y se volvió a proyectar para el 10",
  );
});

test("un gasto cualquiera de la semana NO tapa una cuota que sí viene", () => {
  // El otro lado: el filtro exige que coincidan importe y fecha, así que una
  // compra suelta no puede hacer desaparecer una obligación real.
  const panorama = armarPanorama({
    hoy: "2026-09-08",
    hasta: "2026-09-30",
    saldoInicial: 3_000_000,
    saldoInicialFecha: "2026-09-01",
    reservaMinima: 0,
    movimientos: [
      { tipo: "gasto", monto: 120_000, fecha: "2026-09-07", descripcion: "supermercado" },
    ],
    conciliaciones: [],
    fijos: [],
    deudas: [
      {
        acreedor: "Ueno",
        tipo: "prestamo",
        moneda: "PYG",
        saldo_declarado: 7_200_000,
        cuota_monto: 800_000,
        cuota_dia: 10,
        cuotas_totales: null,
        cuotas_pagadas: 1,
        vence_el: null,
        estado: "al_dia",
      } as never,
    ],
  });

  assert.ok(
    panorama.egresos.some((e) => e.fuente === "cuota" && e.fecha === "2026-09-10"),
    "la cuota del 10 desapareció por una compra de supermercado del 7",
  );
});

test("las tarjetas entran en la línea de tiempo por el mismo filtro que las cuotas", () => {
  const panorama = armarPanorama({
    hoy: "2026-09-08",
    hasta: "2026-10-31",
    saldoInicial: 5_000_000,
    saldoInicialFecha: "2026-09-01",
    reservaMinima: 0,
    movimientos: [],
    conciliaciones: [],
    fijos: [],
    deudas: [],
    obligacionesTarjeta: [
      {
        tipo: "gasto",
        descripcion: "Tarjeta — La azul",
        monto: 700_000,
        fecha: "2026-10-05",
        periodicidad: "mensual",
        confianza: 0.7,
      },
    ],
  });

  const tarjeta = panorama.egresos.find((e) => e.descripcion.startsWith("Tarjeta"));
  assert.ok(tarjeta, "la obligación de la tarjeta tiene que estar en los egresos");
  assert.equal(tarjeta?.fuente, "cuota");
  assert.equal(tarjeta?.monto, 700_000);
});

test("la misma tarjeta cargada como deuda Y como tarjeta se descuenta una sola vez", () => {
  /*
   * Antes de la v146 la única forma de cargar una tarjeta era como deuda de
   * tipo `tarjeta`. Quien ya lo hizo y ahora la carga en Tarjetas tendría la
   * obligación contada dos veces todos los meses: el disponible real le diría
   * que está 700.000 peor de lo que está.
   */
  const panorama = armarPanorama({
    hoy: "2026-09-08",
    hasta: "2026-10-31",
    saldoInicial: 5_000_000,
    saldoInicialFecha: "2026-09-01",
    reservaMinima: 0,
    movimientos: [],
    conciliaciones: [],
    fijos: [],
    deudas: [
      {
        acreedor: "Tarjeta Continental",
        tipo: "tarjeta",
        moneda: "PYG",
        saldo_declarado: 4_000_000,
        saldo_declarado_el: "2026-09-01",
        cuota_monto: 700_000,
        cuota_dia: 5,
        cuotas_totales: null,
        cuotas_pagadas: 0,
        vence_el: null,
        estado: "al_dia",
        preocupa: false,
      },
    ],
    obligacionesTarjeta: [
      {
        tipo: "gasto",
        descripcion: "Tarjeta — La azul",
        monto: 700_000,
        fecha: "2026-10-05",
        periodicidad: "mensual",
        confianza: 0.7,
      },
    ],
  });

  const enOctubre = panorama.egresos.filter((e) => e.fecha === "2026-10-05");
  assert.equal(enOctubre.length, 1);
});

test("un ingreso ya anotado a futuro cuenta, igual que un gasto anotado a futuro", () => {
  /*
   * Hasta la v147 esto era asimétrico: el gasto futuro entraba como `anotado`
   * y descontaba; el ingreso futuro no entraba en ningún lado.
   *
   * Se vio el 8 de septiembre de 2026 en una cuenta real: un documento cargó,
   * para el 20 de septiembre, un gasto de 65.000.000 y 130.000.000 de
   * ingresos. El panel restaba los 65 y no sumaba los 130.
   */
  const panorama = armarPanorama({
    hoy: "2026-09-08",
    hasta: "2026-10-31",
    saldoInicial: 15_500_000,
    saldoInicialFecha: "2026-09-01",
    reservaMinima: 0,
    movimientos: [
      { tipo: "gasto", monto: 65_000_000, fecha: "2026-09-20", descripcion: "Compra grande" },
      { tipo: "ingreso", monto: 60_000_000, fecha: "2026-09-20", descripcion: "200 unidades" },
      { tipo: "ingreso", monto: 5_000_000, fecha: "2026-09-20", descripcion: "30 unidades" },
    ],
    conciliaciones: [],
    fijos: [],
    deudas: [],
  });

  assert.equal(panorama.ingresos.length, 2);
  assert.equal(
    panorama.ingresos.reduce((t, i) => t + i.monto, 0),
    65_000_000,
  );
  assert.equal(panorama.egresos.filter((e) => e.fuente === "anotado").length, 1);
});

test("los ingresos vuelven ordenados por fecha, anotados y proyectados juntos", () => {
  // El primero de la lista es el próximo cobro de verdad, y varias pantallas
  // lo leen así. Si los anotados fueran al final, el panel diría que la
  // persona cobra recién dentro de un mes teniendo plata anotada para mañana.
  const panorama = armarPanorama({
    hoy: "2026-09-08",
    hasta: "2026-12-31",
    saldoInicial: 1_000_000,
    saldoInicialFecha: "2026-09-01",
    reservaMinima: 0,
    movimientos: [
      // Tres meses del mismo sueldo: EOS lo detecta como serie y lo proyecta.
      { tipo: "ingreso", monto: 4_200_000, fecha: "2026-06-30", descripcion: "Sueldo" },
      { tipo: "ingreso", monto: 4_200_000, fecha: "2026-07-30", descripcion: "Sueldo" },
      { tipo: "ingreso", monto: 4_200_000, fecha: "2026-08-30", descripcion: "Sueldo" },
      // Y un cobro suelto ya anotado para pasado mañana.
      { tipo: "ingreso", monto: 900_000, fecha: "2026-09-10", descripcion: "Trabajo extra" },
    ],
    conciliaciones: [],
    fijos: [],
    deudas: [],
  });

  assert.equal(panorama.ingresos[0].fecha, "2026-09-10");
  assert.equal(panorama.ingresos[0].monto, 900_000);
  // Y el sueldo proyectado sigue estando, no lo tapó el anotado.
  assert.ok(panorama.ingresos.some((i) => i.monto === 4_200_000));
});

test("un ingreso anotado no se duplica con la serie que lo detectó", () => {
  /*
   * `proyectar` recibe los futuros como `yaRegistrados`. Sin eso, el sueldo de
   * septiembre ya cargado aparecería dos veces —una anotado y otra
   * proyectado— y el panel diría que entra el doble.
   */
  const panorama = armarPanorama({
    hoy: "2026-09-08",
    hasta: "2026-10-05",
    saldoInicial: 1_000_000,
    saldoInicialFecha: "2026-09-01",
    reservaMinima: 0,
    movimientos: [
      { tipo: "ingreso", monto: 4_200_000, fecha: "2026-06-30", descripcion: "Sueldo" },
      { tipo: "ingreso", monto: 4_200_000, fecha: "2026-07-30", descripcion: "Sueldo" },
      { tipo: "ingreso", monto: 4_200_000, fecha: "2026-08-30", descripcion: "Sueldo" },
      { tipo: "ingreso", monto: 4_200_000, fecha: "2026-09-30", descripcion: "Sueldo" },
    ],
    conciliaciones: [],
    fijos: [],
    deudas: [],
  });

  const enSeptiembre = panorama.ingresos.filter((i) => i.fecha.startsWith("2026-09"));
  assert.equal(enSeptiembre.length, 1);
});

test("el tramo termina cuando entra plata, sin incluir ese día", () => {
  /*
   * La regla vivía escrita a mano en tres lugares —el panel, el pulso y la
   * foto diaria— y con `<=`. Una cuenta real con un gasto de 65.000.000 y
   * 130.000.000 de ingresos el mismo 20 de septiembre mostraba un disponible
   * de −49.500.000: restaba el gasto de ese día contra un saldo que no incluía
   * la entrada de ese mismo día.
   */
  const panorama = armarPanorama({
    hoy: "2026-09-08",
    hasta: "2026-10-31",
    saldoInicial: 15_500_000,
    saldoInicialFecha: "2026-09-01",
    reservaMinima: 0,
    movimientos: [
      { tipo: "gasto", monto: 65_000_000, fecha: "2026-09-20", descripcion: "Compra grande" },
      { tipo: "ingreso", monto: 60_000_000, fecha: "2026-09-20", descripcion: "Cobro" },
    ],
    conciliaciones: [],
    fijos: [],
    deudas: [],
  });

  const tramo = tramoHastaElProximoIngreso(panorama, "2026-09-08");

  assert.equal(tramo.horizonte, "2026-09-20");
  assert.equal(tramo.total, 0);
  assert.equal(panorama.saldoActual - tramo.total, 15_500_000);
});

test("un gasto anterior al cobro sí entra en el tramo", () => {
  // El corte es del día del ingreso, no una excusa para no contar nada.
  const panorama = armarPanorama({
    hoy: "2026-09-08",
    hasta: "2026-10-31",
    saldoInicial: 5_000_000,
    saldoInicialFecha: "2026-09-01",
    reservaMinima: 0,
    movimientos: [
      { tipo: "gasto", monto: 1_200_000, fecha: "2026-09-15", descripcion: "Alquiler" },
      { tipo: "ingreso", monto: 4_000_000, fecha: "2026-09-30", descripcion: "Sueldo" },
    ],
    conciliaciones: [],
    fijos: [],
    deudas: [],
  });

  const tramo = tramoHastaElProximoIngreso(panorama, "2026-09-08");

  assert.equal(tramo.horizonte, "2026-09-30");
  assert.equal(tramo.total, 1_200_000);
  assert.equal(tramo.egresos.length, 1);
});

test("sin ingreso a la vista el tramo es el ciclo por defecto", () => {
  const panorama = armarPanorama({
    hoy: "2026-09-08",
    hasta: "2026-12-31",
    saldoInicial: 5_000_000,
    saldoInicialFecha: "2026-09-01",
    reservaMinima: 0,
    movimientos: [{ tipo: "gasto", monto: 300_000, fecha: "2026-09-25", descripcion: "Seguro" }],
    conciliaciones: [],
    fijos: [],
    deudas: [],
  });

  const tramo = tramoHastaElProximoIngreso(panorama, "2026-09-08");

  assert.equal(tramo.proximoIngreso, null);
  assert.equal(tramo.horizonte, "2026-10-08");
  assert.equal(tramo.total, 300_000);
});
