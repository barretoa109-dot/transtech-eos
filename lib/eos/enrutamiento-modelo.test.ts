import assert from "node:assert/strict";
import { test } from "node:test";

import {
  clasificarTurno,
  pareceAccion,
  registroDeEnrutamiento,
  type TurnoParaClasificar,
} from "./enrutamiento-modelo.ts";

function turno(mensaje: string, extra: Partial<TurnoParaClasificar> = {}): TurnoParaClasificar {
  return { mensaje, adjuntos: 0, conCita: false, historial: [], ...extra };
}

const clase = (mensaje: string, extra: Partial<TurnoParaClasificar> = {}) =>
  clasificarTurno(turno(mensaje, extra)).clase;

test("saludos, agradecimientos y despedidas son simples", () => {
  for (const m of ["hola", "Buenas!", "buen día", "¡Muchas gracias!", "chau", "hola, ¿qué tal?"]) {
    assert.equal(clase(m), "simple", m);
  }
});

test("un acuse sin pregunta pendiente es simple", () => {
  assert.equal(clase("dale"), "simple");
  assert.equal(clase("ok"), "simple");
});

test("un 'sí' después de que EOS preguntó algo NO es simple: es el que ejecuta", () => {
  const historial = [
    { rol: "usuario" as const, texto: "vendí 3 panes a Ana" },
    { rol: "eos" as const, texto: "¿Registro la venta de 3 panes a Ana por Gs. 15.000?" },
  ];
  const r = clasificarTurno(turno("sí", { historial }));
  assert.deepEqual(r, { clase: "completo", motivo: "confirma_pendiente" });
  assert.equal(clase("dale", { historial }), "completo");
});

test("mira la ÚLTIMA respuesta de EOS, no una pregunta vieja", () => {
  const historial = [
    { rol: "eos" as const, texto: "¿Lo registro?" },
    { rol: "usuario" as const, texto: "sí" },
    { rol: "eos" as const, texto: "Listo, quedó registrado." },
  ];
  assert.equal(clase("genial", { historial }), "simple");
});

test("cualquier número manda al modelo completo", () => {
  assert.deepEqual(clasificarTurno(turno("3 panes")), { clase: "completo", motivo: "numeros" });
  assert.equal(clase("gracias, eran 50 mil"), "completo");
});

test("adjuntos y citas mandan al modelo completo", () => {
  assert.equal(clase("hola", { adjuntos: 1 }), "completo");
  assert.equal(clase("gracias", { conCita: true }), "completo");
});

test("vocabulario de negocio o de plata manda al modelo completo aunque sea corto", () => {
  for (const m of ["¿y el stock?", "mostrame el dashboard", "¿cómo vengo este mes?", "anotá: revisar la caja", "acordate de eso"]) {
    assert.equal(clase(m), "completo", m);
  }
});

test("lo desconocido y lo largo quedan en el modelo completo", () => {
  assert.equal(clase("contame un chiste"), "completo");
  assert.equal(clase("hola eos te quería preguntar algo sobre lo de ayer"), "completo");
  assert.equal(clase(""), "completo");
});

test("el registro marca cuando un turno simple igual pidió una acción", () => {
  const simple = clasificarTurno(turno("gracias"));
  assert.equal(registroDeEnrutamiento(simple, 0).simple_con_accion, false);
  assert.equal(registroDeEnrutamiento(simple, 1).simple_con_accion, true);
  const completo = clasificarTurno(turno("vendí 3 panes"));
  assert.equal(registroDeEnrutamiento(completo, 2).simple_con_accion, false);
});


test("pareceAccion: lo de plata o negocio va directo a n8n aunque sea largo", () => {
  const largo =
    "quiero que me ayudes a ver cómo llego a fin de mes porque no quiero que me quede tan justo este mes con todo lo que tengo";
  assert.equal(pareceAccion(turno(largo)), true);
  assert.equal(pareceAccion(turno("cargá la tarjeta green")), true);
  assert.equal(pareceAccion(turno("son 50 mil")), true);
  assert.equal(pareceAccion(turno("hola", { adjuntos: 1 })), true);
});

test("pareceAccion: la conversación pura sigue por el camino rápido", () => {
  assert.equal(pareceAccion(turno("hola")), false);
  assert.equal(pareceAccion(turno("contame un chiste")), false);
  assert.equal(pareceAccion(turno("gracias, sos un genio")), false);
});

test("pareceAccion: un sí con pregunta pendiente es acción", () => {
  const historial = [{ rol: "eos" as const, texto: "¿Registro la venta?" }];
  assert.equal(pareceAccion(turno("sí", { historial })), true);
  assert.equal(pareceAccion(turno("sí")), false);
});
