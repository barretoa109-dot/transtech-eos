import assert from "node:assert/strict";
import test from "node:test";

import { simularCompra, type Antes } from "./escenarios.ts";

const HOY = "2026-09-08";

function antes(cambios: Partial<Antes> = {}): Antes {
  return {
    moneda: "PYG",
    disponible_real: 2_000_000,
    saldo: 5_000_000,
    reserva: 1_000_000,
    comprometido: 1_500_000,
    proximo_ingreso: { fecha: "2026-09-30", monto: 4_200_000 },
    aporte_objetivos: 0,
    ...cambios,
  };
}

test("no contesta con el saldo: descuenta reserva y compromisos", () => {
  /*
   * Tener 5.000.000 en la cuenta no es poder gastar 5.000.000. Antes están la
   * reserva que la persona pidió no tocar y lo que sale antes del próximo
   * cobro.
   */
  const e = simularCompra({ hoy: HOY, antes: antes(), monto: 1_000_000 });

  assert.equal(e.hasta_cuanto, 2_500_000);
  assert.equal(e.veredicto, "entra");
  assert.equal(e.saldo_despues, 4_000_000);
  assert.equal(e.disponible_despues, 1_000_000);
});

test("una compra que se come la reserva no entra, y dice con cuánto quedaría", () => {
  const e = simularCompra({ hoy: HOY, antes: antes(), monto: 4_500_000 });

  assert.equal(e.veredicto, "no_entra");
  const impide = e.consecuencias.filter((c) => c.gravedad === "impide");
  assert.ok(impide.length > 0);
  assert.match(impide[0].titulo, /reserva/);
  assert.match(impide[0].detalle, /₲ 500\.000/);
});

test("una compra que deja sin cubrir lo comprometido tampoco entra", () => {
  // Queda por encima de la reserva pero no alcanza para las cuotas del mes.
  const e = simularCompra({ hoy: HOY, antes: antes(), monto: 3_000_000 });

  assert.equal(e.veredicto, "no_entra");
  assert.ok(e.consecuencias.some((c) => c.titulo.includes("comprometido")));
});

test("entra pero justo: avisa que no quedaría margen", () => {
  const e = simularCompra({ hoy: HOY, antes: antes(), monto: 1_900_000 });

  assert.equal(e.veredicto, "entra_justo");
  assert.ok(e.consecuencias.some((c) => c.titulo.includes("imprevisto")));
});

test("atrasar un objetivo advierte, pero no impide", () => {
  /*
   * Postergar un objetivo es una decisión legítima de la persona. Tratarla
   * como impedimento convertiría a EOS en alguien que dice que no.
   */
  const e = simularCompra({
    hoy: HOY,
    antes: antes({ aporte_objetivos: 800_000 }),
    monto: 1_500_000,
  });

  assert.equal(e.veredicto, "entra_justo");
  const objetivos = e.consecuencias.find((c) => c.titulo.includes("objetivos"));
  assert.equal(objetivos?.gravedad, "advierte");
});

test("en cuotas solo sale la cuota de este mes, y lo dice", () => {
  const e = simularCompra({ hoy: HOY, antes: antes(), monto: 6_000_000, cuotas: 12 });

  assert.equal(e.sale_ahora, 500_000);
  assert.equal(e.veredicto, "entra");
  const aviso = e.consecuencias.find((c) => c.titulo.includes("12 meses"));
  assert.ok(aviso);
  // Y no inventa el interés de esa financiación.
  assert.match(aviso?.detalle ?? "", /No sé si tu financiación tiene interés/);
});

test("cuando no entra, dice cuándo sí con lo que le sobra por mes", () => {
  const e = simularCompra({
    hoy: HOY,
    antes: antes(),
    monto: 5_000_000,
    margenMensual: 1_000_000,
  });

  assert.equal(e.veredicto, "no_entra");
  // Faltan 2.500.000 sobre el techo, a un millón por mes: tres meses.
  assert.equal(e.cuando_si, "2026-12-08");
});

test("sin saber cuánto le sobra no inventa una fecha", () => {
  const e = simularCompra({ hoy: HOY, antes: antes(), monto: 5_000_000 });

  assert.equal(e.cuando_si, null);
});

test("dice cuándo vuelve a entrar plata, que es la mitad de la decisión", () => {
  const e = simularCompra({ hoy: HOY, antes: antes(), monto: 500_000 });

  const cobro = e.consecuencias.find((c) => c.titulo.includes("Volvés a cobrar"));
  assert.match(cobro?.titulo ?? "", /2026-09-30/);
  assert.equal(cobro?.gravedad, "informa");
});

test("sin próximo ingreso conocido baja la confianza y lo dice", () => {
  const e = simularCompra({ hoy: HOY, antes: antes({ proximo_ingreso: null }), monto: 500_000 });

  assert.ok(e.confianza.nivel < 1);
  assert.match(e.confianza.motivos.join(" "), /cuándo volvés a cobrar/);
});

test("los montos de las frases respetan la moneda, no siempre guaraníes", () => {
  const e = simularCompra({
    hoy: HOY,
    antes: antes({ moneda: "USD", disponible_real: 300, saldo: 700, reserva: 200, comprometido: 100 }),
    monto: 650,
  });

  assert.equal(e.veredicto, "no_entra");
  assert.match(e.consecuencias[0].detalle, /US\$|\$/);
});

test("un escenario no modifica el estado que recibe", () => {
  // Preguntarle a EOS "¿puedo comprar una notebook?" no puede dejar rastro de
  // una notebook que nadie compró.
  const estado = antes();
  const copia = JSON.parse(JSON.stringify(estado)) as Antes;

  simularCompra({ hoy: HOY, antes: estado, monto: 3_000_000 });

  assert.deepEqual(estado, copia);
});
