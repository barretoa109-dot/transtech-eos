import assert from "node:assert/strict";
import { test } from "node:test";

import { tokenDeBajaValido } from "../email/baja.ts";
import {
  enviarInformesDeImpacto,
  MOTIVO_BAJA_IMPACTO,
  urlDeBajaImpacto,
  type CorreoInforme,
  type Fuente,
} from "./enviar.ts";
import {
  calcularImpacto,
  lineasDelInforme,
  mesActual,
  mesAnterior,
  MINIMO_DE_COSAS,
  MINUTOS_POR_REGISTRO,
  redactarInforme,
  tiempoEnPalabras,
  tieneAlgoQueContar,
  type HechosDelMes,
} from "./informe.ts";

const VACIO: HechosDelMes = { acciones: [], ventas: [], cobrosDeCredito: [], porCobrar: [] };

test("el mes anterior se calcula bien, también en enero y en febrero", () => {
  assert.deepEqual(mesAnterior("2026-10-01"), {
    clave: "2026-09",
    desde: "2026-09-01",
    hasta: "2026-09-30",
    nombreMes: "setiembre",
  });
  assert.equal(mesAnterior("2027-01-03").clave, "2026-12");
  assert.equal(mesAnterior("2027-01-03").hasta, "2026-12-31");
  assert.equal(mesAnterior("2028-03-01").hasta, "2028-02-29");
});

test("el mes en curso llega solo hasta hoy, no hasta fin de mes", () => {
  assert.deepEqual(mesActual("2026-10-09"), {
    clave: "2026-10",
    desde: "2026-10-01",
    hasta: "2026-10-09",
    nombreMes: "octubre",
  });
});

test("el mes en curso el día 1 es un solo día", () => {
  assert.deepEqual(mesActual("2026-01-01"), {
    clave: "2026-01",
    desde: "2026-01-01",
    hasta: "2026-01-01",
    nombreMes: "enero",
  });
});

test("responder, guardar memoria y generar documentos no cuentan como cosas anotadas", () => {
  const i = calcularImpacto("2026-09", {
    ...VACIO,
    acciones: ["RESPONDER", "GUARDAR_MEMORIA", "GENERAR_EXCEL", "GENERAR_PDF", "REGISTRAR_VENTA"],
  });

  assert.equal(i.anotadas, 1);
  assert.equal(i.documentos, 2);
  assert.equal(i.minutosAhorrados, MINUTOS_POR_REGISTRO);
});

test("los grupos se ordenan por cantidad y 'otras' queda siempre al final", () => {
  const i = calcularImpacto("2026-09", {
    ...VACIO,
    acciones: [
      "ANULAR_VENTA",
      "ANULAR_COMPRA",
      "ANULAR_COMPRA",
      "ANULAR_VENTA",
      "REGISTRAR_VENTA",
      "REGISTRAR_VENTA",
      "CREAR_PRODUCTO",
    ],
  });

  assert.deepEqual(
    i.porGrupo.map((g) => g.grupo),
    ["ventas", "productos", "otras"],
  );
});

test("sin actividad no hay nada que contar", () => {
  assert.equal(tieneAlgoQueContar(calcularImpacto("2026-09", VACIO)), false);
  // Solo respuestas y memorias tampoco: no es impacto.
  assert.equal(
    tieneAlgoQueContar(calcularImpacto("2026-09", { ...VACIO, acciones: ["RESPONDER", "GUARDAR_MEMORIA"] })),
    false,
  );
});

test("un mes flaco no vale un correo; diez cosas o un cobro sí", () => {
  const cosas = (n: number) => calcularImpacto("2026-09", { ...VACIO, acciones: Array(n).fill("CREAR_TAREA") });

  assert.equal(tieneAlgoQueContar(cosas(MINIMO_DE_COSAS - 1)), false);
  assert.equal(tieneAlgoQueContar(cosas(MINIMO_DE_COSAS)), true);
  // Un documento suelto tampoco (era el caso real de agosto).
  assert.equal(tieneAlgoQueContar(calcularImpacto("2026-09", { ...VACIO, acciones: ["GENERAR_EXCEL"] })), false);
  // Un cobro de algo que le debían sí: es plata que entró.
  assert.equal(
    tieneAlgoQueContar(calcularImpacto("2026-09", { ...VACIO, cobrosDeCredito: [{ total: 66_000 }] })),
    true,
  );
});

