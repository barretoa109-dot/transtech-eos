import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * La respuesta de CREAR_PRODUCTO la arma el worker de n8n (`fraseDeProductos`,
 * nodo "05 INT Respuesta"), no TypeScript. Este test toma la función del
 * workflow EXPORTADO —el que corre— y la ejecuta con resultados de ejemplo, para
 * que un cambio en n8n que rompa el aviso de "sin precio" falle acá.
 *
 * Contexto: con la v181 un producto sin precio de venta ya no aborta la lista
 * entera; se saltea y se devuelve en `sin_precio`. La persona tiene que enterarse
 * de cuál faltó, o cree que quedó todo cargado.
 */

const flujo = JSON.parse(
  readFileSync(new URL("../../n8n/workflows/eos-background-worker-rc1.json", import.meta.url), "utf8"),
);
const nodo = flujo.nodes.find((n: { name: string }) => n.name === "05 INT Respuesta");
const codigo: string = nodo.parameters.jsCode;

const inicio = codigo.indexOf("function fraseDeProductos");
const fin = codigo.indexOf("\n}\n", inicio) + 3;
const plata = (n: number) => String(n);
const fraseDeProductos = new Function(
  "plata",
  `${codigo.slice(inicio, fin)}\nreturn fraseDeProductos;`,
)(plata) as (r: unknown) => string;

const con = (resultado: Record<string, unknown>) => fraseDeProductos({ resultado });

test("un producto sin precio se nombra y se pide el precio", () => {
  const texto = con({ creados: [{ nombre: "Alambrado" }], sin_precio: ["Bebederos"] });

  assert.match(texto, /Cargué “Alambrado” en tu catálogo\./);
  assert.match(texto, /No cargué “Bebederos” porque me falta a cuánto lo vendés/);
});

test("varios sin precio se nombran todos", () => {
  const texto = con({ creados: [{ nombre: "A" }], sin_precio: ["Lechones", "Vitamina"] });

  assert.match(texto, /No cargué “Lechones”, “Vitamina” porque me falta a cuánto los vendés/);
});

test("sin `sin_precio` la frase es la de siempre (tolera la base sin la v181)", () => {
  assert.equal(
    con({ creados: [{ nombre: "Alambrado" }] }),
    "Cargué “Alambrado” en tu catálogo. Los ves en Negocio > Productos.",
  );
});

test("si todo tenía precio no se agrega ningún aviso", () => {
  assert.doesNotMatch(con({ creados: [{ nombre: "A" }, { nombre: "B" }], sin_precio: [] }), /No cargué/);
});
