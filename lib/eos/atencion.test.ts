import test from "node:test";
import assert from "node:assert/strict";

import {
  armarAtencion,
  titularDeAtencion,
  DIAS_PARA_REFRESCAR_SALDO,
  DIAS_PARA_REFRESCAR_RESUMEN,
  type Entradas,
} from "./atencion.ts";

const HOY = "2026-09-10";

function dia(hace: number): string {
  const t = Date.UTC(2026, 8, 10) - hace * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

/** Alguien que ya cargó lo suyo: no debería tener nada pendiente. */
function alDia(extra: Partial<Entradas> = {}): Entradas {
  return {
    hoy: HOY,
    aprobacionesPendientes: 0,
    accionesFallidas: [],
    productosSinCosto: 0,
    productosTotales: 12,
    cuentas: [{ nombre: "Ueno", saldo: 3_000_000, al: dia(2) }],
    tarjetas: [{ nombre: "Visa", cierra: 20, vence: 5, resumenAl: dia(5) }],
    deudasSinCuota: [],
    oportunidadesSinMonto: 0,
    porCobrarViejo: null,
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// Lo más importante: casi siempre, nada
// ---------------------------------------------------------------------------

test("con todo cargado y al día, EOS no necesita nada", () => {
  /*
   * Es la prueba que sostiene a todas las demás. Un centro de atención que
   * siempre tiene algo es un adorno: se lee dos veces y después se ignora
   * para siempre, arrastrando consigo la credibilidad del resto.
   */
  const pendientes = armarAtencion(alDia());

  assert.deepEqual(pendientes, []);
  assert.equal(titularDeAtencion(pendientes), "Nada.");
});

test("lo envejecido NO entra en el titular", () => {
  // No bloquea nada. Si contara, el titular casi nunca diría "nada" y dejaría
  // de significar algo.
  const pendientes = armarAtencion(
    alDia({ cuentas: [{ nombre: "Ueno", saldo: 3_000_000, al: dia(60) }] }),
  );

  assert.equal(pendientes.length, 1);
  assert.equal(pendientes[0].clase, "envejecido");
  assert.equal(titularDeAtencion(pendientes), "Nada.");
});

// ---------------------------------------------------------------------------
// Decisiones
// ---------------------------------------------------------------------------

test("una aprobación pendiente dice qué se destraba", () => {
  const [p] = armarAtencion(alDia({ aprobacionesPendientes: 2 }));

  assert.equal(p.clase, "decision");
  assert.match(p.titulo, /2 acciones esperando/);
  assert.match(p.porque, /no se ejecutan/);
});

test("las órdenes que fallaron se nombran, no se cuentan nomás", () => {
  /*
   * "3 acciones fallaron" no dice si se perdió una venta o un recordatorio.
   * Los nombres sí, y son lo que decide si esto se mira ahora o el lunes.
   */
  const [p] = armarAtencion(
    alDia({
      accionesFallidas: [
        { accion: "REGISTRAR_VENTA" },
        { accion: "REGISTRAR_VENTA" },
        { accion: "CREAR_TAREA" },
      ],
    }),
  );

  assert.match(p.porque, /REGISTRAR_VENTA/);
  assert.match(p.porque, /CREAR_TAREA/);
  // Sin repetir la misma acción tres veces.
  assert.equal((p.porque.match(/REGISTRAR_VENTA/g) ?? []).length, 1);
});

// ---------------------------------------------------------------------------
// Datos que faltan
// ---------------------------------------------------------------------------

test("sin ninguna cuenta cargada, lo dice y explica qué se pierde", () => {
  const pendientes = armarAtencion(alDia({ cuentas: [] }));
  const p = pendientes.find((x) => x.clave === "sin-cuentas");

  assert.ok(p);
  assert.match(p.porque, /patrimonio/);
  assert.equal(titularDeAtencion(pendientes), "1 dato.");
});

test("una cuenta sin saldo se nombra", () => {
  const pendientes = armarAtencion(
    alDia({
      cuentas: [
        { nombre: "Ueno", saldo: 3_000_000, al: dia(1) },
        { nombre: "Tigo Money", saldo: null, al: null },
      ],
    }),
  );

  const p = pendientes.find((x) => x.clave === "cuentas-sin-saldo");
  assert.ok(p);
  assert.match(p.porque, /Tigo Money/);
});

test("el costo que falta se cuenta en margen, no en completitud", () => {
  const [p] = armarAtencion(alDia({ productosSinCosto: 3 }));

  assert.match(p.titulo, /3 productos sin costo/);
  assert.match(p.porque, /margen/);
});

test("una deuda sin cuota bloquea el orden de pagos, y lo dice", () => {
  const pendientes = armarAtencion(
    alDia({ deudasSinCuota: [{ acreedor: "Financiera Ueno" }] }),
  );

  const p = pendientes.find((x) => x.clave === "deudas-sin-cuota");
  assert.ok(p);
  assert.match(p.porque, /Financiera Ueno/);
  assert.match(p.porque, /ordenarte los pagos/);
});

test("una tarjeta sin ciclo no puede proyectar nada", () => {
  const pendientes = armarAtencion(
    alDia({ tarjetas: [{ nombre: "Visa", cierra: null, vence: 5, resumenAl: null }] }),
  );

  const p = pendientes.find((x) => x.clave === "tarjetas-sin-ciclo");
  assert.ok(p);
  assert.match(p.porque, /cuándo cae la cuota/);
});

// ---------------------------------------------------------------------------
// Lo que envejeció
// ---------------------------------------------------------------------------

test("un saldo de justo el límite todavía no molesta", () => {
  const pendientes = armarAtencion(
    alDia({ cuentas: [{ nombre: "Ueno", saldo: 1, al: dia(DIAS_PARA_REFRESCAR_SALDO) }] }),
  );

  assert.equal(pendientes.length, 0);
});

test("un día más allá del límite, sí", () => {
  const pendientes = armarAtencion(
    alDia({ cuentas: [{ nombre: "Ueno", saldo: 1, al: dia(DIAS_PARA_REFRESCAR_SALDO + 1) }] }),
  );

  const p = pendientes.find((x) => x.clave === "saldos-viejos");
  assert.ok(p);
  // Y dice CUÁL es el peor, no solo cuántos hay.
  assert.match(p.porque, /Ueno/);
  assert.match(p.porque, /decías tener/);
});

test("con varios saldos viejos se nombra el peor", () => {
  const pendientes = armarAtencion(
    alDia({
      cuentas: [
        { nombre: "Ueno", saldo: 1, al: dia(35) },
        { nombre: "Efectivo", saldo: 2, al: dia(90) },
      ],
    }),
  );

  const p = pendientes.find((x) => x.clave === "saldos-viejos");
  assert.ok(p);
  assert.match(p.porque, /Efectivo/);
  assert.equal(p.cuantos, 2);
});

test("el resumen de la tarjeta aguanta más que un saldo, pero no para siempre", () => {
  const justo = armarAtencion(
    alDia({
      tarjetas: [{ nombre: "Visa", cierra: 20, vence: 5, resumenAl: dia(DIAS_PARA_REFRESCAR_RESUMEN) }],
    }),
  );
  assert.equal(justo.length, 0);

  const pasado = armarAtencion(
    alDia({
      tarjetas: [
        { nombre: "Visa", cierra: 20, vence: 5, resumenAl: dia(DIAS_PARA_REFRESCAR_RESUMEN + 1) },
      ],
    }),
  );
  assert.ok(pasado.find((x) => x.clave === "resumenes-viejos"));
});

test("una cartera vieja se menciona con su antigüedad", () => {
  const pendientes = armarAtencion(
    alDia({ porCobrarViejo: { cuantas: 4, masViejaEnDias: 62 } }),
  );

  const p = pendientes.find((x) => x.clave === "cartera-vieja");
  assert.ok(p);
  assert.match(p.porque, /62 días/);
});

test("una cartera reciente NO es un pendiente", () => {
  // Vender a crédito no es un problema: es el negocio. Solo lo es cuando
  // envejeció.
  const pendientes = armarAtencion(
    alDia({ porCobrarViejo: { cuantas: 4, masViejaEnDias: 10 } }),
  );

  assert.equal(pendientes.length, 0);
});

// ---------------------------------------------------------------------------
// El orden y el titular
// ---------------------------------------------------------------------------

test("las decisiones van primero, después los datos, último lo viejo", () => {
  const pendientes = armarAtencion(
    alDia({
      aprobacionesPendientes: 1,
      productosSinCosto: 2,
      cuentas: [{ nombre: "Ueno", saldo: 1, al: dia(90) }],
    }),
  );

  assert.deepEqual(
    pendientes.map((p) => p.clase),
    ["decision", "dato", "envejecido"],
  );

  assert.equal(titularDeAtencion(pendientes), "1 decisión y 1 dato.");
});

test("el titular no dice datos cuando no hay", () => {
  const pendientes = armarAtencion(alDia({ aprobacionesPendientes: 3 }));
  assert.equal(titularDeAtencion(pendientes), "1 decisión.");
});

// ---------------------------------------------------------------------------
// Cada pendiente tiene que poder decir qué destraba
// ---------------------------------------------------------------------------

test("ningún pendiente sale sin decir qué se destraba ni dónde se resuelve", () => {
  /*
   * Es la regla que separa esto de una lista de tareas del sistema. Si un
   * pendiente no puede completar la frase "sin esto no puedo…", no va.
   */
  const todos = armarAtencion({
    hoy: HOY,
    aprobacionesPendientes: 1,
    accionesFallidas: [{ accion: "REGISTRAR_VENTA" }],
    productosSinCosto: 1,
    cuentas: [
      { nombre: "A", saldo: null, al: null },
      { nombre: "B", saldo: 1, al: dia(90) },
    ],
    tarjetas: [{ nombre: "V", cierra: null, vence: null, resumenAl: dia(90) }],
    deudasSinCuota: [{ acreedor: "X" }],
    oportunidadesSinMonto: 2,
    porCobrarViejo: { cuantas: 1, masViejaEnDias: 90 },
  });

  assert.ok(todos.length >= 8, `salieron ${todos.length}`);

  const claves = new Set<string>();
  for (const p of todos) {
    assert.ok(p.porque.trim().length > 20, `"${p.titulo}" no explica qué destraba`);
    assert.ok(p.donde.trim().length > 0, `"${p.titulo}" no dice dónde se resuelve`);
    assert.ok(!claves.has(p.clave), `la clave ${p.clave} salió dos veces`);
    claves.add(p.clave);
  }
});

test("sin datos de nada, no inventa pendientes", () => {
  // Alguien recién registrado. Lo único que se le pide es la cuenta, que es
  // de lo que depende todo lo demás.
  const pendientes = armarAtencion({ hoy: HOY });

  assert.deepEqual(
    pendientes.map((p) => p.clave),
    ["sin-cuentas"],
  );
});
