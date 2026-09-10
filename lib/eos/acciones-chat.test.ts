import assert from "node:assert/strict";
import test from "node:test";

import {
  avisoDeVerificacion,
  corregirAfirmacionFallida,
  corregirAfirmacionSinAccion,
  dejaEfectoDurable,
} from "./acciones-chat.ts";
import { leerEvidencia, verificarAcciones } from "./verificacion.ts";

const ORIGEN = "https://transtech.com.py";

/** Lo mismo que hace `app/api/eos/route.ts`, en una línea. */
function comoLaRuta(
  respuesta: string,
  acciones: { tipo?: unknown }[],
  worker: unknown,
  hayAprobacionPendiente = false,
) {
  const verificaciones = verificarAcciones(
    acciones,
    leerEvidencia(worker),
    hayAprobacionPendiente,
  );

  return avisoDeVerificacion(
    corregirAfirmacionFallida(respuesta, verificaciones),
    verificaciones,
    ORIGEN,
  );
}

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
// La venta que SÍ entró y EOS dijo que no
// ============================================================
//
// El caso real del 9 de septiembre de 2026. Una usuaria escribió "vendí un
// conjunto verde oliva talle S a 185.000gs". El worker registró la venta y la
// respuesta salió encabezada por "⚠️ No llegué a dejarlo listo… no se guardó
// nada. Cargalo desde la sección Negocio", porque la ruta deducía el resultado
// de que no hubiera una aprobación pendiente — y desde el 3 de septiembre una
// venta que sale bien no deja ninguna.

test("una venta ejecutada NO se anuncia como perdida", () => {
  const respuesta = comoLaRuta(
    "Registro la venta de 1 conjunto verde oliva por ₲ 185.000.\n\nLa venta quedó registrada. La ves en Negocio > Ventas.",
    [{ tipo: "REGISTRAR_VENTA" }],
    { ok: true, acciones_ejecutadas: ["REGISTRAR_VENTA"], acciones_idempotentes: [], errores: [] },
  );

  assert.ok(!respuesta.includes("No llegué a dejarlo listo"), "dijo que no se guardó una venta que sí entró");
  assert.ok(!respuesta.includes("no se guardó nada"));
  assert.match(respuesta, /quedó registrada/);
});

test("un reintento reconocido tampoco se anuncia como perdido", () => {
  const respuesta = comoLaRuta(
    "Registro la venta.",
    [{ tipo: "REGISTRAR_VENTA" }],
    { ok: true, acciones_ejecutadas: [], acciones_idempotentes: ["REGISTRAR_VENTA"], errores: [] },
  );

  assert.ok(!respuesta.includes("No llegué a dejarlo listo"));
});

test("si el worker informó un fallo, no se agrega el aviso genérico encima del motivo", () => {
  const motivo =
    'No encontré "conjunto verde oliva talle S" entre tus productos, o hay más de uno que se llama parecido.';

  const respuesta = comoLaRuta(
    `Registro la venta de 1 conjunto verde oliva por ₲ 185.000.\n\n${motivo}`,
    [{ tipo: "REGISTRAR_VENTA" }],
    {
      ok: false,
      acciones_ejecutadas: [],
      acciones_idempotentes: [],
      errores: [{ accion: "REGISTRAR_VENTA", error: motivo }],
    },
  );

  assert.ok(!respuesta.includes("No llegué a dejarlo listo"), "tapó el motivo con un aviso genérico");
  assert.ok(respuesta.includes(motivo), "perdió el único dato accionable");
});

test("si falló y el texto igual habla en pasado, se corrige", () => {
  const respuesta = comoLaRuta(
    "Listo, ya registré la venta del conjunto verde oliva.",
    [{ tipo: "REGISTRAR_VENTA" }],
    {
      ok: false,
      acciones_ejecutadas: [],
      acciones_idempotentes: [],
      errores: [{ accion: "REGISTRAR_VENTA", error: "No encontré el producto." }],
    },
  );

  assert.ok(respuesta.startsWith("⚠️ **No quedó guardado.**"));
  assert.ok(respuesta.indexOf("No quedó guardado") < respuesta.indexOf("ya registré"));
});

test("con dos acciones y una que anduvo, no se corrige el pasado: puede referirse a esa", () => {
  const respuesta = comoLaRuta(
    "Listo, ya cargué el producto y registré la venta.",
    [{ tipo: "CREAR_PRODUCTO" }, { tipo: "REGISTRAR_VENTA" }],
    {
      ok: false,
      acciones_ejecutadas: ["CREAR_PRODUCTO"],
      acciones_idempotentes: [],
      errores: [{ accion: "REGISTRAR_VENTA", error: "Sin stock." }],
    },
  );

  assert.ok(!respuesta.includes("No quedó guardado"));
  assert.ok(!respuesta.includes("No llegué a dejarlo listo"));
});

