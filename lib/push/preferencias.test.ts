import assert from "node:assert/strict";
import test from "node:test";

import { cambioDePreferencia, esClaveDeNotificacion, leerPreferencias } from "./preferencias.ts";

test("sin fila, o sin las columnas nuevas, se recibe todo", () => {
  const todo = { manana: true, mediodia: true, noche: true, agenda: true, riesgos: true };
  assert.deepEqual(leerPreferencias(null), todo);
  assert.deepEqual(leerPreferencias({ avisos_motivacionales_push: true }), todo);
});

test("el interruptor viejo apagado apaga las tres franjas, y nada más", () => {
  assert.deepEqual(leerPreferencias({ avisos_motivacionales_push: false, push_manana: true }), {
    manana: false,
    mediodia: false,
    noche: false,
    agenda: true,
    riesgos: true,
  });
});

test("apagar una franja no toca las otras", () => {
  const cambio = cambioDePreferencia(null, "noche", false);
  assert.deepEqual(cambio, {
    push_manana: true,
    push_mediodia: true,
    push_noche: false,
    avisos_motivacionales_push: true,
  });
  assert.deepEqual(leerPreferencias(cambio), { manana: true, mediodia: true, noche: false, agenda: true, riesgos: true });
});

test("encender una franja con el general apagado no enciende de rebote las otras dos", () => {
  const antes = { avisos_motivacionales_push: false };
  const despues = { ...antes, ...cambioDePreferencia(antes, "manana", true) };
  assert.deepEqual(leerPreferencias(despues), { manana: true, mediodia: false, noche: false, agenda: true, riesgos: true });
});

test("agenda y riesgos escriben solo su columna", () => {
  assert.deepEqual(cambioDePreferencia(null, "agenda", false), { avisos_agenda: false });
  assert.deepEqual(cambioDePreferencia(null, "riesgos", false), { avisos_riesgo_push: false });
});

test("una clave desconocida no es una notificación", () => {
  assert.equal(esClaveDeNotificacion("noche"), true);
  assert.equal(esClaveDeNotificacion("habilitado"), false);
  assert.equal(esClaveDeNotificacion(7), false);
});
