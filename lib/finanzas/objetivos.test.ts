import assert from "node:assert/strict";
import test from "node:test";

import {
  aportesEntre,
  contrastarConElAhorro,
  evaluarObjetivo,
  type EstadoObjetivo,
  type ObjetivoFinanciero,
} from "./objetivos.ts";

const HOY = "2026-09-08";

function objetivo(cambios: Partial<ObjetivoFinanciero> = {}): ObjetivoFinanciero {
  return {
    id: "obj-1",
    titulo: "Ahorrar para el terreno",
    clase: "general",
    moneda: "PYG",
    prioridad: 3,
    objetivo: 30_000_000,
    inicial: 0,
    actual: 0,
    origen: "declarado",
    actual_al: HOY,
    desde: HOY,
    hasta: "2026-12-31",
    ...cambios,
  };
}

test("un objetivo se convierte en plata por mes, no en una barra de progreso", () => {
  const e = evaluarObjetivo(objetivo({ actual: 6_000_000 }), HOY);

  assert.equal(e.falta, 24_000_000);
  // Septiembre, octubre, noviembre y diciembre.
  assert.equal(e.aportes_restantes, 4);
  assert.equal(e.aporte_necesario, 6_000_000);
  assert.equal(e.progreso, 20);
});

test("los aportes se cuentan por mes de calendario, no en fracciones", () => {
  /*
   * Del 8 de septiembre al 31 de diciembre hay cuatro meses en los que la
   * persona va a poder apartar plata. Dividir por 3,8 —que es lo que dan los
   * días— produce una cuota que no corresponde a ningún mes real.
   */
  assert.equal(aportesEntre("2026-09-08", "2026-12-31"), 4);
  assert.equal(aportesEntre("2026-09-08", "2026-09-30"), 1);
  assert.equal(aportesEntre("2026-09-08", "2027-09-01"), 13);
});

test("con la fecha encima el faltante no se divide: se debe entero", () => {
  // Dividir por cero aportes daría infinito y la pantalla mostraría un símbolo
  // en vez de la plata que hay que poner.
  const e = evaluarObjetivo(objetivo({ actual: 28_000_000, hasta: "2026-09-30" }), HOY);

  assert.equal(e.aportes_restantes, 1);
  assert.equal(e.aporte_necesario, 2_000_000);
});

test("el atraso se mide contra el esfuerzo original, sin inventar una tolerancia", () => {
  /*
   * Definido el 1 de julio: 30.000.000 en seis aportes (julio a diciembre) son
   * 5.000.000 por mes. Al 8 de septiembre lleva 4.000.000, así que para llegar
   * necesita 26.000.000 en cuatro aportes: 6.500.000. Subió, luego se quedó
   * atrás — y se puede decir con esos dos números.
   */
  const e = evaluarObjetivo(objetivo({ desde: "2026-07-01", actual: 4_000_000 }), HOY);

  assert.equal(e.aporte_original, 5_000_000);
  assert.equal(e.aporte_necesario, 6_500_000);
  assert.equal(e.estado, "atrasado");
});

test("el día que se define, un objetivo no está atrasado", () => {
  // Comparar progreso contra tiempo transcurrido diría "atrasado" al segundo
  // día por milésimas, y habría que inventar una tolerancia que no sale de
  // ningún lado.
  const e = evaluarObjetivo(objetivo(), HOY);

  assert.equal(e.estado, "en_ritmo");
  assert.equal(e.aporte_necesario, e.aporte_original);
});

test("el ritmo real no se mide con menos de un mes de historia", () => {
  /*
   * Un solo dato dividido por el tiempo da un número que se mueve enormemente
   * de un día para el otro: 1.000.000 juntados en tres días proyectarían diez
   * millones por mes.
   */
  const nuevo = evaluarObjetivo(objetivo({ desde: "2026-09-05", actual: 1_000_000 }), HOY);
  assert.equal(nuevo.aporte_real, null);
  assert.equal(nuevo.desvio, null);

  const viejo = evaluarObjetivo(objetivo({ desde: "2026-06-08", actual: 6_000_000 }), HOY);
  // Tres meses exactos: dos millones por mes.
  assert.ok(viejo.aporte_real !== null && Math.abs(viejo.aporte_real - 2_000_000) < 30_000);
  // Necesita 6.000.000 y aparta 2.000.000: le faltan cuatro por mes.
  assert.ok(viejo.desvio !== null && viejo.desvio < 0);
});

