import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { aplicar } from "../../n8n/parches/cambios-fecha-legible.mjs";

/**
 * Las fechas de las respuestas del worker de n8n, dichas como las diría una
 * persona ("18 de septiembre" y no "2026-09-18").
 *
 * Toma el código del workflow EXPORTADO —el que corre— y lo ejecuta. Si el
 * parche todavía no se aplicó a n8n, lo aplica sobre una COPIA en memoria y
 * prueba eso: así el cambio se valida antes de tocar producción, y después de
 * aplicarlo el mismo test sigue protegiendo lo que quedó corriendo.
 */

const flujo = JSON.parse(
  readFileSync(new URL("../../n8n/workflows/eos-background-worker-rc1.json", import.meta.url), "utf8"),
);
const nodo = flujo.nodes.find((n: { name: string }) => n.name === "05 INT Respuesta");
const original: string = nodo.parameters.jsCode;
const codigo: string = original.includes("function fechaLarga") ? original : aplicar(original, "copia de prueba");

function cargar<T>(nombres: string[], ...retorno: string[]): T {
  const plata = (n: number) => String(n);
  const signoDe = () => "₲ ";
  // Se evalúa el nodo entero salvo su última parte (la que lee `$input` y `$`).
  const fin = codigo.indexOf("const prep = $('03 INT Preparar Efecto')");
  const cuerpo = codigo.slice(0, fin);
  return new Function("plata", "signoDe", `${cuerpo}\nreturn { ${retorno.join(", ")} };`)(plata, signoDe) as T;
}

type Frases = {
  fechaLarga: (iso: unknown, respaldo?: string) => string;
  fraseDeAnulacionCompra: (r: unknown) => string;
  fraseDeAccion: (accion: string, r: unknown) => string | null;
};

const f = cargar<Frases>([], "fechaLarga", "fraseDeAnulacionCompra", "fraseDeAccion");
const anio = new Date(Date.now() - 3 * 3600000).getUTCFullYear();

test("una fecha de este año se dice con el día y el mes en palabras", () => {
  assert.equal(f.fechaLarga(`${anio}-09-18`), "18 de septiembre");
  assert.equal(f.fechaLarga(`${anio}-01-05`), "5 de enero");
  assert.equal(f.fechaLarga(`${anio}-12-31`), "31 de diciembre");
});

test("de otro año se agrega el año, que es cuando la ambigüedad importa", () => {
  assert.equal(f.fechaLarga("2019-03-02"), "2 de marzo de 2019");
});

test("acepta una fecha con hora, como las guarda la base", () => {
  assert.equal(f.fechaLarga(`${anio}-09-18T14:30:00+00:00`), "18 de septiembre");
});

test("lo que no es una fecha no se inventa: da el respaldo o el texto tal cual", () => {
  assert.equal(f.fechaLarga(undefined, "día"), "día");
  assert.equal(f.fechaLarga("", "día"), "día");
  assert.equal(f.fechaLarga(`${anio}-13-45`, "día"), "día");
  assert.equal(f.fechaLarga("ayer"), "ayer");
  assert.equal(f.fechaLarga(null), "");
});

test("anular una compra dice la fecha en palabras", () => {
  const texto = f.fraseDeAnulacionCompra({
    resultado: { fecha: `${anio}-09-18`, total: 100000, items: [{ cantidad: 5, concepto: "bolsas de harina" }] },
  });
  assert.match(texto, /^Anulé la compra del 18 de septiembre: 5 bolsas de harina, ₲ 100.000./);
  assert.doesNotMatch(texto, /\d{4}-\d{2}-\d{2}/);
});

test("anular una compra sin fecha conocida sigue diciendo 'del día'", () => {
  assert.match(f.fraseDeAnulacionCompra({ resultado: { total: 1, items: [] } }), /^Anulé la compra del día:/);
});

test("ninguna frase de anulación ni de corrección deja una fecha ISO cruda", () => {
  const muestras = [
    f.fraseDeAccion("ANULAR_VENTA", { resultado: { fecha: `${anio}-09-10`, total: 5, items: [] } }),
    f.fraseDeAccion("ANULAR_COMPRA", { resultado: { fecha: `${anio}-09-10`, total: 5, items: [] } }),
  ];
  for (const t of muestras) assert.doesNotMatch(String(t), /\d{4}-\d{2}-\d{2}/);
});

test("el parche es idempotente: no se aplica dos veces", () => {
  assert.throws(() => aplicar(codigo, "ya aplicado"), /ya tiene fechaLarga/);
});
