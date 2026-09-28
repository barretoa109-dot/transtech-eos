import test from "node:test";
import assert from "node:assert/strict";

import { filtrarConversaciones, fragmento, normalizar, patronIlike } from "./buscar-chats.ts";

test("se compara sin tildes ni mayúsculas", () => {
  assert.equal(normalizar("Anulación de VENTA"), "anulacion de venta");
});

test("el patrón busca lo escrito, literal", () => {
  assert.equal(patronIlike(" althea "), "%althea%");
  assert.equal(patronIlike("50%_off"), "%50\\%\\_off%");
});

test("el fragmento muestra dónde aparece, con contexto", () => {
  const texto = "Registré la venta del Kit de dr althea por Gs. 305.000 a crédito, vence en octubre.";
  assert.equal(fragmento(texto, "ALTHEA", 10), "…Kit de dr althea por Gs. 3…");
  assert.equal(fragmento(texto, "Registré", 5), "Registré la v…");
  assert.equal(fragmento(texto, "no está"), null);
});

test("encuentra sin tildes lo que se escribió con tildes, y al revés", () => {
  assert.equal(fragmento("Cobré la señá", "sena", 3), "…la señá");
  assert.equal(fragmento("la anulacion quedó", "anulación", 0), "…anulacion…");
});

test("se muestran los chats que coinciden por título o por un mensaje, en su orden", () => {
  const convs = [
    { id: "a", titulo: "Estrategia de negocio" },
    { id: "b", titulo: "Plan financiero" },
    { id: "c", titulo: null },
  ];
  assert.deepEqual(filtrarConversaciones(convs, "", {}).map((c) => c.id), ["a", "b", "c"]);
  assert.deepEqual(filtrarConversaciones(convs, "estrategia", {}).map((c) => c.id), ["a"]);
  assert.deepEqual(filtrarConversaciones(convs, "althea", { c: "…althea…" }).map((c) => c.id), ["c"]);
  assert.deepEqual(filtrarConversaciones(convs, "nuevo", {}).map((c) => c.id), ["c"]);
});
