import assert from "node:assert/strict";
import test from "node:test";

import { avisarSeguimientosCRM, claveDelAviso, redactarAvisoSeguimientos } from "./avisar-crm.ts";
import type { Seguimiento } from "./seguimientos.ts";
import { baseFalsa } from "../whatsapp-crm/base-falsa.ts";

const seg = (extra: Partial<Seguimiento> = {}): Seguimiento => ({
  clave: "sin_respuesta:c-1:2026-09-15",
  tipo: "sin_respuesta",
  prioridad: 1,
  contacto_id: "c-1",
  contacto_nombre: "Marcos",
  oportunidad_id: "o-1",
  texto: "x",
  recomendacion: "y",
  accion: "escribir",
  puede_escribir: true,
  borrador: "Hola",
  dias: 4,
  monto: { valor: 5_000_000, moneda: "PYG" },
  ...extra,
});

const HOY = "2026-09-19";

/** Un solo usuario con CRM, y un historial de avisos que se puede cambiar. */
function base(previos: unknown = [], extra: Record<string, never> = {}) {
  return baseFalsa({
    "eos_usuario_modulos.select": { data: [{ usuario_id: "u-1" }], error: null },
    "eos_negocio_avisos.select": { data: previos, error: null },
    ...extra,
  });
}

const sinAprender = async () => ({ guardados: 0, retirados: 0 });

// ------------------------------------------------------------------- el texto

test("el aviso nombra a los clientes con su motivo, y dice cuántos más hay", () => {
  const t = redactarAvisoSeguimientos([
    seg(),
    seg({ clave: "b", contacto_nombre: "Ana", tipo: "cierre_proximo" }),
    seg({ clave: "c", contacto_nombre: "Luis", tipo: "vencido" }),
    seg({ clave: "d", contacto_nombre: "Rosa" }),
    seg({ clave: "e", contacto_nombre: "Pedro" }),
  ]);

  assert.match(t, /Hoy conviene retomar 5 clientes: Marcos \(sin respuesta hace 4 días\), Ana \(cierre cerca\), Luis \(seguimiento vencido\) y 2 más\./);
  assert.match(t, /CRM > Para retomar/);
});

test("con un solo cliente, el singular", () => {
  assert.match(redactarAvisoSeguimientos([seg()]), /^Hoy conviene retomar 1 cliente: Marcos/);
});

test("el aviso no lleva el monto: el correo y el push los ve quien mire la pantalla", () => {
  assert.ok(!/5\.000\.000|₲|PYG/.test(redactarAvisoSeguimientos([seg()])));
});

test("la clave no depende del orden y se acorta si es muy larga", () => {
  assert.equal(claveDelAviso([seg({ clave: "b" }), seg({ clave: "a" })]), claveDelAviso([seg({ clave: "a" }), seg({ clave: "b" })]));

  const muchas = Array.from({ length: 30 }, (_, i) => seg({ clave: `sin_respuesta:contacto-${i}:2026-09-15` }));
  assert.match(claveDelAviso(muchas), /^h:[0-9a-f]{40}$/);
});

// ----------------------------------------------------------- quién y cuándo

test("avisa de lo urgente, lo anota y aprende de los cierres", async () => {
  const { admin, pedidos } = base();
  const entregas: string[] = [];

  const r = await avisarSeguimientosCRM(admin, {
    hoy: HOY,
    leer: async () => [seg(), seg({ clave: "otro", prioridad: 3, contacto_nombre: "No urgente" })],
    aprender: async () => ({ guardados: 2, retirados: 0 }),
    entregar: async (_a, _u, texto) => {
      entregas.push(texto);
      return true;
    },
  });

  assert.equal(r.avisados, 1);
  assert.equal(r.aprendizajes_guardados, 2);
  assert.equal(entregas.length, 1);
  // Solo lo urgente: el de prioridad 3 está en la pantalla, no en el aviso.
  assert.ok(!entregas[0].includes("No urgente"));

  const anotado = pedidos.find((p) => p.clave === "eos_negocio_avisos.upsert")!.payload as Record<string, unknown>;
  assert.equal(anotado.usuario_id, "u-1");
  assert.equal(anotado.tipo, "seguimientos_crm");
});

test("el mismo conjunto no se avisa dos días seguidos", async () => {
  const { admin } = base([{ tipo: "seguimientos_crm", clave: claveDelAviso([seg()]) }]);
  let entregas = 0;

  const r = await avisarSeguimientosCRM(admin, {
    hoy: HOY,
    leer: async () => [seg()],
    aprender: sinAprender,
    entregar: async () => {
      entregas += 1;
      return true;
    },
  });

  assert.equal(r.omitidos_por_repetido, 1);
  assert.equal(entregas, 0);
});