test("el tiempo se redondea para abajo, nunca de más", () => {
  assert.equal(tiempoEnPalabras(40), "unos 40 minutos");
  assert.equal(tiempoEnPalabras(60), "más de una hora");
  assert.equal(tiempoEnPalabras(119), "más de una hora");
  assert.equal(tiempoEnPalabras(428), "unas 7 horas");
});

test("una línea solo aparece si tiene su dato", () => {
  const soloVentas = lineasDelInforme(
    calcularImpacto("2026-09", { ...VACIO, ventas: [{ total: 150000 }, { total: 50000 }] }),
  );
  assert.deepEqual(soloVentas, ["Quedaron registradas 2 ventas por ₲ 200.000."]);
});

test("el informe completo dice los números exactos y el supuesto de minutos", () => {
  const impacto = calcularImpacto("2026-09", {
    acciones: [
      ...Array(120).fill("REGISTRAR_VENTA"),
      ...Array(40).fill("REGISTRAR_COMPRA"),
      ...Array(54).fill("CREAR_PRODUCTO"),
      "GENERAR_EXCEL",
    ],
    ventas: [{ total: 12_000_000 }, { total: 300_000 }],
    cobrosDeCredito: [{ total: 2_000_000 }, { total: 350_000 }],
    porCobrar: [
      { total: 500_000, contacto_id: "a" },
      { total: 200_000, contacto_id: "a" },
      { total: 500_000, contacto_id: "b" },
    ],
  });

  const lineas = lineasDelInforme(impacto);

  assert.deepEqual(lineas, [
    "Anoté 214 cosas por vos: 120 ventas, 54 cambios de productos y stock, 40 compras y gastos.",
    "Eso es unas 7 horas que no pasaste anotando (contamos 2 minutos por cada cosa).",
    "Quedaron registradas 2 ventas por ₲ 12.300.000.",
    "Cobraste ₲ 2.350.000 de ventas que te debían.",
    'Hoy te deben ₲ 1.200.000 entre 2 clientes. Preguntame "¿quién me debe?" y te paso la lista.',
    "Te armé 1 documento (Excel, PDF o Word).",
  ]);
});

test("el correo no usa palabras prohibidas y escapa el nombre", () => {
  const { asunto, html, texto } = redactarInforme({
    impacto: calcularImpacto("2026-09", { ...VACIO, acciones: ["REGISTRAR_VENTA"] }),
    nombreMes: "setiembre",
    nombre: "<Carmen> López",
    appUrl: "https://eos.test",
    urlBaja: "https://eos.test/baja",
  });

  assert.equal(asunto, "Lo que EOS hizo por vos en setiembre");
  assert.ok(html.includes("Hola &lt;Carmen&gt;,"));
  assert.ok(!html.includes("<Carmen>"));
  assert.ok(texto.includes("https://eos.test/baja"));
  for (const prohibida of ["ilimitado", "sin tope", "sin límite"]) {
    assert.ok(!`${asunto} ${html} ${texto}`.toLowerCase().includes(prohibida), prohibida);
  }
});

test("la baja del informe está firmada con su propio motivo", () => {
  const url = new URL(urlDeBajaImpacto("https://eos.test", "u1", "secreto"));
  const token = url.searchParams.get("t")!;

  assert.equal(url.searchParams.get("m"), MOTIVO_BAJA_IMPACTO);
  assert.ok(tokenDeBajaValido("u1", MOTIVO_BAJA_IMPACTO, token, "secreto"));
  // No sirve para dar de baja los motivacionales.
  assert.ok(!tokenDeBajaValido("u1", "motivacionales", token, "secreto"));
});

// ---------------------------------------------------------------------------
// El envío, con una fuente en memoria
// ---------------------------------------------------------------------------

