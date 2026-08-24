import test from "node:test";
import assert from "node:assert/strict";

import {
  aNumero,
  buscarImportes,
  CONFIANZA_MINIMA_CORREO,
  extraerDeCorreo,
  type CorreoEntrante,
} from "./extraerDeCorreo.ts";

/**
 * Tests del extractor de avisos bancarios.
 *
 * Lo que entra por acá se convierte en plata en la cuenta del usuario sin que
 * nadie lo revise. El caso más importante del archivo es el de la publicidad:
 * al probar con formatos reales, un correo promocional del banco ("llevate tu
 * notebook desde Gs. 2.500.000 en 12 cuotas") entraba como un gasto real con
 * confianza 0.95 y le descontaba plata que nunca gastó.
 */

const correo = (parcial: Partial<CorreoEntrante>): CorreoEntrante => ({
  asunto: null,
  texto: null,
  html: null,
  remitente: "avisos@banco.com.py",
  recibidoEn: "2026-08-20T12:00:00Z",
  ...parcial,
});

const entra = (c: CorreoEntrante) => {
  const r = extraerDeCorreo(c);
  return r.length > 0 && r[0].confianza >= CONFIANZA_MINIMA_CORREO ? r[0] : null;
};

test("interpreta los separadores de guaraníes y de dólares", () => {
  assert.equal(aNumero("1.500.000", "PYG"), 1_500_000);
  assert.equal(aNumero("12.000.000", "PYG"), 12_000_000);
  assert.equal(aNumero("1,500.00", "USD"), 1500);
  assert.equal(aNumero("1.500,00", "USD"), 1500);
});

test("solo reconoce importes con moneda pegada", () => {
  // Un número suelto puede ser un comprobante, una referencia o una cuenta.
  const hallados = buscarImportes(
    "N° Comprobante: 001000400059002448298320260820 Importe: PYG 50.000",
  );
  assert.equal(hallados.length, 1);
  assert.equal(hallados[0].monto, 50_000);
  assert.equal(hallados[0].moneda, "PYG");
});

test("formato real del Banco GNB: transferencia recibida", () => {
  const m = entra(
    correo({
      asunto: "Fwd: Transferencias Recibidas SPI",
      texto: [
        "---------- Forwarded message ---------",
        "De: <Transferencias@bancognb.com.py>",
        "Subject: Transferencias Recibidas SPI",
        "",
        "Estimado cliente, se le informa que se ha registrado un crédito a su cuenta",
        "por la siguiente operación:",
        "N° Comprobante: 001000400059002448298320260820",
        "Fecha y hora: 20/08/2026 17:54:06",
        "Importe: PYG 50.000",
      ].join("\n"),
      remitente: "barretoa109@gmail.com",
    }),
  );

  assert.ok(m, "el aviso real del GNB tiene que entrar");
  assert.equal(m.tipo, "ingreso");
  assert.equal(m.monto, 50_000);
  assert.equal(m.moneda, "PYG");
  assert.equal(m.fecha, "2026-08-20", "la fecha sale del cuerpo, no del reenvío");
});

test("formato real del Banco GNB: transferencia ENVIADA (débito)", () => {
  // El GNB escribe el asunto en plural, igual que en las recibidas. Sin el
  // plural en la lista de gastos la confianza quedaba en 0,80 —el umbral
  // exacto— y un débito real quedaba a un pelo de descartarse en silencio.
  const m = entra(
    correo({
      asunto: "Transferencias Enviadas SPI",
      texto: [
        "Estimado cliente, se le informa que se ha registrado un débito a su cuenta",
        "por la siguiente operación:",
        "Fecha y hora: 24/08/2026 10:15:00",
        "Importe: PYG 250.000",
      ].join("\n"),
      remitente: "Transferencias@bancognb.com.py",
    }),
  );

  assert.ok(m, "un débito real del GNB tiene que entrar");
  assert.equal(m.tipo, "gasto");
  assert.equal(m.monto, 250_000);
  assert.equal(m.fecha, "2026-08-24");
  assert.ok(m.confianza > 0.8, `debería superar cómodamente el umbral, dio ${m.confianza}`);
});

