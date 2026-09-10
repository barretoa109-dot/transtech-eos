import test from "node:test";
import assert from "node:assert/strict";

import {
  ERROR_COLGADO,
  estaEscuchando,
  fusionarDictado,
  leerResultados,
  mensajeDeErrorDeVoz,
  puedeEscribir,
  siguienteEstado,
  soportaDictado,
  type EstadoDictado,
  type EventoDictado,
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

// ============================================================
// El micrófono que quedaba trabado en rojo
// ============================================================
//
// Reportado desde un teléfono el 9 de septiembre de 2026: se aprieta el
// micrófono, el navegador no tiene permiso, aparece el aviso… y el botón se
// queda rojo latiendo con "Escuchando…". No sale más de ahí y hay que
// recargar. La causa era que `onerror` mostraba el mensaje y no apagaba nada,
// y que el apagado dependía de `onend`, que con el permiso denegado no llega
// en iOS ni en varios Android.

/** Corre una secuencia de eventos desde inactivo, como lo hace el hook. */
function correr(eventos: EventoDictado[]) {
  let estado: EstadoDictado = "inactivo";
  let error = "";
  let solturas = 0;

  for (const evento of eventos) {
    const t = siguienteEstado(estado, evento);
    estado = t.estado;
    error = t.error;
    if (t.soltar) solturas += 1;
  }

  return { estado, error, solturas };
}

test("permiso denegado: sale de escuchando, avisa y suelta el micrófono", () => {
  const r = correr([{ tipo: "pedir" }, { tipo: "error", codigo: "not-allowed" }]);

  assert.equal(r.estado, "inactivo", "se quedó escuchando con el permiso denegado");
  assert.equal(r.solturas, 1, "no soltó el micrófono");
  assert.match(r.error, /permiso/i);
  assert.ok(puedeEscribir(r.estado), "el chat quedó bloqueado");
});

test("permiso denegado sin `onend`: no hace falta que el navegador avise dos veces", () => {
  // Es EXACTAMENTE el caso de iOS: llega `onerror` y `onend` nunca.
  const r = correr([{ tipo: "pedir" }, { tipo: "error", codigo: "not-allowed" }]);

  assert.equal(estaEscuchando(r.estado), false);
});

test("cancelar a mano apaga sin esperar ningún evento del navegador", () => {
  const r = correr([{ tipo: "pedir" }, { tipo: "abrio" }, { tipo: "cancelar" }]);

  assert.equal(r.estado, "inactivo");
  assert.equal(r.solturas, 1);
  assert.equal(r.error, "", "cortar a propósito no es un error que haya que contar");
});

test("cancelar cuando todavía se estaba pidiendo el permiso también apaga", () => {
  const r = correr([{ tipo: "pedir" }, { tipo: "cancelar" }]);

  assert.equal(r.estado, "inactivo");
  assert.equal(r.solturas, 1);
});

test("un error cualquiera del reconocedor deja el estado limpio", () => {
  for (const codigo of ["network", "audio-capture", "aborted", "no-speech", "raro", undefined]) {
    const r = correr([{ tipo: "pedir" }, { tipo: "abrio" }, { tipo: "error", codigo }]);

    assert.equal(r.estado, "inactivo", `${codigo} dejó el micrófono prendido`);
    assert.equal(r.solturas, 1, `${codigo} no soltó el micrófono`);
    assert.ok(puedeEscribir(r.estado));
  }
});

test("si el navegador no dice nada, el temporizador lo apaga igual", () => {
  const r = correr([{ tipo: "pedir" }, { tipo: "vencio" }]);

  assert.equal(r.estado, "inactivo");
  assert.equal(r.solturas, 1);
  assert.equal(r.error, ERROR_COLGADO);
});

test("NINGÚN evento deja el micrófono prendido sin que se haya abierto", () => {
  const eventos: EventoDictado[] = [
    { tipo: "error", codigo: "not-allowed" },
    { tipo: "error", codigo: "network" },
    { tipo: "fin" },
    { tipo: "cancelar" },
    { tipo: "vencio" },
  ];

  for (const estado of ["inactivo", "pidiendo_permiso", "escuchando"] as const) {
    for (const evento of eventos) {
      const t = siguienteEstado(estado, evento);

      assert.equal(
        estaEscuchando(t.estado),
        false,
        `desde ${estado}, ${evento.tipo} dejó la interfaz escuchando`,
      );
      assert.equal(t.soltar, true, `desde ${estado}, ${evento.tipo} no soltó el micrófono`);
    }
  }
});

test("solo 'abrio' enciende: apretar el botón no alcanza para decir que graba", () => {
  const pidiendo = siguienteEstado("inactivo", { tipo: "pedir" });

  assert.equal(pidiendo.estado, "pidiendo_permiso");
  assert.equal(estaEscuchando(pidiendo.estado), false, "dijo que grababa sin micrófono abierto");

  const abierto = siguienteEstado(pidiendo.estado, { tipo: "abrio" });
  assert.equal(estaEscuchando(abierto.estado), true);
});

test("pedir dos veces no arranca dos reconocedores", () => {
  const uno = siguienteEstado("escuchando", { tipo: "pedir" });

  assert.equal(uno.estado, "escuchando");
  assert.equal(uno.soltar, false);
});

test("se puede escribir en cualquier estado del dictado", () => {
  for (const estado of ["inactivo", "pidiendo_permiso", "escuchando"] as const) {
    assert.ok(puedeEscribir(estado), `${estado} bloqueaba el teclado`);
  }
});