test("dice cuándo llegaría al ritmo que lleva, y no finge una fecha si no avanza", () => {
  const avanza = evaluarObjetivo(objetivo({ desde: "2026-06-08", actual: 6_000_000 }), HOY);
  /*
   * 24.000.000 faltantes a algo menos de 2.000.000 por mes son 12,09 meses, y
   * la llegada se redondea al mes ENTERO siguiente: a los doce meses todavía
   * falta plata. Redondear para abajo daría una fecha en la que no llegó, que
   * es exactamente la promesa que este módulo no puede hacer.
   */
  assert.equal(avanza.llegada_estimada, "2027-10-08");

  const quieto = evaluarObjetivo(objetivo({ desde: "2026-06-08", actual: 0 }), HOY);
  assert.equal(quieto.llegada_estimada, null);
});

test("un objetivo cumplido no pide aportes ni queda atrasado", () => {
  const e = evaluarObjetivo(objetivo({ actual: 30_000_000, desde: "2026-01-01" }), HOY);

  assert.equal(e.estado, "cumplido");
  assert.equal(e.falta, 0);
  assert.equal(e.progreso, 100);
  assert.equal(e.aporte_necesario, null);
});

test("la fecha pasada sin llegar es vencido, no atrasado", () => {
  const e = evaluarObjetivo(objetivo({ hasta: "2026-08-31", actual: 10_000_000 }), HOY);

  assert.equal(e.estado, "vencido");
  assert.ok(e.dias_restantes !== null && e.dias_restantes < 0);
});

test("sin fecha límite no se inventa un aporte mensual, y se dice", () => {
  const e = evaluarObjetivo(objetivo({ hasta: null, actual: 5_000_000 }), HOY);

  assert.equal(e.estado, "sin_fecha");
  assert.equal(e.aporte_necesario, null);
  assert.equal(e.aportes_restantes, null);
  assert.match(e.confianza.motivos.join(" "), /para cuándo/);
});

test("un monto declarado hace meses baja la confianza y lo dice con la fecha", () => {
  const e = evaluarObjetivo(objetivo({ actual: 5_000_000, actual_al: "2026-03-15" }), HOY);

  assert.ok(e.confianza.nivel < 1);
  assert.match(e.confianza.motivos.join(" "), /2026-03-15/);
});

test("los días cruzando meses de distinto largo se cuentan bien", () => {
  /*
   * Del 31 de enero al 28 de febrero hay 28 días. Con el mes sin corregir
   * —confiando en que se compensa por venir corrido en las dos fechas— daban
   * 25, porque enero tiene 31 días y febrero 28.
   */
  const e = evaluarObjetivo(
    objetivo({ desde: "2026-01-01", hasta: "2026-02-28", actual: 0 }),
    "2026-01-31",
  );

  assert.equal(e.dias_restantes, 28);
});

function estado(cambios: Partial<EstadoObjetivo>): EstadoObjetivo {
  return {
    ...evaluarObjetivo(objetivo(), HOY),
    ...cambios,
  };
}

test("los objetivos compiten con el ahorro, no con el disponible", () => {
  /*
   * El disponible real YA descuenta el ahorro comprometido. Restarle además el
   * aporte de cada objetivo sería contar la misma plata dos veces. Por eso acá
   * hay un contraste y no una resta.
   */
  const c = contrastarConElAhorro(
    [estado({ id: "a", aporte_necesario: 400_000 }), estado({ id: "b", aporte_necesario: 200_000 })],
    800_000,
    "PYG",
  );

  assert.equal(c.aporte_necesario_total, 600_000);
  assert.equal(c.alcanza, true);
  assert.equal(c.faltante, 0);
  assert.deepEqual(c.no_entran, []);
});

test("cuando no alcanza, se cae primero el objetivo menos importante", () => {
  const c = contrastarConElAhorro(
    [
      estado({ id: "casa", titulo: "Casa", prioridad: 1, aporte_necesario: 700_000 }),
      estado({ id: "viaje", titulo: "Viaje", prioridad: 5, aporte_necesario: 400_000 }),
    ],
    800_000,
    "PYG",
  );

  assert.equal(c.alcanza, false);
  assert.equal(c.faltante, 300_000);
  assert.equal(c.no_entran.length, 1);
  assert.equal(c.no_entran[0].id, "viaje");
});

test("no se suman objetivos de monedas distintas", () => {
  const c = contrastarConElAhorro(
    [
      estado({ id: "gs", moneda: "PYG", aporte_necesario: 500_000 }),
      estado({ id: "usd", moneda: "USD", aporte_necesario: 300 }),
    ],
    800_000,
    "PYG",
  );

  assert.equal(c.aporte_necesario_total, 500_000);
});
