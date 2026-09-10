import test from "node:test";
import assert from "node:assert/strict";

import { textoPosicion, textoContexto, type ContextoNegocio } from "./contexto-negocio.ts";

/**
 * Lo que el modelo lee sobre la plata de la persona.
 *
 * Cada caso de acá es una forma concreta de mentirle a alguien sobre su propia
 * plata, y por eso está escrito como prueba y no como comentario.
 */

type Posicion = NonNullable<ContextoNegocio["posicion"]>;

// ---------------------------------------------------------------------------
// Cuentas
// ---------------------------------------------------------------------------

test("una cuenta sola sale con su nombre, su monto y su fecha", () => {
  const t = textoPosicion({
    cuentas: [{ nombre: "Ueno", moneda: "PYG", saldo: 3000000, al: "2026-09-10" }],
  });

  assert.match(t, /Ueno ₲ 3\.000\.000 \(10\/09\)/);
  assert.match(t, /según lo que declaraste/);
});

test("con varias cuentas de la MISMA moneda se escribe el total", () => {
  /*
   * Si fueran solo los renglones sueltos, el modelo sumaría. Sumar bien es
   * fácil; el problema es que también sumaría entre monedas. Escrito acá, el
   * total sale una vez y sale bien.
   */
  const t = textoPosicion({
    cuentas: [
      { nombre: "Ueno", moneda: "PYG", saldo: 3000000, al: "2026-09-10" },
      { nombre: "Efectivo", moneda: "PYG", saldo: 500000, al: "2026-09-01" },
    ],
  });

  assert.match(t, /₲ 3\.500\.000 en total/);
  assert.match(t, /Ueno ₲ 3\.000\.000 \(10\/09\)/);
  assert.match(t, /Efectivo ₲ 500\.000 \(01\/09\)/);
});

test("NUNCA hay un total que cruce monedas", () => {
  const t = textoPosicion({
    cuentas: [
      { nombre: "Ueno", moneda: "PYG", saldo: 3000000, al: "2026-09-10" },
      { nombre: "Ueno USD", moneda: "USD", saldo: 300, al: "2026-09-10" },
    ],
  });

  // Cada moneda en su renglón, cada una con su símbolo.
  assert.match(t, /₲ 3\.000\.000/);
  assert.match(t, /US\$ 300/);

  // Y ningún número que sea la suma cruda de los dos (3.000.300).
  assert.doesNotMatch(t, /3\.000\.300/);
});

test("una cuenta sin saldo declarado no entra", () => {
  // Entraría como "Ueno ₲ 0", que el modelo leería como que no tiene nada.
  const t = textoPosicion({
    cuentas: [{ nombre: "Ueno", moneda: "PYG", saldo: null, al: null }],
  });

  assert.equal(t, "");
});

test("un saldo en cero SÍ entra: es un dato", () => {
  const t = textoPosicion({
    cuentas: [{ nombre: "Ueno", moneda: "PYG", saldo: 0, al: "2026-09-10" }],
  });

  assert.match(t, /Ueno ₲ 0/);
});

// ---------------------------------------------------------------------------
// Tarjetas
// ---------------------------------------------------------------------------

test("la tarjeta dice cuándo vence y cuándo cierra", () => {
  const t = textoPosicion({
    tarjetas: [{ nombre: "Visa", moneda: "PYG", vence: 5, cierra: 20 }],
  });

  assert.match(t, /Visa — vence el 5, cierra el 20/);
});

test("el resumen de la tarjeta viaja con su fecha", () => {
  const t = textoPosicion({
    tarjetas: [
      {
        nombre: "Visa",
        moneda: "PYG",
        vence: 5,
        resumen: 1850000,
        minimo: 320000,
        resumen_al: "2026-09-05",
      },
    ],
  });

  assert.match(t, /resumen ₲ 1\.850\.000 del 05\/09/);
  assert.match(t, /mínimo ₲ 320\.000/);
});

test("una tarjeta sin nada cargado igual se nombra", () => {
  /*
   * Que EXISTA ya es el dato que importa: sin él, a "¿tengo alguna tarjeta?"
   * el modelo contesta que no.
   */
  const t = textoPosicion({ tarjetas: [{ nombre: "Visa" }] });
  assert.match(t, /Visa/);
});

// ---------------------------------------------------------------------------
// Deudas y objetivos
// ---------------------------------------------------------------------------

test("la deuda dice el saldo, la cuota y el día", () => {
  const t = textoPosicion({
    deudas: [
      { acreedor: "Financiera Ueno", moneda: "PYG", saldo: 8000000, cuota: 800000, dia: 10 },
    ],
  });

  assert.match(t, /Financiera Ueno: ₲ 8\.000\.000, cuota ₲ 800\.000 el 10/);
});

test("una deuda saldada no ocupa lugar en el prompt", () => {
  const t = textoPosicion({ deudas: [{ acreedor: "Ueno", saldo: 0 }] });
  assert.equal(t, "");
});

test("el objetivo dice la meta, la fecha y cuánto lleva", () => {
  const t = textoPosicion({
    objetivos: [
      {
        titulo: "terreno",
        ambito: "personal",
        moneda: "PYG",
        objetivo: 30000000,
        actual: 5000000,
        para: "2026-12-31",
      },
    ],
  });

  assert.match(t, /terreno: ₲ 30\.000\.000 para el 31\/12 \(lleva ₲ 5\.000\.000\)/);
});

test("un objetivo del negocio va rotulado, para no leerse como personal", () => {
  const t = textoPosicion({
    objetivos: [{ titulo: "facturar", ambito: "negocio", moneda: "PYG", objetivo: 300000000 }],
  });

  assert.match(t, /\[negocio\]/);
});

// ---------------------------------------------------------------------------
// Nada cargado, nada escrito
// ---------------------------------------------------------------------------

test("sin posición no se escribe ningún encabezado", () => {
  for (const vacio of [undefined, {}, { cuentas: [] }, { cuentas: [], tarjetas: [] }] as (
    | Posicion
    | undefined
  )[]) {
    assert.equal(textoPosicion(vacio), "", JSON.stringify(vacio));
  }
});

test("los datos rotos no rompen ni inventan", () => {
  const roto = {
    cuentas: "no es una lista",
    tarjetas: null,
    deudas: [{ acreedor: "X" }],
    objetivos: [{ titulo: "Y" }],
  } as unknown as Posicion;

  const t = textoPosicion(roto);

  // La deuda sin saldo se descarta; el objetivo sin meta se nombra igual,
  // porque saber que existe ya sirve.
  assert.doesNotMatch(t, /Lo que debe/);
  assert.match(t, /Y/);
});

// ---------------------------------------------------------------------------
// Y que entre en el contexto entero
// ---------------------------------------------------------------------------

test("la posición viaja dentro del contexto que arma el prompt", () => {
  const t = textoContexto({
    mes: "2026-09",
    finanzas: [],
    posicion: {
      cuentas: [{ nombre: "Ueno", moneda: "PYG", saldo: 3000000, al: "2026-09-10" }],
      tarjetas: [{ nombre: "Visa", vence: 5 }],
    },
  });

  assert.match(t, /Ueno ₲ 3\.000\.000/);
  assert.match(t, /Visa — vence el 5/);
});

test("un contexto sin nada cargado sigue devolviendo cadena vacía", () => {
  // La regla vieja no se rompe: un bloque de ceros haría que el modelo hable
  // de un negocio parado cuando la persona todavía no cargó nada.
  assert.equal(textoContexto({ mes: "2026-09", finanzas: [], personal: [] }), "");
});
