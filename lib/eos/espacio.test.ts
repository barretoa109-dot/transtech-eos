import assert from "node:assert/strict";
import { test } from "node:test";

import {
  encabezadoDeEspacio,
  espacioDelPedido,
  filtroDeMemorias,
  nombreDelEspacio,
} from "./espacio.ts";

/**
 * El espacio del turno: lo que el chat no sabía hasta la v259.
 *
 * El 11/11/2026, parado en "Mi negocio", EOS contestó "dame un resumen de mis
 * objetivos actuales" con la American Express de la persona y la granja en el
 * mismo párrafo. Este módulo es la mitad de la corrección que vive fuera de la
 * base: decide si el turno tiene espacio y, cuando lo tiene, se lo dice al
 * modelo antes de cualquier cifra.
 */

test("reconoce los dos espacios, como vengan escritos", () => {
  assert.equal(espacioDelPedido("personal"), "personal");
  assert.equal(espacioDelPedido("negocio"), "negocio");
  assert.equal(espacioDelPedido(" Negocio "), "negocio");
  assert.equal(espacioDelPedido("PERSONAL"), "personal");
});

test("lo que no se reconoce es 'este canal no tiene espacios', no un error", () => {
  /*
   * WhatsApp no manda ninguno y una pestaña vieja tampoco. En los dos casos
   * el contexto sale mezclado, que es exactamente lo que esos clientes
   * esperan: esconderles media cuenta sin avisar sería peor.
   */
  assert.equal(espacioDelPedido(undefined), null);
  assert.equal(espacioDelPedido(null), null);
  assert.equal(espacioDelPedido(""), null);
  assert.equal(espacioDelPedido("empresa"), null);
  assert.equal(espacioDelPedido(42), null);
  assert.equal(espacioDelPedido({ ambito: "negocio" }), null);
});

test("sin espacio no se escribe encabezado", () => {
  // Una línea que dijera "estás en algún lado" sería ruido pago en cada
  // mensaje de WhatsApp.
  assert.equal(encabezadoDeEspacio(null), "");
});

test("el encabezado del negocio deja afuera la plata de la persona y nombra el otro espacio", () => {
  const texto = encabezadoDeEspacio("negocio");

  assert.match(texto, /espacio "Mi negocio"/);
  assert.match(texto, /tarjetas/);
  // Que no esté no quiere decir que no exista: sin esta parte, EOS contesta
  // "no tengo tus tarjetas" y se lee como que se rompió.
  assert.match(texto, /lo ve en "Personal"/);
  assert.match(texto, /no quiere decir que no exista/);
});

test("el encabezado personal deja afuera el negocio y nombra el otro espacio", () => {
  const texto = encabezadoDeEspacio("personal");

  assert.match(texto, /espacio "Personal"/);
  assert.match(texto, /ventas, catálogo, stock/);
  assert.match(texto, /lo ve en "Mi negocio"/);
  assert.match(texto, /no quiere decir que no exista/);
});

test("cada encabezado dice de quién es lo que se cree desde ahí", () => {
  /*
   * `REGISTRAR_GASTO_FIJO` y `CREAR_OBJETIVO` son las dos acciones que llevan
   * ámbito y que el modelo tiene que decidir. El prompt ya le dice que, si el
   * contexto lo deja claro, alcanza: el espacio ES el contexto.
   */
  assert.match(encabezadoDeEspacio("negocio"), /sin decir de quién es,\nes del negocio/);
  assert.match(encabezadoDeEspacio("personal"), /sin decir de quién es,\nes personal/);
});

test("los espacios se nombran como en la pantalla", () => {
  // El modelo le va a decir a la persona dónde buscar lo que no está acá: si
  // lo nombra distinto de como figura en el menú, la manda a un lugar que no
  // existe.
  assert.equal(nombreDelEspacio("negocio"), "Mi negocio");
  assert.equal(nombreDelEspacio("personal"), "Personal");
});

test("la memoria se lee del espacio, y también la que no tiene ninguno", () => {
  /*
   * Lo guardado antes de la v259 no tiene ámbito y no se puede repartir sin
   * inventar: se sigue viendo en los dos lados. Si se escondiera, EOS se
   * olvidaría de lo que le contaron, que es el problema que la memoria vino a
   * resolver.
   */
  assert.equal(filtroDeMemorias("negocio"), "ambito.is.null,ambito.eq.negocio");
  assert.equal(filtroDeMemorias("personal"), "ambito.is.null,ambito.eq.personal");
});

test("sin espacio, la memoria se lee sin filtro", () => {
  assert.equal(filtroDeMemorias(null), null);
});
