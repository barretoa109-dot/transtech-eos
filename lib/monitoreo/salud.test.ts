import assert from "node:assert/strict";
import { test } from "node:test";

import { resumirEmbudo, type FilaEmbudo } from "./salud.ts";

const AHORA = Date.parse("2026-09-18T12:00:00Z");
const hace = (dias: number) => new Date(AHORA - dias * 86_400_000).toISOString();

const fila = (extra: Partial<FilaEmbudo> = {}): FilaEmbudo => ({
  acciones_ok: 0,
  activado_v1: false,
  primer_pago: null,
  ultimo_mensaje: null,
  ...extra,
});

test("cuenta cada hito por separado, sin mezclarlos", () => {
  const texto = resumirEmbudo(
    [
      fila({ acciones_ok: 5, activado_v1: true, primer_pago: hace(3), ultimo_mensaje: hace(1) }),
      fila({ acciones_ok: 1, ultimo_mensaje: hace(20) }),
      fila(),
    ],
    AHORA,
  );

  assert.equal(
    texto,
    "3 cuentas reales · 1 activas en 7 días · 2 con una acción exitosa · 1 activadas · 1 con un pago",
  );
});

test("una cuenta que nunca escribió no cuenta como activa en 7 días", () => {
  assert.match(resumirEmbudo([fila({ ultimo_mensaje: null })], AHORA), /0 activas en 7 días/);
});

test("el límite de 7 días es inclusivo, y 8 días ya no cuenta", () => {
  assert.match(resumirEmbudo([fila({ ultimo_mensaje: hace(7) })], AHORA), /1 activas en 7 días/);
  assert.match(resumirEmbudo([fila({ ultimo_mensaje: hace(8) })], AHORA), /0 activas en 7 días/);
});

test("sin cuentas dice cero, no revienta", () => {
  assert.equal(
    resumirEmbudo([], AHORA),
    "0 cuentas reales · 0 activas en 7 días · 0 con una acción exitosa · 0 activadas · 0 con un pago",
  );
});
