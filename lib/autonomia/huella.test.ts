import test from "node:test";
import assert from "node:assert/strict";

import { estable, huella } from "./huella.ts";

/**
 * Lo que se prueba acá es una sola cosa: que una venta no se cargue dos veces.
 *
 * Cada caso de abajo es una forma concreta de romper esa garantía, y todas
 * pasan sin hacer ruido: el gate acepta el comando, el worker lo ejecuta, y
 * del otro lado hay stock descontado dos veces y plata que no entró.
 */

// ---------------------------------------------------------------------------
// La misma orden, dos veces, tiene que dar lo mismo
// ---------------------------------------------------------------------------

test("el orden de las claves NO cambia la huella", () => {
  /*
   * Es el caso que de verdad pasa. OpenAI no garantiza el orden de las claves
   * de un objeto JSON, así que el MISMO pedido puede llegar con las claves al
   * revés en el reintento.
   *
   * Sin esto, el gate vería dos comandos distintos y la venta entraría dos
   * veces — justo en el reintento, que es donde la garantía tenía que servir.
   */
  const a = { tipo: "REGISTRAR_VENTA", datos: { contacto: "María", items: [] } };
  const b = { datos: { items: [], contacto: "María" }, tipo: "REGISTRAR_VENTA" };

  assert.equal(huella(a), huella(b));
});

test("el orden de las claves anidadas tampoco", () => {
  const a = { datos: { items: [{ producto: "Chipa", cantidad: 3 }] } };
  const b = { datos: { items: [{ cantidad: 3, producto: "Chipa" }] } };

  assert.equal(huella(a), huella(b));
});

test("la misma orden repetida da exactamente la misma huella", () => {
  const orden = {
    tipo: "REGISTRAR_VENTA",
    datos: { items: [{ producto: "Pan casero", cantidad: 2 }], contacto: "Rossana" },
  };

  assert.equal(huella(orden), huella(structuredClone(orden)));
});

// ---------------------------------------------------------------------------
// Dos órdenes distintas NO pueden dar lo mismo
// ---------------------------------------------------------------------------

test("el ORDEN DE LOS ÍTEMS sí cambia la huella", () => {
  /*
   * Los arreglos no se ordenan, a propósito. En un arreglo el orden es
   * información: "3 chipas y 1 pan" no es el mismo pedido escrito al revés
   * cuando hay precios por renglón.
   *
   * Si se ordenaran, dos ventas distintas darían la misma huella y la segunda
   * se descartaría en silencio.
   */
  const a = { items: [{ p: "Chipa" }, { p: "Pan" }] };
  const b = { items: [{ p: "Pan" }, { p: "Chipa" }] };

  assert.notEqual(huella(a), huella(b));
});

test("cambiar la cantidad cambia la huella", () => {
  const tres = { items: [{ producto: "Chipa", cantidad: 3 }] };
  const treinta = { items: [{ producto: "Chipa", cantidad: 30 }] };

  assert.notEqual(huella(tres), huella(treinta));
});

test("el 3 y el \"3\" no son el mismo pedido", () => {
  // Si el número y su texto dieran la misma huella, un reintento que llega con
  // el tipo cambiado se tomaría por repetido y la venta no entraría nunca.
  assert.notEqual(huella({ cantidad: 3 }), huella({ cantidad: "3" }));
});

test("un campo de más cambia la huella", () => {
  assert.notEqual(
    huella({ tipo: "REGISTRAR_VENTA" }),
    huella({ tipo: "REGISTRAR_VENTA", condicion: "credito" }),
  );
});

test("null, undefined ausente y cadena vacía no son lo mismo", () => {
  /*
   * `JSON.stringify` borra las claves con `undefined`, así que { a: undefined }
   * y {} SÍ dan la misma huella — y está bien, porque el payload que viaja es
   * JSON y allá tampoco existen.
   *
   * Lo que no puede pasar es que `null` y `""` se confundan: son dos estados
   * distintos del mismo campo.
   */
  assert.equal(huella({ a: undefined }), huella({}));
  assert.notEqual(huella({ a: null }), huella({ a: "" }));
  assert.notEqual(huella({ a: null }), huella({}));
});

// ---------------------------------------------------------------------------
// La canonicalización, por dentro
// ---------------------------------------------------------------------------

test("estable ordena los objetos y respeta los arreglos", () => {
  const salida = estable({ b: 1, a: { d: 2, c: [3, { f: 4, e: 5 }] } });

  assert.equal(JSON.stringify(salida), '{"a":{"c":[3,{"e":5,"f":4}],"d":2},"b":1}');
});

test("estable no rompe con lo que no es objeto", () => {
  for (const valor of [null, undefined, 0, "", false, 42, "hola"]) {
    assert.equal(estable(valor), valor);
  }
});

test("estable no se lleva puesta una fecha ni la convierte en {}", () => {
  /*
   * Una fecha es un objeto sin claves propias, así que el reduce la dejaría en
   * `{}` y dos fechas distintas darían la misma huella. Hoy el payload del
   * gate no lleva fechas —los timestamps de inferencia se excluyen a
   * propósito, ver `lib/gateway/jobs.ts`— pero si alguna vez entrara una, esto
   * falla acá y no en producción.
   */
  const a = estable({ f: new Date("2026-09-10T00:00:00Z") });
  const b = estable({ f: new Date("2026-01-01T00:00:00Z") });

  assert.notEqual(JSON.stringify(a), JSON.stringify(b));
});

// ---------------------------------------------------------------------------
// Y que siga siendo la misma huella mañana
// ---------------------------------------------------------------------------

test("la huella de una orden conocida no cambia entre versiones", () => {
  /*
   * Un valor clavado, a propósito.
   *
   * Si alguien cambia cómo se canonicaliza, todas las huellas ya guardadas en
   * producción dejan de coincidir: los reintentos legítimos se ven como
   * comandos nuevos y se ejecutan de nuevo. Esta prueba convierte ese cambio
   * silencioso en un fallo del CI.
   *
   * Si falla, la pregunta no es "¿actualizo el valor?" sino "¿qué le va a
   * pasar a los comandos que ya están guardados?".
   *
   * El valor está CALCULADO, no escrito de memoria. La primera versión de esta
   * prueba llevaba un hex inventado y falló en el acto — que es lo que tiene
   * que pasar, pero vale dejarlo anotado: un valor esperado que uno inventa no
   * prueba nada, solo se acomoda al código.
   */
  const orden = {
    tipo: "REGISTRAR_VENTA",
    datos: { items: [{ producto: "Chipa", cantidad: 3 }], contacto: "Rossana" },
  };

  assert.equal(
    huella(orden),
    "3266493efc4a7a20520eca6595ae6402b009d60fdc0b5cd9a3f300a8b0d9892b",
  );
});
