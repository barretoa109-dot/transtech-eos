import assert from "node:assert/strict";
import test from "node:test";

import {
  estadoDeTarjeta,
  obligacionesDe,
  tarjetasRepetidasEnDeudas,
  type CompraEnCuotas,
  type Tarjeta,
} from "./tarjetas.ts";
import { sinDuplicar } from "./deudas.ts";

const HOY = "2026-09-08";

function tarjeta(cambios: Partial<Tarjeta> = {}): Tarjeta {
  return {
    id: "t1",
    emisor: "Banco Continental",
    nombre: "La azul",
    moneda: "PYG",
    linea_total: 10_000_000,
    saldo_utilizado: 4_000_000,
    saldo_al: HOY,
    dia_cierre: 20,
    dia_vencimiento: 5,
    pago_minimo: null,
    pago_total: null,
    resumen_al: null,
    ...cambios,
  };
}

function compra(cambios: Partial<CompraEnCuotas> = {}): CompraEnCuotas {
  return {
    id: "c1",
    tarjeta_id: "t1",
    descripcion: "Heladera",
    moneda: "PYG",
    monto_total: 6_000_000,
    monto_cuota: 500_000,
    cuotas_totales: 12,
    cuotas_pagadas: 4,
    primera_cuota: "2026-05-05",
    ...cambios,
  };
}

test("la línea, el saldo y la utilización salen de lo declarado", () => {
  const e = estadoDeTarjeta(tarjeta(), [], HOY);

  assert.equal(e.disponible, 6_000_000);
  assert.equal(e.utilizacion, 0.4);
  assert.equal(e.aprieta, false);
});

test("sin línea declarada no hay utilización inventada", () => {
  const e = estadoDeTarjeta(tarjeta({ linea_total: null }), [], HOY);

  assert.equal(e.disponible, null);
  assert.equal(e.utilizacion, null);
  assert.equal(e.aprieta, false);
  assert.match(e.confianza.motivos.join(" "), /no sé cuál es tu línea/);
});

test("avisa cuando la tarjeta dejó de ser un medio de pago", () => {
  const e = estadoDeTarjeta(tarjeta({ saldo_utilizado: 8_000_000 }), [], HOY);

  assert.equal(e.utilizacion, 0.8);
  assert.equal(e.aprieta, true);
});

test("el cierre y el vencimiento son días del mes, no fechas sueltas", () => {
  const e = estadoDeTarjeta(tarjeta(), [], HOY);

  // El 20 de este mes todavía no pasó; el 5 sí, así que el vencimiento es el
  // del mes que viene.
  assert.equal(e.proximo_cierre, "2026-09-20");
  assert.equal(e.proximo_vencimiento, "2026-10-05");
  assert.equal(e.dias_para_vencer, 27);
});

test("un vencimiento el 31 cae el último día de los meses que no lo tienen", () => {
  const e = estadoDeTarjeta(tarjeta({ dia_vencimiento: 31 }), [], "2026-11-01");

  assert.equal(e.proximo_vencimiento, "2026-11-30");
});

test("las compras en cuotas dicen en cuál va y cuándo se libera", () => {
  const e = estadoDeTarjeta(tarjeta(), [compra()], HOY);

  assert.equal(e.compras.length, 1);
  assert.equal(e.compras[0].cuota_actual, 5);
  assert.equal(e.compras[0].cuotas_restantes, 8);
  assert.equal(e.compras[0].falta, 4_000_000);
  // Primera en mayo y son doce: la última cae en abril del año que viene.
  assert.equal(e.compras[0].ultima_cuota, "2027-04-05");
  assert.equal(e.libre_desde, "2027-04-05");
});

test("una compra terminada de pagar no sigue comprometiendo cuotas", () => {
  const e = estadoDeTarjeta(tarjeta(), [compra({ cuotas_pagadas: 12 })], HOY);

  assert.equal(e.compras.length, 0);
  assert.equal(e.cuotas_por_mes, 0);
});

test("el resumen manda sobre las cuotas: incluye consumos que EOS no vio", () => {
  const e = estadoDeTarjeta(
    tarjeta({ pago_total: 2_300_000, pago_minimo: 400_000, resumen_al: "2026-09-01" }),
    [compra()],
    HOY,
  );

  assert.equal(e.a_pagar, 2_300_000);
  assert.equal(e.a_pagar_origen, "resumen");
  assert.equal(e.a_pagar_es_piso, false);
});

test("sin resumen las cuotas son un PISO, y queda dicho", () => {
  /*
   * En el mes casi con seguridad hubo compras de un solo pago que nadie cargó.
   * Presentar la suma de las cuotas como si fuera el total del resumen haría
   * que alguien pague de menos y entre en mora.
   */
  const e = estadoDeTarjeta(tarjeta(), [compra(), compra({ id: "c2", monto_cuota: 200_000 })], HOY);

  assert.equal(e.a_pagar, 700_000);
  assert.equal(e.a_pagar_origen, "cuotas");
  assert.equal(e.a_pagar_es_piso, true);
  assert.match(e.confianza.motivos.join(" "), /en el mes seguro hubo más/);
});

test("un resumen viejo no se usa como si fuera el de este ciclo", () => {
  // El del mes pasado leído como el de éste haría pagar el mínimo de un ciclo
  // que ya cerró.
  const e = estadoDeTarjeta(
    tarjeta({ pago_total: 2_300_000, resumen_al: "2026-06-01" }),
    [compra()],
    HOY,
  );

  assert.equal(e.a_pagar, 500_000);
  assert.equal(e.a_pagar_origen, "cuotas");
  assert.match(e.confianza.motivos.join(" "), /2026-06-01/);
});

