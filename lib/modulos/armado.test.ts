import assert from "node:assert/strict";
import { test } from "node:test";

import {
  calcularArmado,
  cupoDeMensajes,
  precioDeTodo,
  TOPE_MENSUAL_PYG,
  type ModuloCatalogo,
} from "./armado.ts";

function modulo(codigo: string, precio: number, extra: Partial<ModuloCatalogo> = {}): ModuloCatalogo {
  return {
    codigo,
    nombre: codigo,
    descripcion: null,
    precio_mensual_pyg: precio,
    precio_anual_pyg: precio * 10,
    grupo: null,
    limite_mensajes: null,
    requiere: [],
    orden: 100,
    ...extra,
  };
}

const CATALOGO: ModuloCatalogo[] = [
  modulo("conversaciones", 45_000, { grupo: "conversaciones", limite_mensajes: 300, orden: 10 }),
  modulo("conversaciones_plus", 90_000, { grupo: "conversaciones", limite_mensajes: 1_000, orden: 11 }),
  modulo("conversaciones_full", 150_000, { grupo: "conversaciones", limite_mensajes: -1, orden: 12 }),
  modulo("dashboard", 20_000, { orden: 20 }),
  modulo("briefing", 25_000, { orden: 30 }),
  modulo("documentos", 25_000, { orden: 40 }),
  modulo("lectura", 35_000, { requiere: ["dashboard"], orden: 50 }),
  modulo("alertas", 20_000, { requiere: ["dashboard"], orden: 60 }),
  modulo("decisiones", 15_000, { orden: 70 }),
  modulo("erp", 120_000, { orden: 80 }),
  modulo("crm", 90_000, { orden: 90 }),
];

test("el ejemplo que dio el usuario da exactamente lo que dijo", () => {
  // "El Dashboard cuesta Gs. 20.000 y el Briefing Gs. 25.000, las
  //  conversaciones cuestan Gs. 45.000 entonces el usuario pagará Gs. 90.000".
  const armado = calcularArmado(["dashboard", "briefing", "conversaciones"], CATALOGO);

  assert.equal(armado.total, 90_000);
  assert.deepEqual(armado.problemas, []);
});

test("se puede contratar una sola función", () => {
  // "Si el usuario quiere solo tener más conversaciones entonces no tiene
  //  sentido que pague el plan más completo".
  const armado = calcularArmado(["conversaciones_full"], CATALOGO);

  assert.deepEqual(armado.modulos, ["conversaciones_full"]);
  assert.equal(armado.total, 150_000);
});

test("prender todo cuesta exactamente el tope prometido", () => {
  assert.equal(precioDeTodo(CATALOGO), TOPE_MENSUAL_PYG);
});

test("el tope no es una promesa vacía: por encima, se cobra el tope", () => {
  const caro = [...CATALOGO, modulo("carisimo", 400_000, { orden: 99 })];
  const armado = calcularArmado(
    caro.map((m) => m.codigo),
    caro,
  );

  assert.equal(armado.total, TOPE_MENSUAL_PYG);
  assert.ok(armado.tope_aplicado);
  assert.ok(armado.subtotal > armado.total);
});

test("de dos tramos del mismo grupo queda el mayor, no la suma", () => {
  // Sumar los tres tramos de conversaciones cobraría tres veces lo mismo.
  const armado = calcularArmado(
    ["conversaciones", "conversaciones_plus", "conversaciones_full"],
    CATALOGO,
  );

  assert.deepEqual(armado.modulos, ["conversaciones_full"]);
  assert.equal(armado.total, 150_000);
});

test("una dependencia se agrega sola y se avisa", () => {
  // Rechazar la selección y hacer que el usuario adivine qué falta convierte
  // una compra en un acertijo.
  const armado = calcularArmado(["alertas"], CATALOGO);

  assert.deepEqual(armado.modulos, ["dashboard", "alertas"]);
  assert.deepEqual(armado.agregados, ["dashboard"]);
  assert.equal(armado.total, 40_000);
});

test("los códigos desconocidos o repetidos no rompen nada", () => {
  const armado = calcularArmado(
    ["dashboard", "DASHBOARD", " dashboard ", "modulo_que_no_existe", ""],
    CATALOGO,
  );

  assert.deepEqual(armado.modulos, ["dashboard"]);
  assert.equal(armado.total, 20_000);
});

test("una selección vacía no se puede cobrar", () => {
  const armado = calcularArmado([], CATALOGO);

  assert.equal(armado.total, 0);
  assert.equal(armado.problemas.length, 1);
});

test("el anual se calcula sobre el mensual YA topeado", () => {
  // Aplicar el tope después dejaría al anual pagando por encima del techo que
  // se prometió, que es la manera más rápida de que la promesa parezca trampa.
  const armado = calcularArmado(
    CATALOGO.map((m) => m.codigo),
    CATALOGO,
    "anual",
  );

  assert.equal(armado.total, TOPE_MENSUAL_PYG * 10);
});

test("el cupo de mensajes es el del tramo elegido", () => {
  assert.equal(cupoDeMensajes(["conversaciones", "dashboard"], CATALOGO), 300);
  assert.equal(cupoDeMensajes(["conversaciones_full"], CATALOGO), -1);
});

test("sin módulo de conversaciones no hay cupo, y eso es válido", () => {
  // Alguien que solo quiere el panel y el briefing tiene que poder existir.
  assert.equal(cupoDeMensajes(["dashboard", "briefing"], CATALOGO), 0);
});