function fuenteFalsa(opciones: {
  cuentas: Record<string, { email: string | null; hechos: HechosDelMes }>;
  bajas?: string[];
  reclamados?: string[];
}) {
  const reclamados = new Set(opciones.reclamados ?? []);
  const guardados = new Map<string, unknown>();

  const fuente: Fuente = {
    cuentasConActividad: async () => Object.keys(opciones.cuentas),
    yaReclamados: async () => new Set(reclamados),
    bajas: async () => new Set(opciones.bajas ?? []),
    perfil: async (uid) => ({ nombre: "Carmen", email: opciones.cuentas[uid]?.email ?? null }),
    hechos: async (uid) => opciones.cuentas[uid].hechos,
    reclamar: async (uid, _p, datos) => {
      if (reclamados.has(uid)) return false;
      reclamados.add(uid);
      guardados.set(uid, datos);
      return true;
    },
    soltar: async (uid) => {
      reclamados.delete(uid);
      guardados.delete(uid);
    },
  };

  return { fuente, reclamados, guardados };
}

const CON_VENTA: HechosDelMes = {
  ...VACIO,
  acciones: Array(MINIMO_DE_COSAS).fill("REGISTRAR_VENTA"),
  ventas: [{ total: 100 }],
};

test("después del día 5 no se manda nada", async () => {
  const { fuente } = fuenteFalsa({ cuentas: { a: { email: "a@x.py", hechos: CON_VENTA } } });
  const enviados: CorreoInforme[] = [];

  const r = await enviarInformesDeImpacto(fuente, {
    hoy: "2026-10-06",
    appUrl: "https://eos.test",
    secreto: "s",
    enviar: async (c) => void enviados.push(c),
  });

  assert.equal(r.periodo, null);
  assert.equal(enviados.length, 0);
});

test("manda una vez por cuenta, respeta la baja y guarda los números enviados", async () => {
  const { fuente, guardados } = fuenteFalsa({
    cuentas: {
      a: { email: "a@x.py", hechos: CON_VENTA },
      b: { email: "b@x.py", hechos: CON_VENTA },
      c: { email: "c@x.py", hechos: { ...VACIO, acciones: ["RESPONDER"] } },
      d: { email: null, hechos: CON_VENTA },
    },
    bajas: ["b"],
  });
  const enviados: CorreoInforme[] = [];
  const correr = () =>
    enviarInformesDeImpacto(fuente, {
      hoy: "2026-10-01",
      appUrl: "https://eos.test",
      secreto: "s",
      enviar: async (c) => void enviados.push(c),
    });

  const primera = await correr();
  assert.equal(primera.periodo, "2026-09");
  assert.equal(primera.enviados, 1);
  assert.equal(primera.sinNadaQueContar, 1);
  assert.deepEqual(
    enviados.map((c) => c.para),
    ["a@x.py"],
  );
  assert.equal((guardados.get("a") as { ventas: { total: number } }).ventas.total, 100);

  // El cron del día siguiente no lo repite.
  const segunda = await correr();
  assert.equal(segunda.enviados, 0);
  assert.equal(enviados.length, 1);
});

test("si el envío falla, se suelta el reclamo y al día siguiente se reintenta", async () => {
  const { fuente, reclamados } = fuenteFalsa({ cuentas: { a: { email: "a@x.py", hechos: CON_VENTA } } });

  const r1 = await enviarInformesDeImpacto(fuente, {
    hoy: "2026-10-01",
    appUrl: "https://eos.test",
    secreto: "s",
    enviar: async () => {
      throw new Error("Resend caído");
    },
  });
  assert.equal(r1.fallidos, 1);
  assert.equal(reclamados.has("a"), false);

  const enviados: CorreoInforme[] = [];
  const r2 = await enviarInformesDeImpacto(fuente, {
    hoy: "2026-10-02",
    appUrl: "https://eos.test",
    secreto: "s",
    enviar: async (c) => void enviados.push(c),
  });
  assert.equal(r2.enviados, 1);
  assert.equal(enviados.length, 1);
});

// ---------------------------------------------------------------------------
// La fuente real, con una base en memoria: pagos parciales y saldo
// ---------------------------------------------------------------------------

