import assert from "node:assert/strict";
import test from "node:test";

import {
  armarCita,
  limpiarSeleccion,
  MAXIMO_CITA,
  seleccionDentroDe,
  textoConCita,
} from "./cita.ts";

const RESPUESTA =
  "Registré la venta de 1 Conjunto Verde Oliva por ₲ 185.000.\n\n" +
  "Costo: ₲ 130.000\nGanancia: ₲ 55.000\nMargen estimado: 32%";

test("una selección normal se conserva tal cual", () => {
  assert.equal(limpiarSeleccion("Margen estimado: 32%"), "Margen estimado: 32%");
});

test("los espacios de la sangría del HTML no viajan al prompt", () => {
  assert.equal(limpiarSeleccion("  Margen   estimado:    32%  "), "Margen estimado: 32%");
});

test("los saltos se conservan: una tabla citada sin renglones no se entiende", () => {
  assert.equal(
    limpiarSeleccion("Costo: 130.000\nGanancia: 55.000"),
    "Costo: 130.000\nGanancia: 55.000",
  );
});

test("los renglones vacíos de más se colapsan en uno", () => {
  assert.equal(limpiarSeleccion("uno\n\n\n\ndos"), "uno\ndos");
});

test("el roce de un dedo no es una cita", () => {
  for (const roce of ["", " ", "a", "32", "\n\n"]) {
    assert.equal(limpiarSeleccion(roce), "", `"${roce}" no debería citarse`);
  }
});

test("lo que no es texto tampoco es una cita", () => {
  for (const valor of [null, undefined, 32, {}, ["hola"]]) {
    assert.equal(limpiarSeleccion(valor), "");
  }
});

test("una selección enorme se corta y se ve que se cortó", () => {
  const largo = "a".repeat(MAXIMO_CITA + 500);
  const cita = limpiarSeleccion(largo);

  assert.equal(cita.length, MAXIMO_CITA + 1, "el corte tiene que incluir la marca");
  assert.ok(cita.endsWith("…"), "cortar en silencio hace que el modelo lea una frase que no termina ahí");
});

// ============================================================
// Que la cita sea de ESTE mensaje
// ============================================================

test("una selección del mensaje se reconoce", () => {
  assert.ok(seleccionDentroDe("Margen estimado: 32%", RESPUESTA));
});

test("se reconoce aunque el navegador haya cambiado los saltos por espacios", () => {
  assert.ok(seleccionDentroDe("Ganancia: ₲ 55.000 Margen estimado: 32%", RESPUESTA));
});

test("una selección que cruzó a otra burbuja NO se cita", () => {
  const cruzada = "Margen estimado: 32% ¿por qué es tan bajo?";

  assert.equal(seleccionDentroDe(cruzada, RESPUESTA), false);
  assert.equal(armarCita(cruzada, RESPUESTA, "m-1"), null);
});

test("armar la cita devuelve el fragmento y de qué mensaje salió", () => {
  const cita = armarCita("  Margen estimado: 32%  ", RESPUESTA, "m-1");

  assert.deepEqual(cita, { texto: "Margen estimado: 32%", mensajeId: "m-1" });
});

test("una selección larguísima del propio mensaje se cita igual, recortada", () => {
  const mensaje = "x".repeat(MAXIMO_CITA + 200);
  const cita = armarCita(mensaje, mensaje, "m-2");

  assert.ok(cita, "el recorte no puede hacer que la cita se pierda");
  assert.ok(cita.texto.endsWith("…"));
});

// ============================================================
// Cómo se lo cuenta al modelo cuando solo hay texto
// ============================================================

test("la cita va como cita de correo, antes de la pregunta", () => {
  const texto = textoConCita("¿por qué es 32%?", { texto: "Margen estimado: 32%", mensajeId: "m-1" });

  assert.equal(texto, "> Margen estimado: 32%\n\n¿por qué es 32%?");
});

test("una cita de varias líneas se prefija línea por línea", () => {
  const texto = textoConCita("¿de dónde sale?", {
    texto: "Costo: 130.000\nGanancia: 55.000",
    mensajeId: "m-1",
  });

  assert.equal(texto, "> Costo: 130.000\n> Ganancia: 55.000\n\n¿de dónde sale?");
});

test("sin cita, el mensaje viaja intacto", () => {
  assert.equal(textoConCita("hola", null), "hola");
  assert.equal(textoConCita("hola", { texto: "", mensajeId: "m-1" }), "hola");
});
