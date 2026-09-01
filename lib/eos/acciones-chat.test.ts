import assert from "node:assert/strict";
import test from "node:test";

import { agregarAccesoAprobacion, corregirAfirmacionSinAccion } from "./acciones-chat.ts";

test("las acciones de negocio muestran cómo completar el registro", () => {
  const respuesta = agregarAccesoAprobacion(
    "Dejé la venta lista para confirmar.",
    [{ tipo: "REGISTRAR_VENTA" }],
    "https://transtech.com.py",
    true,
  );

  assert.match(respuesta, /aprobá la operación pendiente/i);
  assert.match(respuesta, /https:\/\/transtech\.com\.py\/eos\/autonomy/);
});

test("una respuesta informativa no agrega una aprobación", () => {
  assert.equal(
    agregarAccesoAprobacion("Este es tu resumen.", [], "https://transtech.com.py", false),
    "Este es tu resumen.",
  );
});

// ============================================================
// Que EOS no diga que hizo algo que no hizo
// ============================================================
//
// Lo reportó una clienta: le pidió por chat que anotara un dato, EOS contestó
// que sí, que ya estaba, y no había anotado nada.

test("corrige cuando el usuario pidió anotar, EOS dice que lo hizo y no hubo acción", () => {
  const corregida = corregirAfirmacionSinAccion(
    "Listo, ya lo anoté en tu sistema.",
    [],
    "anotá que compré 3 cajas a 50.000",
  );

  assert.ok(corregida.startsWith("⚠️ **No lo registré.**"));
  assert.ok(corregida.includes("Listo, ya lo anoté en tu sistema."));
});

test("reconoce las formas en que un modelo dice que ya está", () => {
  const frases = [
    "Ya quedó registrado.",
    "Ya está guardado en tu cuenta.",
    "Lo registré correctamente.",
    "Anoté el movimiento.",
    "Ya lo cargué.",
    "Quedó anotado en el sistema.",
    "Listo, lo agregué a tus productos.",
    "Actualicé el stock.",
  ];

  for (const frase of frases) {
    const corregida = corregirAfirmacionSinAccion(frase, [], "registrá esto por favor");
    assert.ok(
      corregida.startsWith("⚠️"),
      `no detectó la afirmación en: ${frase}`,
    );
  }
});

// ============================================================
// Y que no corrija de más, porque eso también es mentir
// ============================================================

test("no corrige si EOS explica cómo hacerlo en vez de afirmar que lo hizo", () => {
  const respuesta =
    "Para registrarlo, andá a la sección Negocio y cargalo en Compras. Ahí queda guardado.";

  assert.equal(
    corregirAfirmacionSinAccion(respuesta, [], "cómo registro una compra"),
    respuesta,
  );
});

test("no corrige si SÍ se pidió una acción: para eso está el aviso de aprobación", () => {
  const respuesta = "Listo, ya registré la venta.";

  assert.equal(
    corregirAfirmacionSinAccion(respuesta, [{ tipo: "REGISTRAR_VENTA" }], "registrá una venta"),
    respuesta,
  );
});

test("no corrige una respuesta que solo informa, sin que se haya pedido escribir", () => {
  const respuesta = "Este mes vendiste ₲ 3.000.000 y te deben ₲ 500.000.";

  assert.equal(
    corregirAfirmacionSinAccion(respuesta, [], "cómo venimos este mes"),
    respuesta,
  );
});

test("no corrige dos veces la misma respuesta", () => {
  const una = corregirAfirmacionSinAccion("Ya lo anoté.", [], "anotá esto");
  const dos = corregirAfirmacionSinAccion(una, [], "anotá esto");

  assert.equal(una, dos);
});

test("la corrección va ADELANTE, para que se lea antes que la afirmación falsa", () => {
  const corregida = corregirAfirmacionSinAccion("Ya quedó guardado.", [], "guardá este dato");

  assert.ok(corregida.indexOf("No lo registré") < corregida.indexOf("Ya quedó guardado"));
});

// ============================================================
// Y que no prometa una aprobación que no existe
// ============================================================
//
// Lo encontró una clienta: el chat le mostraba "Operación lista para
// registrar" con su botón, apretaba, y la pantalla de aprobaciones decía "No
// tenés aprobaciones pendientes". La última aprobación que el sistema había
// creado era de once días antes.

test("sin aprobación real, dice que NO se guardó nada", () => {
  const respuesta = agregarAccesoAprobacion(
    "Dejo lista para confirmar la venta de 1 jean blanco a Caro por Gs. 145.000.",
    [{ tipo: "REGISTRAR_VENTA" }],
    "https://transtech.com.py",
    false,
  );

  assert.ok(respuesta.startsWith("⚠️ **No llegué a dejarlo listo.**"));
  assert.match(respuesta, /no se guardó nada/i);
  assert.ok(!respuesta.includes("/eos/autonomy"), "mandó a una pantalla vacía");
});

test("y le dice dónde cargarlo para que quede de verdad", () => {
  const respuesta = agregarAccesoAprobacion(
    "Listo para confirmar.",
    [{ tipo: "AJUSTAR_STOCK" }],
    "https://transtech.com.py",
    false,
  );

  assert.match(respuesta, /secci[óo]n Negocio/i);
});

test("con aprobación real, sí manda al camino que la completa", () => {
  const respuesta = agregarAccesoAprobacion(
    "Listo para confirmar.",
    [{ tipo: "CREAR_CONTACTO" }],
    "https://transtech.com.py",
    true,
  );

  assert.match(respuesta, /https:\/\/transtech\.com\.py\/eos\/autonomy/);
  assert.ok(!respuesta.includes("No llegué a dejarlo listo"));
});

test("el aviso va adelante: la promesa falsa no se lee primero", () => {
  const respuesta = agregarAccesoAprobacion(
    "Dejo lista la venta.",
    [{ tipo: "REGISTRAR_VENTA" }],
    "https://transtech.com.py",
    false,
  );

  assert.ok(respuesta.indexOf("No llegué") < respuesta.indexOf("Dejo lista"));
});

test("una acción que no es de negocio no toca la respuesta", () => {
  const respuesta = "Te armé el resumen.";

  assert.equal(
    agregarAccesoAprobacion(respuesta, [{ tipo: "RESPONDER" }], "https://x.py", false),
    respuesta,
  );
});