function baseEnMemoria(tablas: Record<string, Record<string, unknown>[]>) {
  return {
    rpc: async () => ({ data: "emp1", error: null }),
    from(tabla: string) {
      const filtros: ((f: Record<string, unknown>) => boolean)[] = [];
      const q: Record<string, unknown> = {
        select: () => q,
        order: () => q,
        limit: () => q,
        eq: (c: string, v: unknown) => (filtros.push((f) => f[c] === v), q),
        neq: (c: string, v: unknown) => (filtros.push((f) => f[c] !== v), q),
        in: (c: string, v: unknown[]) => (filtros.push((f) => v.includes(f[c])), q),
        gte: (c: string, v: string) => (filtros.push((f) => String(f[c]) >= v), q),
        lte: (c: string, v: string) => (filtros.push((f) => String(f[c]) <= v), q),
        not: (c: string) => (filtros.push((f) => f[c] !== null && f[c] !== undefined), q),
        // filtroDeEmpresa: "empresa_id.eq.<id>"
        or: (expr: string) => {
          const [, col, , valor] = /^(\w+)\.(eq)\.(.+)$/.exec(expr) ?? [];
          if (col) filtros.push((f) => f[col] === valor);
          return q;
        },
        then: (ok: (r: unknown) => unknown) =>
          Promise.resolve({ data: (tablas[tabla] ?? []).filter((f) => filtros.every((fn) => fn(f))), error: null }).then(ok),
      };
      return q;
    },
  };
}

test("el informe cuenta pagos parciales del mes y el saldo real de lo que le deben", async () => {
  const { fuenteSupabase } = await import("./enviar.ts");
  const base = baseEnMemoria({
    eos_action_commands: [],
    eos_erp_ventas: [
      // Juan: 1.000.000 a crédito, pagó 400.000 en setiembre y el resto en setiembre al saldarla.
      { id: "v1", usuario_id: "u1", empresa_id: "emp1", fecha: "2026-08-20", total: 1_000_000, moneda: "PYG", condicion: "credito", estado: "cobrada", movimiento_id: "m1", contacto: { id: "juan", nombre: "Juan" } },
      // María: 500.000 a crédito, pagó 200.000; le queda 300.000.
      { id: "v2", usuario_id: "u1", empresa_id: "emp1", fecha: "2026-09-10", total: 500_000, moneda: "PYG", condicion: "credito", estado: "emitida", movimiento_id: null, contacto: { id: "maria", nombre: "María" } },
    ],
    eos_erp_cuenta_movimientos_v107: [
      { id: "p1", empresa_id: "emp1", venta_id: "v1", monto: 400_000, moneda: "PYG", fecha: "2026-09-05" },
      { id: "p2", empresa_id: "emp1", venta_id: "v2", monto: 200_000, moneda: "PYG", fecha: "2026-09-12" },
    ],
    eos_movimientos_financieros: [{ id: "m1", usuario_id: "u1", ambito: "negocio", fecha: "2026-09-20" }],
  });

  const fuente = fuenteSupabase(base as never);
  const hechos = await fuente.hechos("u1", mesAnterior("2026-10-01"));
  const i = calcularImpacto("2026-09", hechos);

  // 400.000 + 200.000 parciales + 600.000 que faltaba de Juan al saldarla.
  assert.equal(i.cobrado.total, 1_200_000);
  // María debe el saldo, no el total.
  assert.deepEqual(i.porCobrar, { clientes: 1, total: 300_000 });
});

test("cuenta los avisos que llegaron, juntando los del mismo tema (negocio-02)", () => {
  const i = calcularImpacto("2026-09", {
    ...VACIO,
    avisos: [{ tipo: "inventario_bajo" }, { tipo: "stock_por_agotarse" }, { tipo: "pagos_a_proveedores" }],
  });
  assert.deepEqual(i.avisos, {
    total: 3,
    porTema: [
      { tema: "stock", cantidad: 2 },
      { tema: "pagos a proveedores", cantidad: 1 },
    ],
  });
  assert.ok(lineasDelInforme(i).includes("Te avisé 3 veces de algo antes de que pasara: stock (2), pagos a proveedores."));
});

test("sin historia de avisos, no hay línea de avisos ni cambia si se manda", () => {
  const i = calcularImpacto("2026-09", VACIO);
  assert.deepEqual(i.avisos, { total: 0, porTema: [] });
  assert.ok(!lineasDelInforme(i).some((l) => l.startsWith("Te avisé")));
  assert.equal(tieneAlgoQueContar(calcularImpacto("2026-09", { ...VACIO, avisos: [{ tipo: "faltante" }] })), false);
});
