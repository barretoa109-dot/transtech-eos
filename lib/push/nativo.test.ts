import assert from "node:assert/strict";
import { test } from "node:test";

import { avisarNativo } from "./nativo.ts";

/** Un cliente que falla si alguien intenta usarlo: sin configuración no debe tocar la base. */
const adminQueNoDebeUsarse = {
  from() {
    throw new Error("no debía consultar la base sin cuenta de servicio");
  },
};

test("sin cuenta de servicio de Firebase no consulta ni envía nada", async () => {
  const previo = process.env.FCM_SERVICE_ACCOUNT_JSON;
  try {
    delete process.env.FCM_SERVICE_ACCOUNT_JSON;
    const resultado = await avisarNativo(adminQueNoDebeUsarse, "usuario-1", {
      titulo: "Hola",
      cuerpo: "Mirá esto",
    });
    assert.deepEqual(resultado, { enviados: 0, fallidos: 0, muertos: [] });
  } finally {
    if (previo === undefined) delete process.env.FCM_SERVICE_ACCOUNT_JSON;
    else process.env.FCM_SERVICE_ACCOUNT_JSON = previo;
  }
});
