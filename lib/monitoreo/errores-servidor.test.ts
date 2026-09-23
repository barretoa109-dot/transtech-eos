import assert from "node:assert/strict";
import { test } from "node:test";

import {
  Limitador,
  evaluarErroresServidor,
  limpiarTexto,
  prepararRegistroDeError,
  registrarErrorDeServidor,
  rutaSinQuery,
  type RegistroDeError,
} from "./errores-servidor.ts";

test("borra correos, tokens, ids y números largos del mensaje", () => {
  const limpio = limpiarTexto(
    "falló ana@example.com con 0981 123 456 y RUC 80012345-6, id 11111111-1111-4111-8111-111111111111, jwt eyJhbGc.eyJzdWIi.abc123",
  );
  assert.ok(!limpio.includes("ana@example.com"));
  assert.ok(!limpio.includes("0981"));
  assert.ok(!limpio.includes("80012345"));
  assert.ok(!limpio.includes("11111111-1111"));
  assert.ok(!limpio.includes("eyJhbGc"));
  assert.match(limpio, /\[correo\]/);
});

test("deja los números cortos: 'línea 42' sigue siendo útil", () => {
  assert.equal(limpiarTexto("error en línea 42"), "error en línea 42");
});

test("la ruta nunca guarda la query ni el fragmento", () => {
  assert.equal(rutaSinQuery("/api/pago?token=secreto#x"), "/api/pago");
  assert.equal(rutaSinQuery(undefined), null);
});

test("prefiere la ruta del archivo a la del pedido", () => {
  const r = prepararRegistroDeError(
    new TypeError("x is undefined"),
    { path: "/api/eos?q=1", method: "POST" },
    { routePath: "/api/eos", routeType: "route" },
  );
  assert.equal(r.ruta, "/api/eos");
  assert.equal(r.tipo_ruta, "route");
  assert.equal(r.metodo, "POST");
  assert.equal(r.clase, "TypeError");
});

test("el mismo error con otros números da la misma huella", () => {
  const a = prepararRegistroDeError(new Error("timeout tras 3001 ms"), { path: "/a" }, undefined);
  const b = prepararRegistroDeError(new Error("timeout tras 2999 ms"), { path: "/a" }, undefined);
  const c = prepararRegistroDeError(new Error("timeout tras 3001 ms"), { path: "/b" }, undefined);
  assert.equal(a.huella, b.huella);
  assert.notEqual(a.huella, c.huella);
});

test("acepta cosas que no son Error y guarda el digest de React", () => {
  const r = prepararRegistroDeError({ digest: "123456789" }, undefined, undefined);
  assert.equal(r.clase, "object");
  assert.equal(r.digest, "123456789");
  assert.equal(r.pila, null);
});

test("recorta un mensaje enorme", () => {
  const r = prepararRegistroDeError(new Error("x".repeat(5_000)), undefined, undefined);
  assert.ok(r.mensaje.length <= 500);
});

test("el limitador corta en el máximo y se reinicia al minuto siguiente", () => {
  const l = new Limitador(2);
  const t = 1_000_000_000;
  assert.equal(l.permitir(t), true);
  assert.equal(l.permitir(t + 1), true);
  assert.equal(l.permitir(t + 2), false);
  assert.equal(l.descartados, 1);
  assert.equal(l.permitir(t + 60_000), true);
});

test("registrar nunca lanza, aunque la base falle o explote", async () => {
  const original = console.error;
  console.error = () => {};
  try {
    const filas: RegistroDeError[] = [];
    await registrarErrorDeServidor(new Error("a"), undefined, undefined, async (f) => {
      filas.push(f);
      return { error: null };
    }, new Limitador());
    assert.equal(filas.length, 1);

    await registrarErrorDeServidor(new Error("b"), undefined, undefined, async () => ({
      error: { message: "tabla no existe" },
    }), new Limitador());

    await registrarErrorDeServidor(new Error("c"), undefined, undefined, async () => {
      throw new Error("red caída");
    }, new Limitador());
  } finally {
    console.error = original;
  }
});

test("pasado el límite no llama a la base", async () => {
  const original = console.error;
  console.error = () => {};
  try {
    let llamadas = 0;
    const l = new Limitador(1);
    const insertar = async () => {
      llamadas += 1;
      return { error: null };
    };
    await registrarErrorDeServidor(new Error("a"), undefined, undefined, insertar, l);
    await registrarErrorDeServidor(new Error("a"), undefined, undefined, insertar, l);
    assert.equal(llamadas, 1);
  } finally {
    console.error = original;
  }
});

const AHORA = Date.parse("2026-09-23T12:00:00Z");
const fila = (veces: number, hace_min: number) => ({
  huella: `h${veces}${hace_min}`,
  clase: "TypeError",
  mensaje: "x is undefined",
  ruta: "/api/eos",
  veces,
  ultima_vez: new Date(AHORA - hace_min * 60_000).toISOString(),
});

test("sin errores la salud está verde", () => {
  assert.deepEqual(evaluarErroresServidor([], AHORA), { ok: true, detalle: "ninguna en 24 h" });
});

test("un error suelto se informa pero no pone la salud en rojo", () => {
  const r = evaluarErroresServidor([fila(1, 5)], AHORA);
  assert.equal(r.ok, true);
  assert.match(r.detalle, /1 en 24 h/);
});

test("un error que se repite y sigue pasando pone la salud en rojo", () => {
  const r = evaluarErroresServidor([fila(1, 5), fila(7, 10)], AHORA);
  assert.equal(r.ok, false);
  assert.match(r.detalle, /7× TypeError en \/api\/eos/);
});

test("uno que se repitió pero ya paró hace horas no alarma", () => {
  assert.equal(evaluarErroresServidor([fila(30, 180)], AHORA).ok, true);
});