test("si cambia el conjunto (entró otro cliente), sí se vuelve a avisar", async () => {
  const { admin } = base([{ tipo: "seguimientos_crm", clave: claveDelAviso([seg()]) }]);

  const r = await avisarSeguimientosCRM(admin, {
    hoy: HOY,
    leer: async () => [seg(), seg({ clave: "nuevo", contacto_nombre: "Ana" })],
    aprender: sinAprender,
    entregar: async () => true,
  });

  assert.equal(r.avisados, 1);
});

test("cuando ya no hay nada urgente, el aviso se olvida para que el próximo salga", async () => {
  const { admin, pedidos } = base([{ tipo: "seguimientos_crm", clave: "vieja" }]);

  const r = await avisarSeguimientosCRM(admin, {
    hoy: HOY,
    leer: async () => [seg({ prioridad: 3 })],
    aprender: sinAprender,
    entregar: async () => {
      throw new Error("no debía avisar");
    },
  });

  assert.equal(r.resueltos, 1);
  const borrado = pedidos.find((p) => p.clave === "eos_negocio_avisos.delete")!;
  assert.ok(borrado.filtros.some((f) => f.metodo === "eq" && f.args[0] === "usuario_id" && f.args[1] === "u-1"));
});

test("sin canal para entregarlo NO se anota: mañana tiene que enterarse", async () => {
  const { admin, pedidos } = base();

  const r = await avisarSeguimientosCRM(admin, { hoy: HOY, leer: async () => [seg()], aprender: sinAprender, entregar: async () => false });

  assert.equal(r.sin_canal, 1);
  assert.ok(!pedidos.some((p) => p.clave === "eos_negocio_avisos.upsert"));
});

// --------------------------------------------------- cuando algo no se puede leer

test("si no se puede leer el historial de avisos, no se avisa (sería repetir todos los días)", async () => {
  const { admin } = baseFalsa({
    "eos_usuario_modulos.select": { data: [{ usuario_id: "u-1" }], error: null },
    "eos_negocio_avisos.select": { data: null, error: { code: "42P01", message: "x" } },
  });
  const original = console.error;
  console.error = () => {};

  try {
    const r = await avisarSeguimientosCRM(admin, {
      hoy: HOY,
      leer: async () => [seg()],
      aprender: sinAprender,
      entregar: async () => {
        throw new Error("no debía avisar");
      },
    });
    assert.equal(r.sin_historial, 1);
    assert.equal(r.avisados, 0);
  } finally {
    console.error = original;
  }
});

test("si no se pueden calcular los seguimientos, no se avisa con datos a medias", async () => {
  const { admin } = base();
  const original = console.error;
  console.error = () => {};

  try {
    const r = await avisarSeguimientosCRM(admin, {
      hoy: HOY,
      leer: async () => {
        throw new Error("no se pudo leer");
      },
      aprender: sinAprender,
      entregar: async () => {
        throw new Error("no debía avisar");
      },
    });
    assert.equal(r.sin_calculo, 1);
  } finally {
    console.error = original;
  }
});

test("si el aprendizaje falla, igual se avisa: son dos trabajos distintos", async () => {
  const { admin } = base();
  const original = console.error;
  console.error = () => {};

  try {
    const r = await avisarSeguimientosCRM(admin, {
      hoy: HOY,
      leer: async () => [seg()],
      aprender: async () => {
        throw new Error("falló");
      },
      entregar: async () => true,
    });
    assert.equal(r.avisados, 1);
  } finally {
    console.error = original;
  }
});

test("las consultas de usuarios llevan el módulo y el estado; el historial, el usuario", async () => {
  const { admin, pedidos } = base();
  await avisarSeguimientosCRM(admin, { hoy: HOY, leer: async () => [], aprender: sinAprender, entregar: async () => true });

  const modulos = pedidos.find((p) => p.clave === "eos_usuario_modulos.select")!;
  assert.ok(modulos.filtros.some((f) => f.metodo === "eq" && f.args[0] === "modulo_codigo" && f.args[1] === "crm"));
  assert.ok(modulos.filtros.some((f) => f.metodo === "eq" && f.args[0] === "estado" && f.args[1] === "activo"));

  const historial = pedidos.find((p) => p.clave === "eos_negocio_avisos.select")!;
  assert.ok(historial.filtros.some((f) => f.metodo === "eq" && f.args[0] === "usuario_id" && f.args[1] === "u-1"));
});
