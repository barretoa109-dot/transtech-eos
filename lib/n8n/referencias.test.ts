import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";

import { nombresReferidos, referenciasRotas, type Flujo } from "./referencias.ts";

const CARPETA = new URL("../../n8n/workflows/", import.meta.url);

function flujo(nodos: Flujo["nodes"], conexiones: [string, string][]): Flujo {
  const connections: NonNullable<Flujo["connections"]> = {};
  for (const [de, a] of conexiones) {
    connections[de] ??= { main: [[]] };
    connections[de].main[0]!.push({ node: a });
  }
  return { nodes: nodos, connections };
}

test("lee las tres formas de referirse a otro nodo", () => {
  const p = { jsCode: "const a = $('Uno').first().json; const b = $node[\"Dos\"].json; $items('Tres');" };
  assert.deepEqual(nombresReferidos(p).sort(), ["Dos", "Tres", "Uno"]);
  assert.deepEqual(nombresReferidos({ x: "={{ $(`Cuatro`).item.json.id }}" }), ["Cuatro"]);
  // Un nombre armado en tiempo de ejecución no se puede resolver: se ignora.
  assert.deepEqual(nombresReferidos({ jsCode: "$(`${nombre}`)" }), []);
});

test("referencia a un nodo que no existe", () => {
  const f = flujo([{ name: "A" }, { name: "B", parameters: { jsCode: "$('Memoria').first()" } }], [["A", "B"]]);
  assert.deepEqual(referenciasRotas(f), [{ nodo: "B", referencia: "Memoria", motivo: "no_existe" }]);
});

test("referencia a un nodo que está en otra rama (no ejecutado)", () => {
  // Router -> Memoria y Router -> Responder: Responder lee Memoria, que en su
  // camino nunca corrió. Es el "Referenced node is unexecuted" de RC1.
  const f = flujo(
    [{ name: "Router" }, { name: "Memoria" }, { name: "Responder", parameters: { jsCode: "$('Memoria').first()" } }],
    [["Router", "Memoria"], ["Router", "Responder"]],
  );
  assert.deepEqual(referenciasRotas(f), [{ nodo: "Responder", referencia: "Memoria", motivo: "no_es_anterior" }]);
});

test("referencia a un nodo desactivado o desconectado", () => {
  const f = flujo(
    [{ name: "A" }, { name: "Sub", disabled: true }, { name: "B", parameters: { jsCode: "$('Sub').first()" } }],
    [["A", "Sub"], ["Sub", "B"]],
  );
  assert.deepEqual(referenciasRotas(f), [{ nodo: "B", referencia: "Sub", motivo: "desactivado" }]);
});

test("un ancestro lejano sí vale", () => {
  const f = flujo(
    [{ name: "A" }, { name: "B" }, { name: "C", parameters: { jsCode: "$('A').first()" } }],
    [["A", "B"], ["B", "C"]],
  );
  assert.deepEqual(referenciasRotas(f), []);
});

test("ningún workflow exportado lee un nodo que no existe o que no corrió antes", () => {
  const archivos = readdirSync(CARPETA).filter((f) => f.endsWith(".json"));
  assert.ok(archivos.length >= 6, "faltan los workflows exportados");
  for (const archivo of archivos) {
    const f = JSON.parse(readFileSync(new URL(archivo, CARPETA), "utf8")) as Flujo;
    assert.deepEqual(referenciasRotas(f), [], archivo);
  }
});

/*
 * INC-15 ("CTX 60/62 [{}]"): los workflows EOS 2.x/3.x leían el contexto con
 * nodos de Supabase v1 que (1) con `alwaysOutputData` devolvían `[{}]` si no
 * había filas, (2) caían a un usuario de relleno fijo si faltaba el id, y
 * (3) ignoran todo filtro salvo el primero (caso de la reserva, 22/09). Esos
 * workflows están inactivos; esto impide que el patrón vuelva a uno vivo.
 */
type NodoN8n = {
  name: string;
  type?: string;
  typeVersion?: number;
  alwaysOutputData?: boolean;
  parameters?: { filters?: { conditions?: { keyName?: string }[] }; jsCode?: string };
};

test("INC-15: ningún workflow exportado lee con un usuario de relleno ni depende de un segundo filtro de Supabase v1", () => {
  const archivos = readdirSync(CARPETA).filter((f) => f.endsWith(".json"));
  for (const archivo of archivos) {
    const texto = readFileSync(new URL(archivo, CARPETA), "utf8");
    assert.doesNotMatch(texto, /00000000-0000-4000-8000-000000000001/, `${archivo}: usuario de relleno`);
    const { nodes = [] } = JSON.parse(texto) as { nodes?: NodoN8n[] };
    for (const n of nodes) {
      if (!/supabase/i.test(n.type ?? "")) continue;
      const condiciones = n.parameters?.filters?.conditions ?? [];
      if ((n.typeVersion ?? 1) <= 1 && condiciones.length > 1) {
        // Única excepción conocida: la reserva trae 25 candidatas y el nodo
        // siguiente las vuelve a filtrar en JavaScript por usuario y pedido.
        assert.equal(n.name, "01.5 GW Verificar Reserva API", `${archivo}: "${n.name}" depende de un filtro que n8n ignora`);
        const gate = nodes.find((x) => x.name.startsWith("01.6"));
        assert.match(gate?.parameters?.jsCode ?? "", /request_id/);
        assert.match(gate?.parameters?.jsCode ?? "", /usuario_id/);
      }
      if (condiciones.length > 0) {
        assert.equal(condiciones[0]?.keyName, "usuario_id", `${archivo}: "${n.name}" no filtra primero por usuario`);
      }
    }
  }
});
