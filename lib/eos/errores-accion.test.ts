import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { CODIGOS_DE_NEGOCIO, detalleDelError, errorDeAccion } from "./errores-accion.ts";

test("el nombre que no se pudo resolver llega al mensaje", () => {
  // Es el único dato accionable del error, y era el que se descartaba.
  const e = errorDeAccion("EOS_ACCION_CONTACTO_NO_RESUELTO: Rossana")!;

  assert.ok(e);
  assert.match(e.mensaje, /Rossana/);
  assert.equal(e.estado, 422);
});

test("el mensaje dice el siguiente paso, no solo qué pasó", () => {
  /*
   * El siguiente paso del producto que no está cambió el 7 de septiembre.
   *
   * Antes era "cargalo en Negocio > Productos": mandar a la persona a otra
   * pantalla era lo único posible, porque EOS no sabía crear productos. Desde
   * la v131 sí sabe, así que el paso más corto es que lo diga acá mismo y
   * siga la conversación.
   */
  const producto = errorDeAccion("EOS_ACCION_PRODUCTO_NO_RESUELTO: balanceado")!;
  assert.match(producto.mensaje, /pasame el precio de venta/i);

  const contacto = errorDeAccion("EOS_ACCION_CONTACTO_NO_RESUELTO: Rossana")!;
  assert.match(contacto.mensaje, /agendá a Rossana/i);
});

test("el mensaje real de Postgres, tal como llega", () => {
  // Con prefijos y sufijos alrededor: el cliente de Supabase envuelve el
  // mensaje, así que buscar el código pegado al principio no sirve.
  const crudo = 'EOS_ACCION_PRODUCTO_NO_RESUELTO: Bolsa de balanceado 40kg';
  assert.match(errorDeAccion(crudo)!.mensaje, /Bolsa de balanceado 40kg/);
});

test("un error sin detalle no deja comillas vacías", () => {
  const e = errorDeAccion("EOS_ACCION_PRODUCTO_NO_RESUELTO")!;

  assert.ok(e);
  assert.doesNotMatch(e.mensaje, /""/);
});

test("los seis códigos se reconocen", () => {
  for (const codigo of CODIGOS_DE_NEGOCIO) {
    assert.ok(errorDeAccion(`${codigo}: algo`), `${codigo} no se reconoce`);
  }
});

test("un error que nadie previó sigue siendo un error del servidor", () => {
  // Disfrazarlo de mensaje amable escondería una falla real.
  assert.equal(errorDeAccion("could not connect to server"), null);
  assert.equal(errorDeAccion("EOS_INTERNAL_EFFECT_COMMAND_NOT_FOUND"), null);
  assert.equal(errorDeAccion(""), null);
});

test("ningún mensaje al usuario deja escapar el código interno", () => {
  // "EOS_ACCION_PRODUCTO_NO_RESUELTO" en pantalla no le sirve a nadie, y
  // encima parece que se rompió algo.
  for (const codigo of CODIGOS_DE_NEGOCIO) {
    const e = errorDeAccion(`${codigo}: X`)!;
    assert.doesNotMatch(e.mensaje, /EOS_ACCION_/);
  }
});

test("detalleDelError separa el texto del código", () => {
  assert.equal(detalleDelError("EOS_ACCION_CONTACTO_NO_RESUELTO: Juan Pérez", "EOS_ACCION_CONTACTO_NO_RESUELTO"), "Juan Pérez");
  assert.equal(detalleDelError("EOS_ACCION_CONTACTO_SIN_NOMBRE", "EOS_ACCION_CONTACTO_SIN_NOMBRE"), "");
  assert.equal(detalleDelError("otra cosa", "EOS_ACCION_X"), "");
});

test("la lista cubre TODOS los códigos que levantan las migraciones", () => {
  /*
   * El invariante que evita que esto se desactualice: si alguien agrega una
   * excepción nueva en SQL y no la traduce acá, vuelve a caer en el 500
   * genérico y el usuario vuelve a quedarse sin saber qué pasó. Que lo diga
   * una prueba y no un comentario.
   */
  const raiz = path.resolve(import.meta.dirname, "..", "..");
  const dir = path.join(raiz, "supabase", "migraciones");
  const carpeta = fs.existsSync(dir) ? dir : path.join(raiz, "supabase", "migrations");

  const enSql = new Set<string>();
  for (const archivo of fs.readdirSync(carpeta)) {
    if (!archivo.endsWith(".sql")) continue;
    const texto = fs.readFileSync(path.join(carpeta, archivo), "utf8");
    for (const m of texto.matchAll(/raise exception '(EOS_ACCION_[A-Z_]+)/g)) enSql.add(m[1]);
  }

  assert.ok(enSql.size > 0, "no se encontró ninguna excepción EOS_ACCION_ en las migraciones");

  const sinTraducir = [...enSql].filter((c) => !CODIGOS_DE_NEGOCIO.includes(c));
  assert.deepEqual(sinTraducir, [], `códigos sin traducción: ${sinTraducir.join(", ")}`);
});