test("el reenvío no ensucia la descripción: sin 'Fwd:' y con el asunto original", () => {
  // De esta descripción sale la clave que agrupa las series recurrentes. Si un
  // mes llega reenviado y otro no, serían dos series distintas en vez de una.
  const m = entra(
    correo({
      asunto: "Fwd: Transferencias Recibidas SPI",
      texto:
        "Subject: Transferencias Recibidas SPI\n\nSe ha registrado un crédito a su cuenta. Importe: PYG 50.000",
    }),
  );

  assert.equal(m?.descripcion, "Transferencias Recibidas SPI");
});

test("RECHAZA publicidad del banco con importes grandes", () => {
  const promos = [
    correo({
      asunto: "Comprá ahora en cuotas",
      texto: "Llevate tu notebook desde Gs. 2.500.000 en 12 cuotas sin interés.",
    }),
    correo({
      asunto: "Préstamo preaprobado",
      texto: "Tenés un préstamo preaprobado de hasta Gs. 50.000.000. Conocé nuestro beneficio.",
    }),
    correo({
      asunto: "Novedades de agosto",
      texto: "Este mes lanzamos una promoción de Gs. 100.000 de reintegro.",
    }),
  ];

  for (const p of promos) {
    assert.equal(
      extraerDeCorreo(p).length,
      0,
      `la publicidad no puede convertirse en un movimiento: ${p.asunto}`,
    );
  }
});

test("rechaza publicidad que además suena a transacción", () => {
  // Este caso existe porque los otros tres los atrapaban el guarda de rango
  // ("desde/hasta") o el de marca transaccional, no la lista de palabras
  // publicitarias. Sin este, esa lista podía borrarse sin que fallara nada.
  //
  // Es además el caso más peligroso: una promo redactada como si fuera una
  // acreditación real.
  const promo = correo({
    asunto: "Promoción de invitados",
    texto:
      "Te informamos que si invitás a un amigo hacemos un depósito de Gs. 500.000 en tu cuenta. Aprovechá este beneficio.",
  });

  assert.equal(
    extraerDeCorreo(promo).length,
    0,
    "una promo con lenguaje transaccional no puede entrar como ingreso",
  );
});

test("rechaza un correo que menciona plata sin que haya ocurrido una transacción", () => {
  assert.equal(
    extraerDeCorreo(correo({ asunto: "Resumen", texto: "Su saldo actual es de Gs. 4.500.000." }))
      .length,
    0,
  );
});

test("distingue débito de crédito", () => {
  const gasto = entra(
    correo({
      asunto: "Compra con tu tarjeta de débito",
      texto: "Se registró una compra por Gs. 285.000 en SUPERMERCADO el 18/08/2026.",
    }),
  );
  assert.equal(gasto?.tipo, "gasto");

  const ingreso = entra(
    correo({
      asunto: "Acreditación de haberes",
      texto: "Te informamos la acreditación de tu salario por Gs. 12.000.000 con fecha 30/07/2026.",
    }),
  );
  assert.equal(ingreso?.tipo, "ingreso");
  assert.equal(ingreso?.monto, 12_000_000);
});

test("lee el aviso aunque venga solo en HTML", () => {
  const m = entra(
    correo({
      asunto: "Pago realizado",
      html: "<html><body><p>Pago de <b>Gs. 320.000</b> a ANDE desde tu cuenta</p><p>Fecha: 05/08/2026</p></body></html>",
    }),
  );

  assert.equal(m?.tipo, "gasto");
  assert.equal(m?.monto, 320_000);
  assert.equal(m?.fecha, "2026-08-05");
});

test("un aviso sin importe no genera movimiento", () => {
  assert.equal(
    extraerDeCorreo(correo({ asunto: "Aviso", texto: "Te informamos sobre tu cuenta." })).length,
    0,
  );
});
