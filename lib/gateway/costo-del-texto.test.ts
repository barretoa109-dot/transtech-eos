import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { aplicar } from "../../n8n/parches/cambios-costo-del-texto.mjs";
import { costoDesdeLaRespuesta } from "./jobs.ts";
import type { Accion } from "./respuesta.ts";

/**
 * Si el modelo le muestra a la persona un costo y se olvida de mandarlo en la
 * venta, el gateway lo copia al ítem (25/09/2026, caso de Sofía). En el gateway
 * TypeScript y en el nodo 06 de n8n por igual.
 */

// El texto real de la captura, tal cual.
const SOFIA = [
  "Margen bruto:",
  "",
  "- Zapatos Mary Jane: venta ₲180.000, costo ₲146.473,876, ganancia ₲33.526,124, margen 18,63%.",
  "- Maija pantalones: venta ₲128.000, costo ₲116.382,076, ganancia ₲11.617,924, margen 9,08%.",
  "",
  "Total venta: ₲308.000. Ganancia bruta total: ₲45.144,048. Margen bruto total: 14,66%.",
].join("\n");

const VENTA: Accion = {
  tipo: "REGISTRAR_VENTA",
  datos: {
    items: [
      { producto: "Zapatos Mary Jane", cantidad: 1, precio_unitario: 180000 },
      { producto: "Maija pantalones", cantidad: 1, precio_unitario: 128000 },
    ],
  },
};

type Item = Record<string, unknown>;
const items = (acciones: Accion[]) => acciones[0].datos.items as Item[];

function n8n(acciones: Accion[], respuesta: string): Accion[] {
  const flujo = JSON.parse(
    readFileSync(new URL("../../n8n/workflows/eos-conversational-gateway-rc1.json", import.meta.url), "utf8"),
  );
  let codigo: string = flujo.nodes.find((n: { name: string }) => n.name === "06 GW Preparar Jobs Worker").parameters.jsCode;
  if (!codigo.includes("function costoDesdeLaRespuesta")) codigo = aplicar(codigo, "copia de prueba");
  const inicio = codigo.indexOf("function costoDesdeLaRespuesta");
  const fin = codigo.indexOf("\n}\n", inicio) + 3;
  return new Function(`${codigo.slice(inicio, fin)}\nreturn costoDesdeLaRespuesta;`)()(acciones, respuesta);
}

for (const [camino, correr] of [
  ["TypeScript", costoDesdeLaRespuesta],
  ["n8n", n8n],
] as const) {
  test(`${camino}: el caso de Sofía, los dos costos van a la venta`, () => {
    const [zapatos, maija] = items(correr([VENTA], SOFIA));
    assert.equal(zapatos.costo_unitario, 146473.876);
    assert.equal(maija.costo_unitario, 116382.076);
    assert.equal(zapatos.precio_unitario, 180000);
  });

  test(`${camino}: un costo que el modelo SÍ mandó no se pisa`, () => {
    const venta: Accion = {
      tipo: "REGISTRAR_VENTA",
      datos: { items: [{ producto: "Zapatos Mary Jane", cantidad: 1, precio_unitario: 180000, costo_unitario: 140000 }] },
    };
    assert.equal(items(correr([venta], SOFIA))[0].costo_unitario, 140000);
  });

  test(`${camino}: sin costo en el texto, el ítem queda igual`, () => {
    const texto = "Registré la venta de Zapatos Mary Jane por ₲180.000. ¿Cuánto te costaron?";
    assert.deepEqual(correr([VENTA], texto), [VENTA]);
  });

  test(`${camino}: el costo de OTRO producto no se le pega`, () => {
    const texto = "- Top negro: venta ₲50.000, costo ₲20.000.\n- Zapatos Mary Jane: venta ₲180.000.";
    assert.equal(items(correr([VENTA], texto))[0].costo_unitario, undefined);
  });

  test(`${camino}: formatos de guaraníes`, () => {
    const venta = (producto: string): Accion => ({ tipo: "REGISTRAR_VENTA", datos: { items: [{ producto, cantidad: 1 }] } });
    const costo = (linea: string) => items(correr([venta("Campera")], linea))[0].costo_unitario;
    assert.equal(costo("Campera: costo ₲207.052."), 207052);
    assert.equal(costo("Campera — costo de Gs. 1.207.052"), 1207052);
    assert.equal(costo("campera, costo 207052"), 207052);
    assert.equal(costo("Campera: costo ₲207.052,5"), 207052.5);
    assert.equal(costo("Campera: costo pendiente"), undefined);
  });

  test(`${camino}: las demás acciones no se tocan`, () => {
    const memoria: Accion = { tipo: "GUARDAR_MEMORIA", datos: { contenido: "Zapatos Mary Jane costo ₲1" } };
    assert.deepEqual(correr([memoria], SOFIA), [memoria]);
  });
}

test("el parche del nodo 06 es idempotente", () => {
  const flujo = JSON.parse(
    readFileSync(new URL("../../n8n/workflows/eos-conversational-gateway-rc1.json", import.meta.url), "utf8"),
  );
  const codigo: string = flujo.nodes.find((n: { name: string }) => n.name === "06 GW Preparar Jobs Worker").parameters.jsCode;
  const aplicado = codigo.includes("function costoDesdeLaRespuesta") ? codigo : aplicar(codigo, "copia");
  assert.throws(() => aplicar(aplicado, "ya aplicado"), /ya copia el costo del texto/);
});
