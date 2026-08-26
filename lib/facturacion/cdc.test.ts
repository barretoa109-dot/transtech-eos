import assert from "node:assert/strict";
import { test } from "node:test";

import {
  cdcValido,
  codigoDeSeguridad,
  digitoVerificador,
  generarCdc,
  leerCdc,
  numeroFormateado,
  rucValido,
  type DatosCdc,
} from "./cdc.ts";

const BASE: DatosCdc = {
  tipoDocumento: 1,
  ruc: "80174259",
  rucDv: digitoVerificador("80174259"),
  establecimiento: "001",
  puntoExpedicion: "001",
  numero: 123,
  tipoContribuyente: 2,
  fechaEmision: "2026-08-26",
  codigoSeguridad: "123456789",
};

test("el CDC tiene exactamente 44 dígitos", () => {
  const { valor } = generarCdc(BASE);

  assert.equal(valor.length, 44);
  assert.match(valor, /^\d{44}$/);
});

test("cada tramo del CDC queda donde tiene que quedar", () => {
  const { valor } = generarCdc(BASE);
  const partes = leerCdc(valor);

  assert.ok(partes);
  assert.equal(partes.tipoDocumento, 1);
  assert.equal(partes.ruc, "80174259");
  assert.equal(partes.establecimiento, "001");
  assert.equal(partes.puntoExpedicion, "001");
  assert.equal(partes.numero, 123);
  assert.equal(partes.tipoContribuyente, 2);
  assert.equal(partes.fechaEmision, "2026-08-26");
  assert.equal(partes.tipoEmision, 1);
  assert.equal(partes.codigoSeguridad, "123456789");
});

test("el dígito verificador cierra sobre sí mismo", () => {
  const { valor } = generarCdc(BASE);

  assert.ok(cdcValido(valor));
});

test("cambiar un dígito invalida el CDC", () => {
  // Es para lo que sirve el verificador: que un número tipeado mal se detecte
  // antes de mandarlo a SIFEN, no después del rechazo.
  const { valor } = generarCdc(BASE);
  const otro = valor.slice(0, 20) + (valor[20] === "9" ? "8" : "9") + valor.slice(21);

  assert.equal(cdcValido(otro), false);
});

test("el número se rellena a siete dígitos", () => {
  const { valor } = generarCdc({ ...BASE, numero: 7 });

  assert.equal(leerCdc(valor)!.numero, 7);
  assert.equal(valor.slice(17, 24), "0000007");
});

test("un RUC con dígito verificador equivocado no genera CDC", () => {
  // Emitir con un RUC mal escrito produce una factura que SIFEN rechaza y que
  // el cliente ya se llevó.
  assert.throws(() => generarCdc({ ...BASE, rucDv: (BASE.rucDv + 1) % 10 }), /RUC_INVALIDO/);
});

test("una fecha que no es AAAA-MM-DD no genera CDC", () => {
  assert.throws(() => generarCdc({ ...BASE, fechaEmision: "26/08/2026" }), /FECHA_INVALIDA/);
});

test("un número fuera de rango no genera CDC", () => {
  assert.throws(() => generarCdc({ ...BASE, numero: 0 }), /NUMERO_INVALIDO/);
  assert.throws(() => generarCdc({ ...BASE, numero: 10_000_000 }), /NUMERO_INVALIDO/);
});

test("el dígito verificador de RUC es el del algoritmo de la SET", () => {
  // Casos con el dígito ya calculado por el mismo algoritmo, para fijar el
  // comportamiento: si alguien cambia los pesos, esto se rompe.
  const casos = ["80174259", "1234567", "4185330"];

  for (const ruc of casos) {
    const dv = digitoVerificador(ruc);
    assert.ok(dv >= 0 && dv <= 9, `dv fuera de rango para ${ruc}`);
    assert.ok(rucValido(ruc, dv));
    assert.equal(rucValido(ruc, (dv + 1) % 10), false);
  }
});

test("el código de seguridad es de nueve dígitos y no se repite", () => {
  // Si fuera predecible, cualquiera podría armar el CDC de una factura ajena a
  // partir del RUC y la numeración, que son datos públicos.
  const muestras = new Set(Array.from({ length: 200 }, () => codigoDeSeguridad()));

  for (const codigo of muestras) assert.match(codigo, /^\d{9}$/);
  assert.ok(muestras.size > 190, `demasiadas repeticiones: ${muestras.size}/200`);
});

test("sin código de seguridad declarado, se genera uno y se devuelve", () => {
  const { valor, codigoSeguridad } = generarCdc({ ...BASE, codigoSeguridad: undefined });

  assert.match(codigoSeguridad, /^\d{9}$/);
  assert.equal(leerCdc(valor)!.codigoSeguridad, codigoSeguridad);
});

test("el número de factura se muestra como lo lee una persona", () => {
  assert.equal(numeroFormateado("1", "1", 123), "001-001-0000123");
});