/* ============================================================
 * Doble contabilización: la razón de ser de este módulo
 * ============================================================ */

test("las compras en cuotas NO se proyectan aparte del vencimiento", () => {
  /*
   * Es el error más caro posible acá. La cuota de la heladera ya está adentro
   * de lo que se paga el 5; emitirla además por separado descontaría 500.000
   * dos veces todos los meses.
   */
  const e = estadoDeTarjeta(tarjeta(), [compra(), compra({ id: "c2", monto_cuota: 200_000 })], HOY);
  const obligaciones = obligacionesDe([e], { desde: HOY, hasta: "2026-10-31" });

  assert.equal(obligaciones.length, 1);
  assert.equal(obligaciones[0].fecha, "2026-10-05");
  assert.equal(obligaciones[0].monto, 700_000);
});

test("el segundo vencimiento usa solo las cuotas: el resumen del mes que viene no existe", () => {
  /*
   * Repetir el total de este resumen hacia adelante sería inventar el consumo
   * del mes que viene. Lo único comprometido de verdad son las cuotas.
   */
  const e = estadoDeTarjeta(
    tarjeta({ pago_total: 2_300_000, resumen_al: "2026-09-01" }),
    [compra()],
    HOY,
  );

  const obligaciones = obligacionesDe([e], { desde: HOY, hasta: "2026-12-31" });

  assert.equal(obligaciones.length, 3);
  assert.equal(obligaciones[0].monto, 2_300_000);
  assert.equal(obligaciones[1].monto, 500_000);
  assert.equal(obligaciones[2].monto, 500_000);
});

test("un pago de la tarjeta ya anotado no vuelve a descontarse", () => {
  /*
   * El otro lado del doble conteo: quien anota "pagué la tarjeta 700 mil" el 5
   * no puede además ver esa obligación proyectada. `sinDuplicar` —el mismo
   * filtro que usan las cuotas de deuda— lo resuelve por importe y fecha.
   */
  const e = estadoDeTarjeta(tarjeta(), [compra(), compra({ id: "c2", monto_cuota: 200_000 })], HOY);
  const obligaciones = obligacionesDe([e], { desde: HOY, hasta: "2026-10-31" });

  const yaPagado = [
    {
      tipo: "gasto" as const,
      descripcion: "Pago tarjeta Continental",
      monto: 700_000,
      fecha: "2026-10-05",
      periodicidad: "mensual" as const,
      confianza: 1,
    },
  ];

  assert.deepEqual(sinDuplicar(obligaciones, yaPagado), []);
});

test("un gasto cualquiera de la misma semana no tapa el vencimiento", () => {
  // El filtro exige importe parecido Y fecha cercana: una compra chica no
  // puede hacer desaparecer la obligación de la tarjeta.
  const e = estadoDeTarjeta(tarjeta(), [compra()], HOY);
  const obligaciones = obligacionesDe([e], { desde: HOY, hasta: "2026-10-31" });

  const supermercado = [
    {
      tipo: "gasto" as const,
      descripcion: "Supermercado",
      monto: 120_000,
      fecha: "2026-10-04",
      periodicidad: "mensual" as const,
      confianza: 1,
    },
  ];

  assert.equal(sinDuplicar(obligaciones, supermercado).length, 1);
});

test("una tarjeta sin vencimiento no entra en la línea de tiempo", () => {
  // Sin la fecha, ponerla en el calendario obligaría a inventarla.
  const e = estadoDeTarjeta(tarjeta({ dia_vencimiento: null }), [compra()], HOY);

  assert.deepEqual(obligacionesDe([e], { desde: HOY, hasta: "2026-12-31" }), []);
  assert.match(e.confianza.motivos.join(" "), /no sé qué día se vence/);
});

test("avisa cuando la misma tarjeta también está cargada como deuda", () => {
  /*
   * Antes de la v146 la única forma de cargarla era como deuda de tipo
   * tarjeta. Quien ya lo hizo y la carga acá termina con la obligación contada
   * dos veces. No se borra nada: se avisa con los dos nombres.
   */
  const e = estadoDeTarjeta(tarjeta(), [], HOY);

  const repetidas = tarjetasRepetidasEnDeudas(
    [e],
    [
      { acreedor: "Tarjeta Continental", tipo: "tarjeta" },
      { acreedor: "Financiera Ueno", tipo: "prestamo" },
    ],
  );

  assert.equal(repetidas.length, 1);
  assert.equal(repetidas[0].acreedor, "Tarjeta Continental");
});

test("un préstamo con nombre parecido no se confunde con una tarjeta", () => {
  const e = estadoDeTarjeta(tarjeta(), [], HOY);

  const repetidas = tarjetasRepetidasEnDeudas([e], [
    { acreedor: "Banco Continental", tipo: "prestamo" },
  ]);

  assert.deepEqual(repetidas, []);
});

test("cuota por cuotas NO es lo que costó la compra", () => {
  /*
   * 12 × 500.000 son 6.000.000, pero con financiación el precio de lista pudo
   * haber sido 4.800.000. Por eso `monto_total` es un dato aparte y opcional:
   * deducirlo sería inventar el interés que EOS no conoce.
   */
  const e = estadoDeTarjeta(tarjeta(), [compra({ monto_total: 4_800_000 })], HOY);

  assert.equal(e.compras[0].monto_total, 4_800_000);
  assert.equal(e.compras[0].falta, 4_000_000);
});
