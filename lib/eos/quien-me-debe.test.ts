import assert from "node:assert/strict";
import { test } from "node:test";

import type { DocumentoCartera } from "../erp/cartera.ts";
import {
  deudores,
  esPreguntaQuienMeDebe,
  MAXIMO_EN_LISTA,
  mensajeDeCobro,
  redactarQuienMeDebe,
} from "./quien-me-debe.ts";
import { respuestaDirectaPara } from "./respuestas-directas.ts";

const HOY = "2026-09-27";

const doc = (p: Partial<DocumentoCartera>): DocumentoCartera => ({
  id: Math.random().toString(36).slice(2),
  fecha: "2026-09-15",
  vence_el: null,
  moneda: "PYG",
  total: 1_000_000,
  cobrado: 0,
  contacto_id: "juan",
  contacto_nombre: "Juan Pérez",
  ...p,
});

test("reconoce la pregunta dicha de varias formas", () => {
  for (const m of [
    "¿Quién me debe?",
    "quienes me deben",
    "quién me debe plata?",
    "¿Cuánto me deben?",
    "qué me deben mis clientes",
    "a quién le tengo que cobrar?",
    "EOS, quién me debe todavía?",
    "lista de deudores",
    "mis deudores",
    "qué tengo por cobrar",
  ]) {
    assert.ok(esPreguntaQuienMeDebe(m), m);
  }
});

test("no se roba mensajes que son otra cosa", () => {
  for (const m of [
    "cuánto le debo a mi proveedor?",
    "Juan me debe 200 mil, anotalo",
    "quién me debe más plata desde marzo y por qué no me pagan",
    "cobré a Juan",
    "",
  ]) {
    assert.ok(!esPreguntaQuienMeDebe(m), m);
  }
});

test("usa el saldo, no el total: quien pagó la mitad debe la mitad", () => {
  const [d] = deudores([doc({ total: 1_000_000, cobrado: 400_000 })], HOY);
  assert.equal(d.saldo, 600_000);
});

test("lo cobrado entero no aparece", () => {
  assert.deepEqual(deudores([doc({ cobrado: 1_000_000 })], HOY), []);
});

test("agrupa por cliente y ordena: primero lo vencido y más atrasado", () => {
  const lista = deudores(
    [
      doc({ contacto_id: "maria", contacto_nombre: "María", fecha: "2026-09-01", total: 300_000 }),
      doc({ contacto_id: "juan", contacto_nombre: "Juan Pérez", fecha: "2026-09-10", vence_el: "2026-09-15" }),
      doc({ contacto_id: "juan", contacto_nombre: "Juan Pérez", fecha: "2026-09-20", total: 500_000 }),
      doc({ contacto_id: "ana", contacto_nombre: "Ana", fecha: "2026-09-12", vence_el: "2026-09-25" }),
    ],
    HOY,
  );

  assert.deepEqual(
    lista.map((d) => [d.nombre, d.saldo, d.vencidoHace]),
    [
      ["Juan Pérez", 1_500_000, 12],
      ["Ana", 1_000_000, 2],
      ["María", 300_000, null],
    ],
  );
  assert.equal(lista[0].desde, "2026-09-10");
});

test("la respuesta lista, da el total y deja el mensaje para el más atrasado", () => {
  const texto = redactarQuienMeDebe(
    deudores(
      [
        doc({ contacto_id: "juan", contacto_nombre: "Juan Pérez", fecha: "2026-09-10", vence_el: "2026-09-15" }),
        doc({ contacto_id: "maria", contacto_nombre: "María López", fecha: "2026-09-22", total: 500_000 }),
        doc({ contacto_id: "ana", contacto_nombre: "Ana", fecha: "2026-09-12", vence_el: "2026-10-05", total: 200_000 }),
      ],
      HOY,
    ),
    HOY,
  );

  assert.equal(
    texto,
    [
      "Te deben ₲ 1.700.000 entre 3 clientes:",
      "• Juan Pérez: ₲ 1.000.000, vencido hace 12 días.",
      "• Ana: ₲ 200.000, vence el 05/10.",
      "• María López: ₲ 500.000, desde hace 5 días.",
      "",
      "Para cobrarle a Juan Pérez, podés reenviarle esto:",
      '"Hola Juan, ¿cómo estás? Te escribo por el saldo de ₲ 1.000.000 de tu compra del 10/09. ¿Cuándo te queda bien pasarlo? ¡Gracias!"',
      "",
      "Si querés el mensaje para otro, decime a quién.",
    ].join("\n"),
  );
});

test("el mensaje de cobro es amable y no amenaza", () => {
  const m = mensajeDeCobro({
    nombre: null,
    moneda: "PYG",
    saldo: 150_000,
    desde: "2026-09-01",
    vencidoHace: 90,
    venceEl: null,
  });
  assert.ok(m.startsWith("Hola, ¿cómo estás?"));
  for (const palabra of ["urgente", "último aviso", "deuda", "moroso"]) {
    assert.ok(!m.toLowerCase().includes(palabra), palabra);
  }
});

test("con muchos deudores resume el resto y manda a la pantalla", () => {
  const muchos = Array.from({ length: MAXIMO_EN_LISTA + 3 }, (_, i) =>
    doc({ contacto_id: `c${i}`, contacto_nombre: `Cliente ${i}`, total: 100_000 }),
  );
  const texto = redactarQuienMeDebe(deudores(muchos, HOY), HOY);
  assert.ok(texto.includes("• Y 3 clientes más. La lista completa está en Negocio > Cartera."));
  assert.equal(texto.split("\n").filter((l) => l.startsWith("• Cliente")).length, MAXIMO_EN_LISTA);
});

test("guaraníes y dólares no se suman", () => {
  const texto = redactarQuienMeDebe(
    deudores([doc({}), doc({ contacto_id: "x", contacto_nombre: "Importadora", moneda: "USD", total: 100 })], HOY),
    HOY,
  );
  assert.ok(texto.startsWith("Te deben ₲ 1.000.000 y "));
});

test("sin deudores dice cómo anotar lo fiado", () => {
  assert.ok(redactarQuienMeDebe([], HOY).startsWith("Según lo que tengo anotado, nadie te debe nada."));
});

test("el registro manda cada pregunta a su respuesta, y lo demás al modelo", () => {
  assert.equal(respuestaDirectaPara("¿quién me debe?")?.clave, "quien_me_debe");
  assert.equal(respuestaDirectaPara("¿qué sabés de mi negocio?")?.clave, "que_sabes");
  assert.equal(respuestaDirectaPara("vendí 3 bolsas de balanceado a 180 mil"), null);
});
