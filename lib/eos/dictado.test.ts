import test from "node:test";
import assert from "node:assert/strict";

import {
  fusionarDictado,
  leerResultados,
  mensajeDeErrorDeVoz,
  soportaDictado,
} from "./dictado.ts";

test("sin ventana no hay dictado", () => {
  assert.equal(soportaDictado(undefined), false);
  assert.equal(soportaDictado(null), false);
  assert.equal(soportaDictado({}), false);
});

test("reconoce el constructor con y sin prefijo", () => {
  assert.equal(soportaDictado({ SpeechRecognition: function () {} }), true);
  assert.equal(soportaDictado({ webkitSpeechRecognition: function () {} }), true);
});

test("un objeto que no es constructor no cuenta como soporte", () => {
  // Pasó de verdad con polyfills a medio cargar: la propiedad existe y vale
  // `undefined` o `true`, y preguntar `in` daría que sí.
  assert.equal(soportaDictado({ SpeechRecognition: true as unknown }), false);
  assert.equal(soportaDictado({ webkitSpeechRecognition: {} as unknown }), false);
});

test("lo dictado se suma a lo escrito, con un espacio", () => {
  assert.equal(fusionarDictado("Hola", "qué tal"), "Hola qué tal");
});

test("no agrega espacio de más si ya había uno", () => {
  assert.equal(fusionarDictado("Hola ", "qué tal"), "Hola qué tal");
  assert.notEqual(fusionarDictado("Hola ", "qué tal"), "Hola  qué tal");
});

test("respeta el salto de línea que puso la persona", () => {
  assert.equal(fusionarDictado("Primera línea\n", "segunda"), "Primera línea\nsegunda");
});

test("sobre un campo vacío no deja un espacio adelante", () => {
  assert.equal(fusionarDictado("", "arrancamos"), "arrancamos");
  assert.notEqual(fusionarDictado("", "arrancamos"), " arrancamos");
});

test("dictado vacío o en blanco no toca lo escrito", () => {
  assert.equal(fusionarDictado("intacto", ""), "intacto");
  assert.equal(fusionarDictado("intacto", "   "), "intacto");
});

test("lo provisorio no se mezcla con lo definitivo", () => {
  // Es EL bug del dictado: el navegador repite la misma frase mientras la
  // corrige, y acumular las dos deja "vendí tres panes vendí tres panes".
  const lectura = leerResultados([
    { isFinal: true, 0: { transcript: "Vendí tres panes" }, length: 1 },
    { isFinal: false, 0: { transcript: "a Rossana" }, length: 1 },
  ]);

  assert.equal(lectura.definitivo, "Vendí tres panes");
  assert.equal(lectura.provisorio, "a Rossana");
  assert.notEqual(lectura.definitivo, "Vendí tres panes a Rossana");
});

test("varios tramos definitivos se encadenan en orden", () => {
  const lectura = leerResultados([
    { isFinal: true, 0: { transcript: "Primero" }, length: 1 },
    { isFinal: true, 0: { transcript: "segundo" }, length: 1 },
  ]);

  assert.equal(lectura.definitivo, "Primero segundo");
  assert.equal(lectura.provisorio, "");
});

test("el índice de arranque saltea lo ya leído", () => {
  // El evento del navegador trae SIEMPRE la lista completa desde el principio
  // más un `resultIndex`. Sin respetarlo, cada evento vuelve a agregar todo lo
  // dicho hasta ese momento.
  const resultados = [
    { isFinal: true, 0: { transcript: "viejo" }, length: 1 },
    { isFinal: true, 0: { transcript: "nuevo" }, length: 1 },
  ];

  assert.equal(leerResultados(resultados, 1).definitivo, "nuevo");
});

test("resultados vacíos o ausentes no rompen", () => {
  assert.deepEqual(leerResultados(null), { definitivo: "", provisorio: "" });
  assert.deepEqual(leerResultados([]), { definitivo: "", provisorio: "" });
  assert.deepEqual(leerResultados([{ isFinal: true, length: 0 }]), {
    definitivo: "",
    provisorio: "",
  });
});

test("cada error tiene su salida, no un código", () => {
  assert.match(mensajeDeErrorDeVoz("not-allowed"), /permiso/i);
  assert.match(mensajeDeErrorDeVoz("no-speech"), /escuchamos/i);
  assert.match(mensajeDeErrorDeVoz("audio-capture"), /micrófono/i);
  assert.match(mensajeDeErrorDeVoz("network"), /conexión/i);
  assert.match(mensajeDeErrorDeVoz("cualquier-otra-cosa"), /micrófono/i);
});

test("cortar el dictado a mano no es un error que haya que contar", () => {
  assert.equal(mensajeDeErrorDeVoz("aborted"), "");
});
