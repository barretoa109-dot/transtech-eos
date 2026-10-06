import assert from "node:assert/strict";
import { generateKeyPairSync, createVerify } from "node:crypto";
import { test } from "node:test";

import { cuentaDeServicio, jwtDeAcceso, mensajeFcm, type ServiceAccount } from "./fcm.ts";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const cuenta: ServiceAccount = {
  project_id: "transtech-eos-73c00",
  client_email: "firebase-adminsdk@transtech-eos-73c00.iam.gserviceaccount.com",
  private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
};

test("el JWT tiene los reclamos de Google y su firma verifica con la clave pública", () => {
  const jwt = jwtDeAcceso(cuenta, 1_700_000_000);
  const [encabezado, reclamos, firma] = jwt.split(".");

  const reclamosLeidos = JSON.parse(Buffer.from(reclamos, "base64url").toString());
  assert.equal(reclamosLeidos.iss, cuenta.client_email);
  assert.equal(reclamosLeidos.aud, "https://oauth2.googleapis.com/token");
  assert.equal(reclamosLeidos.scope, "https://www.googleapis.com/auth/firebase.messaging");
  assert.equal(reclamosLeidos.exp - reclamosLeidos.iat, 3600);

  const verificador = createVerify("RSA-SHA256").update(`${encabezado}.${reclamos}`);
  assert.equal(verificador.verify(publicKey, Buffer.from(firma, "base64url")), true);
});

test("el mensaje FCM lleva el token, el título, el cuerpo y la ruta", () => {
  assert.deepEqual(
    mensajeFcm("token-del-telefono-123456", { titulo: "Hola", cuerpo: "Mirá esto" }),
    {
      message: {
        token: "token-del-telefono-123456",
        notification: { title: "Hola", body: "Mirá esto" },
        data: { url: "/eos/chat" },
        android: { priority: "HIGH" },
      },
    },
  );
});

test("sin FCM_SERVICE_ACCOUNT_JSON, o con un JSON incompleto, no hay cuenta", () => {
  const previo = process.env.FCM_SERVICE_ACCOUNT_JSON;
  try {
    delete process.env.FCM_SERVICE_ACCOUNT_JSON;
    assert.equal(cuentaDeServicio(), null);

    process.env.FCM_SERVICE_ACCOUNT_JSON = JSON.stringify({ project_id: "x" });
    assert.equal(cuentaDeServicio(), null);

    process.env.FCM_SERVICE_ACCOUNT_JSON = JSON.stringify(cuenta);
    assert.equal(cuentaDeServicio()?.project_id, "transtech-eos-73c00");
  } finally {
    if (previo === undefined) delete process.env.FCM_SERVICE_ACCOUNT_JSON;
    else process.env.FCM_SERVICE_ACCOUNT_JSON = previo;
  }
});
