import assert from "node:assert/strict";
import { createVerify, generateKeyPairSync } from "node:crypto";
import { test } from "node:test";

import { claveApns, jwtApns, mensajeApns, type ClaveApns } from "./apns.ts";

const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const clave: ClaveApns = {
  teamId: "EQUIPO123",
  keyId: "CLAVE456",
  clavePrivada: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
};

/** El firmado usa `dsaEncoding: "ieee-p1363"`; para verificar hay que volver a DER. */
function p1363aDer(firma: Buffer): Buffer {
  const mitad = firma.length / 2;
  const codificar = (entero: Buffer) => {
    let recortado = entero;
    while (recortado.length > 1 && recortado[0] === 0 && (recortado[1] & 0x80) === 0) {
      recortado = recortado.subarray(1);
    }
    if (recortado[0] & 0x80) recortado = Buffer.concat([Buffer.from([0]), recortado]);
    return Buffer.concat([Buffer.from([0x02, recortado.length]), recortado]);
  };
  const r = codificar(firma.subarray(0, mitad));
  const s = codificar(firma.subarray(mitad));
  const cuerpo = Buffer.concat([r, s]);
  return Buffer.concat([Buffer.from([0x30, cuerpo.length]), cuerpo]);
}

test("el JWT de APNs tiene los reclamos de Apple y su firma ES256 verifica con la clave pública", () => {
  const jwt = jwtApns(clave, 1_700_000_000);
  const [encabezado, reclamos, firma] = jwt.split(".");

  const encabezadoLeido = JSON.parse(Buffer.from(encabezado, "base64url").toString());
  assert.equal(encabezadoLeido.alg, "ES256");
  assert.equal(encabezadoLeido.kid, "CLAVE456");

  const reclamosLeidos = JSON.parse(Buffer.from(reclamos, "base64url").toString());
  assert.equal(reclamosLeidos.iss, "EQUIPO123");
  assert.equal(reclamosLeidos.iat, 1_700_000_000);

  const verificador = createVerify("sha256").update(`${encabezado}.${reclamos}`);
  const firmaDer = p1363aDer(Buffer.from(firma, "base64url"));
  assert.equal(verificador.verify(publicKey, firmaDer), true);
});

test("el mensaje APNs lleva el título, el cuerpo y la ruta", () => {
  assert.deepEqual(JSON.parse(mensajeApns({ titulo: "Hola", cuerpo: "Mirá esto" })), {
    aps: { alert: { title: "Hola", body: "Mirá esto" }, sound: "default" },
    url: "/eos/chat",
  });
});

test("sin las tres variables de APNs no hay clave", () => {
  const previos = {
    teamId: process.env.APNS_TEAM_ID,
    keyId: process.env.APNS_KEY_ID,
    clavePrivada: process.env.APNS_CLAVE_PRIVADA,
  };
  try {
    delete process.env.APNS_TEAM_ID;
    delete process.env.APNS_KEY_ID;
    delete process.env.APNS_CLAVE_PRIVADA;
    assert.equal(claveApns(), null);

    process.env.APNS_TEAM_ID = "EQUIPO123";
    process.env.APNS_KEY_ID = "CLAVE456";
    assert.equal(claveApns(), null);

    process.env.APNS_CLAVE_PRIVADA = clave.clavePrivada;
    assert.deepEqual(claveApns(), clave);
  } finally {
    for (const [nombre, valor] of Object.entries({
      APNS_TEAM_ID: previos.teamId,
      APNS_KEY_ID: previos.keyId,
      APNS_CLAVE_PRIVADA: previos.clavePrivada,
    })) {
      if (valor === undefined) delete process.env[nombre];
      else process.env[nombre] = valor;
    }
  }
});