// ============================================================
// Y el caso en el que el aviso SÍ corresponde
// ============================================================
//
// Lo encontró una clienta antes: el chat mostraba "Operación lista para
// registrar" con su botón, apretaba, y la pantalla de aprobaciones decía "No
// tenés aprobaciones pendientes". La última aprobación era de once días antes.

test("sin ninguna noticia del worker, dice que no lo puede dar por guardado", () => {
  const respuesta = comoLaRuta(
    "Dejo lista para confirmar la venta de 1 jean blanco a Caro por ₲ 145.000.",
    [{ tipo: "REGISTRAR_VENTA" }],
    undefined,
  );

  assert.ok(respuesta.startsWith("⚠️ **No llegué a dejarlo listo.**"));
  assert.match(respuesta, /no puedo darlo por guardado/i);
  assert.ok(!respuesta.includes("/eos/autonomy"), "mandó a una pantalla vacía");
});

test("el worker que contesta vacío tampoco alcanza para dar algo por hecho", () => {
  const respuesta = comoLaRuta(
    "Dejo lista la venta.",
    [{ tipo: "REGISTRAR_VENTA" }],
    { ok: true, acciones_ejecutadas: [], acciones_idempotentes: [], errores: [] },
  );

  assert.ok(respuesta.startsWith("⚠️ **No llegué a dejarlo listo.**"));
});

test("el aviso va adelante: la promesa falsa no se lee primero", () => {
  const respuesta = comoLaRuta("Dejo lista la venta.", [{ tipo: "REGISTRAR_VENTA" }], undefined);

  assert.ok(respuesta.indexOf("No llegué") < respuesta.indexOf("Dejo lista"));
});

test("con aprobación pendiente de verdad, manda al camino que la completa", () => {
  const respuesta = comoLaRuta(
    "Listo para confirmar.",
    [{ tipo: "CREAR_CONTACTO" }],
    undefined,
    true,
  );

  assert.match(respuesta, /https:\/\/transtech\.com\.py\/eos\/autonomy/);
  assert.ok(!respuesta.includes("No llegué a dejarlo listo"));
});

test("una acción sin efecto durable no toca la respuesta", () => {
  const respuesta = "Te armé el resumen.";

  assert.equal(comoLaRuta(respuesta, [{ tipo: "RESPONDER" }], undefined), respuesta);
  assert.equal(comoLaRuta(respuesta, [{ tipo: "VER_DASHBOARD" }], undefined), respuesta);
});

test("una respuesta informativa sin acciones no agrega nada", () => {
  assert.equal(comoLaRuta("Este es tu resumen.", [], undefined), "Este es tu resumen.");
});

test("no avisa dos veces sobre la misma respuesta", () => {
  const una = comoLaRuta("Dejo lista la venta.", [{ tipo: "REGISTRAR_VENTA" }], undefined);
  const dos = avisoDeVerificacion(
    una,
    verificarAcciones([{ tipo: "REGISTRAR_VENTA" }], leerEvidencia(undefined), false),
    ORIGEN,
  );

  assert.equal(una, dos);
});

// ============================================================
// Las nueve acciones que nadie verificaba
// ============================================================
//
// La lista escrita a mano tenía tres —venta, stock, contacto— cuando el
// sistema ya tenía doce. Una compra, un pago de deuda o una corrección podían
// fallar sin que la ruta se enterara.

test("las acciones con efecto durable se verifican TODAS, no tres", () => {
  const durables = [
    "REGISTRAR_VENTA",
    "AJUSTAR_STOCK",
    "CREAR_CONTACTO",
    "CREAR_PRODUCTO",
    "ACTUALIZAR_PRODUCTO",
    "REGISTRAR_COMPRA",
    "REGISTRAR_GASTO_FIJO",
    "REGISTRAR_MOVIMIENTO_PERSONAL",
    "REGISTRAR_TRANSFERENCIA",
    "REGISTRAR_DEUDA",
    "REGISTRAR_PAGO_DEUDA",
    "CORREGIR_MOVIMIENTO",
    "CREAR_TAREA",
    "CREAR_OBJETIVO",
    "GUARDAR_MEMORIA",
  ];

  for (const tipo of durables) {
    assert.ok(dejaEfectoDurable([{ tipo }]), `${tipo} no se estaba verificando`);

    const respuesta = comoLaRuta("Lo dejo listo.", [{ tipo }], undefined);
    assert.ok(respuesta.startsWith("⚠️"), `${tipo} pasó sin verificar`);
  }
});

test("las de solo lectura no dejan efecto y no se verifican", () => {
  for (const tipo of ["RESPONDER", "VER_DASHBOARD", "VER_BRIEFING"]) {
    assert.ok(!dejaEfectoDurable([{ tipo }]), `${tipo} no deja nada escrito`);
  }
});
