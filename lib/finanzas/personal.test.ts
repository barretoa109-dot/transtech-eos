import assert from "node:assert/strict";
import test from "node:test";

import { interpretar, confirmar } from "./gastoRapido.ts";
import { clasificar, etiquetaDe } from "./destinos.ts";

/**
 * El recorrido de alguien que no tiene un negocio.
 *
 * EOS empezó apuntando a comercios, y la pantalla de gastos personales se
 * apoya en dos piezas que ya existían —el intérprete de una línea y el
 * clasificador de destinos— pero que nunca se habían probado juntas contra las
 * frases que dice una persona común: el combustible, el almuerzo, el sueldo.
 *
 * Estas pruebas son ese recorrido. Si alguna se rompe, la pantalla nueva deja
 * de servirle a quien la pidió, aunque el resto del sistema siga verde.
 */

const HOY = "2026-09-02";

function anotar(linea: string) {
  const leido = interpretar(linea, HOY);
  assert.ok(leido, `no entendió: «${linea}»`);
  return {
    ...leido,
    destino: clasificar(leido.descripcion, null),
  };
}

// ============================================================
// Los gastos que nombró el usuario
// ============================================================

test("el combustible se entiende y cae en transporte", () => {
  const g = anotar("gasté 150 mil en nafta");

  assert.equal(g.tipo, "gasto");
  assert.equal(g.monto, 150_000);
  assert.equal(g.moneda, "PYG");
  assert.equal(g.destino, "transporte");
  assert.equal(etiquetaDe(g.destino), "Transporte");
});

test("la comida fuera también", () => {
  const g = anotar("pagué 45 mil el almuerzo");

  assert.equal(g.tipo, "gasto");
  assert.equal(g.monto, 45_000);
  assert.equal(g.destino, "comida");
});

test("el pasaje del colectivo, que es el gasto más chico y más frecuente", () => {
  const g = anotar("gasté 3.400 en pasaje");

  assert.equal(g.monto, 3_400);
  assert.equal(g.destino, "transporte");
});

test("el supermercado no se confunde con comer afuera", () => {
  const compra = anotar("gasté 320 mil en el supermercado");
  const salida = anotar("gasté 320 mil en la cena");

  assert.equal(compra.destino, "mercado");
  assert.equal(salida.destino, "comida");
  assert.notEqual(compra.destino, salida.destino);
});

test("«comida» a secas NO se clasifica, y eso es deliberado", () => {
  // Puede ser el súper o puede ser salir a comer. Adivinar dejaría un número
  // que se lee como respuesta; dejarlo sin reconocer lo deja como pendiente,
  // y la persona puede corregir la categoría a mano.
  assert.equal(anotar("gasté 200 mil en comida").destino, "otros");
});

// ============================================================
// Los ingresos
// ============================================================

test("el sueldo entra como ingreso, no como gasto", () => {
  const i = anotar("cobré el sueldo 3.500.000");

  assert.equal(i.tipo, "ingreso");
  assert.equal(i.monto, 3_500_000);
});

test("«me pagaron» también es plata que entra", () => {
  const i = anotar("me pagaron 800 mil por el trabajo");

  assert.equal(i.tipo, "ingreso");
  assert.equal(i.monto, 800_000);
});

// ============================================================
// Cómo se dicen los montos en Paraguay
// ============================================================

test("«luca» y «palo» son plata de verdad y se leen igual", () => {
  assert.equal(anotar("gasté 50 lucas en nafta").monto, 50_000);
  assert.equal(anotar("gasté 2 millones en el alquiler").monto, 2_000_000);
});

test("un importe con puntos no se lee como tres números sueltos", () => {
  assert.equal(anotar("pagué 1.250.000 de alquiler").monto, 1_250_000);
});

// ============================================================
// Lo que NO se guarda
// ============================================================

test("sin un importe no se inventa un movimiento", () => {
  // Es la regla que protege al panel: un gasto inventado contamina el
  // disponible real, y el disponible real es sobre lo que alguien decide si
  // llega a fin de mes.
  assert.equal(interpretar("me fue mal hoy", HOY), null);
  assert.equal(interpretar("", HOY), null);
});

// ============================================================
// Lo que la pantalla le devuelve
// ============================================================

test("la confirmación dice la dirección y el monto, que es lo que se revisa", () => {
  const salida = confirmar(interpretar("gasté 50 mil en nafta", HOY)!);
  const entrada = confirmar(interpretar("cobré 900 mil", HOY)!);

  assert.match(salida, /Salió/);
  assert.match(salida, /50\.000/);
  assert.match(entrada, /Entró/);
  assert.match(entrada, /900\.000/);
});

test("un gasto que el clasificador no reconoce se dice, no se reparte a ojo", () => {
  // Antes "sin reconocer" que una mentira: un gasto mal clasificado se lee
  // como respuesta, uno sin clasificar se lee como pendiente.
  const g = anotar("gasté 90 mil en eso que compré");
  assert.equal(g.destino, "otros");
  assert.equal(etiquetaDe("otros"), "Sin reconocer");
});
