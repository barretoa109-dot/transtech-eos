import assert from "node:assert/strict";
import test from "node:test";

import {
  calcularSeguimientos,
  titularDeSeguimientos,
  type EntradaSeguimientos,
} from "./seguimientos.ts";

const HOY = "2026-09-19";

function entrada(parcial: Partial<EntradaSeguimientos> = {}): EntradaSeguimientos {
  return {
    hoy: HOY,
    contactos: [{ id: "c1", nombre: "Carlos", estado_relacion: "activo", creado_en: "2026-08-01T10:00:00Z", activo: true }],
    oportunidades: [],
    actividades: [],
    mensajes: [],
    estados: [],
    puedenRecibir: new Set(["c1"]),
    ...parcial,
  };
}

const propuesta = (extra: Record<string, unknown> = {}) => ({
  id: "o1", contacto_id: "c1", titulo: "Plan empresarial", monto: 3_500_000, moneda: "PYG", etapa: "propuesta",
  actualizado_en: "2026-09-18T10:00:00Z", creado_en: "2026-09-01T10:00:00Z", ...extra,
});

const saliente = (fecha: string, extra: Record<string, unknown> = {}) => ({
  contacto_id: "c1", direccion: "saliente" as const, estado: "enviado", ocurrio_en: fecha, ...extra,
});
const entrante = (fecha: string) => ({ contacto_id: "c1", direccion: "entrante" as const, estado: "recibido", ocurrio_en: fecha });

// -------------------------------------------------------------- el ejemplo del pedido

test("EL EJEMPLO: hace 5 días que Carlos no responde a la propuesta de Gs. 3.500.000", () => {
  const r = calcularSeguimientos(entrada({
    oportunidades: [propuesta()],
    mensajes: [saliente("2026-09-14T14:00:00Z")],
  }));

  assert.equal(r.length, 1);
  assert.equal(r[0].tipo, "sin_respuesta");
  assert.match(r[0].texto, /^Hace 5 días que Carlos no responde a la propuesta de .*3\.500\.000\.$/);
  assert.equal(r[0].recomendacion, "Recomiendo hacer seguimiento hoy.");
  assert.equal(r[0].prioridad, 1);
  assert.equal(r[0].accion, "escribir");
  assert.equal(r[0].puede_escribir, true);
  assert.match(r[0].borrador!, /Hola Carlos, ¿pudiste ver la propuesta/);
});

// ------------------------------------------------------------------ sin respuesta

test("si el cliente contestó DESPUÉS de nuestro mensaje, no está sin respuesta", () => {
  const r = calcularSeguimientos(entrada({ mensajes: [saliente("2026-09-10T14:00:00Z"), entrante("2026-09-11T09:00:00Z")] }));
  assert.equal(r.find((s) => s.tipo === "sin_respuesta"), undefined);
});

test("con menos de tres días de espera no se insiste", () => {
  const r = calcularSeguimientos(entrada({ mensajes: [saliente("2026-09-17T14:00:00Z")] }));
  assert.equal(r.find((s) => s.tipo === "sin_respuesta"), undefined);
});

test("un mensaje nuestro que NO salió (bloqueado, fallido) no cuenta como 'le escribimos'", () => {
  const r = calcularSeguimientos(entrada({ mensajes: [saliente("2026-09-10T14:00:00Z", { estado: "bloqueado" }), saliente("2026-09-10T15:00:00Z", { estado: "fallido" })] }));
  assert.equal(r.find((s) => s.tipo === "sin_respuesta"), undefined);
});

test("sin propuesta abierta, la frase no la inventa", () => {
  const r = calcularSeguimientos(entrada({ mensajes: [saliente("2026-09-13T14:00:00Z")] }));
  assert.equal(r[0].texto, "Hace 6 días que le escribiste a Carlos y no respondió.");
  assert.equal(r[0].prioridad, 2);
});

test("con una propuesta sin monto, la frase omite el monto en vez de inventarlo", () => {
  const r = calcularSeguimientos(entrada({ oportunidades: [propuesta({ monto: 0 })], mensajes: [saliente("2026-09-14T14:00:00Z")] }));
  assert.equal(r[0].texto, "Hace 5 días que Carlos no responde a la propuesta.");
});

// ----------------------------------------------------------------- lo que se puso él

test("un seguimiento que se puso para hoy avisa; uno futuro, no", () => {
  const hoy = calcularSeguimientos(entrada({ contactos: [{ id: "c1", nombre: "Carlos", proxima_interaccion_en: HOY, activo: true }] }));
  assert.equal(hoy[0].tipo, "vence_hoy");
  assert.equal(hoy[0].texto, "Hoy tenías que retomar con Carlos.");

  const futuro = calcularSeguimientos(entrada({ contactos: [{ id: "c1", nombre: "Carlos", proxima_interaccion_en: "2026-09-25", activo: true }] }));
  assert.deepEqual(futuro, []);
});

test("uno vencido dice hace cuánto, y con plata en juego es urgente", () => {
  const r = calcularSeguimientos(entrada({
    contactos: [{ id: "c1", nombre: "Carlos", proxima_interaccion_en: "2026-09-16", activo: true }],
    oportunidades: [propuesta()],
  }));
  assert.equal(r[0].tipo, "vencido");
  assert.equal(r[0].texto, "Hace 3 días tenías que retomar con Carlos.");
  assert.equal(r[0].prioridad, 1);
});

test("una tarea pendiente y el próximo paso de una oportunidad también cuentan", () => {
  const tarea = calcularSeguimientos(entrada({ actividades: [{ contacto_id: "c1", tipo: "tarea", fecha: "2026-09-18", hecha: false }] }));
  assert.equal(tarea[0].tipo, "vencido");

  const paso = calcularSeguimientos(entrada({ oportunidades: [propuesta({ proxima_accion_en: HOY })] }));
  assert.ok(paso.some((s) => s.tipo === "vence_hoy"));

  // Una tarea YA hecha no avisa.
  const hecha = calcularSeguimientos(entrada({ actividades: [{ contacto_id: "c1", tipo: "tarea", fecha: "2026-09-18", hecha: true }] }));
  assert.deepEqual(hecha, []);
});

// ------------------------------------------------------------------- estancada

test("una oportunidad sin novedades hace 14 días o más está estancada", () => {
  const r = calcularSeguimientos(entrada({ oportunidades: [propuesta({ actualizado_en: "2026-09-01T10:00:00Z", creado_en: "2026-08-20T10:00:00Z" })] }));
  const e = r.find((s) => s.tipo === "estancada")!;
  assert.ok(e);
  assert.match(e.texto, /«Plan empresarial» \(.*3\.500\.000\) lleva 18 días sin novedades\./);
});

test("cualquier novedad reciente (un mensaje, una actividad) la saca de estancada", () => {
  const base = { oportunidades: [propuesta({ actualizado_en: "2026-09-01T10:00:00Z" })] };
  assert.equal(calcularSeguimientos(entrada({ ...base, mensajes: [entrante("2026-09-17T10:00:00Z")] })).find((s) => s.tipo === "estancada"), undefined);
  assert.equal(calcularSeguimientos(entrada({ ...base, actividades: [{ contacto_id: "c1", tipo: "llamada", fecha: "2026-09-16", hecha: true }] })).find((s) => s.tipo === "estancada"), undefined);
});

// ------------------------------------------------------------------------- leads

test("alguien que escribió y a quien nadie contestó es un lead sin contactar", () => {
  const r = calcularSeguimientos(entrada({ mensajes: [entrante("2026-09-17T10:00:00Z")] }));
  assert.equal(r[0].tipo, "lead_sin_contactar");
  assert.match(r[0].texto, /Carlos te escribió hace 2 días y todavía nadie le contestó\./);
  assert.equal(r[0].prioridad, 1);
});

test("si le contestamos DESPUÉS de que escribió, ya no es un lead sin contactar", () => {
  const r = calcularSeguimientos(entrada({ mensajes: [entrante("2026-09-17T10:00:00Z"), saliente("2026-09-17T11:00:00Z")] }));
  assert.equal(r.find((s) => s.tipo === "lead_sin_contactar"), undefined);
});

test("un prospecto cargado a mano y sin contactar también avisa", () => {
  const r = calcularSeguimientos(entrada({ contactos: [{ id: "c1", nombre: "Marta", estado_relacion: "prospecto", creado_en: "2026-09-15T10:00:00Z", activo: true }] }));
  assert.equal(r[0].tipo, "lead_sin_contactar");
  assert.match(r[0].texto, /Marta entró como prospecto hace 4 días y todavía no lo contactaste\./);
});

test("un cliente activo (no prospecto) que nunca recibió mensajes NO es un lead", () => {
  assert.deepEqual(calcularSeguimientos(entrada()), []);
});

// ------------------------------------------------------------------------ cierres

test("un cierre estimado próximo avisa; uno lejano, no", () => {
  const cerca = calcularSeguimientos(entrada({ oportunidades: [propuesta({ cierre_estimado: "2026-09-22", actualizado_en: "2026-09-19T08:00:00Z" })] }));
  assert.equal(cerca[0].tipo, "cierre_proximo");
  assert.match(cerca[0].texto, /tiene cierre estimado el 22\/09 \(en 3 días\)\./);

  const lejos = calcularSeguimientos(entrada({ oportunidades: [propuesta({ cierre_estimado: "2026-10-30", actualizado_en: "2026-09-19T08:00:00Z" })] }));
  assert.deepEqual(lejos, []);
});

test("un cierre que ya pasó y sigue abierto lo dice, con hace cuánto", () => {
  const r = calcularSeguimientos(entrada({ oportunidades: [propuesta({ cierre_estimado: "2026-09-15", actualizado_en: "2026-09-19T08:00:00Z" })] }));
  assert.match(r[0].texto, /tenía cierre estimado el 15\/09, hace 4 días, y sigue abierta\./);
  assert.match(r[0].recomendacion, /Ganala, perdela o poné una fecha nueva/);
});

test("las tres oportunidades de más plata son las urgentes", () => {
  const ops = ["a", "b", "c", "d"].map((id, i) => propuesta({ id, contacto_id: null, titulo: id, monto: (4 - i) * 1_000_000, cierre_estimado: "2026-09-21", actualizado_en: "2026-09-19T08:00:00Z" }));
  const r = calcularSeguimientos(entrada({ oportunidades: ops, contactos: [] }));
  assert.deepEqual(r.map((s) => [s.oportunidad_id, s.prioridad]), [["a", 1], ["b", 1], ["c", 1], ["d", 3]]);
});

// ------------------------------------------------------------------ reglas de ruido

test("UN aviso por cliente: el más urgente, no tres", () => {
  const r = calcularSeguimientos(entrada({
    contactos: [{ id: "c1", nombre: "Carlos", proxima_interaccion_en: "2026-09-10", activo: true }],
    oportunidades: [propuesta({ cierre_estimado: "2026-09-20", actualizado_en: "2026-08-01T10:00:00Z" })],
    mensajes: [saliente("2026-09-12T14:00:00Z")],
  }));
  assert.equal(r.filter((s) => s.contacto_id === "c1").length, 1);
});

test("lo que la persona marcó hecho o descartó no vuelve", () => {
  const base = { oportunidades: [propuesta()], mensajes: [saliente("2026-09-14T14:00:00Z")] };
  const clave = calcularSeguimientos(entrada(base))[0].clave;

  for (const estado of ["hecho", "descartado"] as const) {
    assert.deepEqual(calcularSeguimientos(entrada({ ...base, estados: [{ clave, estado, hasta: null }] })), [], estado);
  }
});

test("un pospuesto vuelve a partir de su fecha, no antes", () => {
  const base = { oportunidades: [propuesta()], mensajes: [saliente("2026-09-14T14:00:00Z")] };
  const clave = calcularSeguimientos(entrada(base))[0].clave;

  assert.deepEqual(calcularSeguimientos(entrada({ ...base, estados: [{ clave, estado: "pospuesto", hasta: "2026-09-22" }] })), []);
  assert.equal(calcularSeguimientos(entrada({ ...base, estados: [{ clave, estado: "pospuesto", hasta: HOY }] })).length, 1);
});

test("si le escribimos de nuevo, la clave cambia y el aviso viejo (hecho) no tapa al nuevo", () => {
  const primero = calcularSeguimientos(entrada({ mensajes: [saliente("2026-09-10T14:00:00Z")] }))[0];
  const marcado = { clave: primero.clave, estado: "hecho" as const, hasta: null };

  // Pasan los días, se le vuelve a escribir y otra vez no contesta: es OTRO aviso.
  const despues = calcularSeguimientos(entrada({ hoy: "2026-09-25", mensajes: [saliente("2026-09-10T14:00:00Z"), saliente("2026-09-20T14:00:00Z")], estados: [marcado] }));
  assert.equal(despues.length, 1);
  assert.notEqual(despues[0].clave, primero.clave);
});

test("un cliente archivado no genera avisos", () => {
  const r = calcularSeguimientos(entrada({ contactos: [{ id: "c1", nombre: "Carlos", activo: false, proxima_interaccion_en: "2026-09-10" }] }));
  assert.deepEqual(r, []);
});

// ------------------------------------------------------------ poder escribir desde EOS

test("si no se le puede escribir (baja, canal pausado), el aviso lo dice y sigue apareciendo", () => {
  const r = calcularSeguimientos(entrada({ mensajes: [saliente("2026-09-10T14:00:00Z")], puedenRecibir: new Set() }));
  assert.equal(r[0].puede_escribir, false);
  // El borrador sigue: la persona puede usarlo por otra vía.
  assert.ok(r[0].borrador);
});

// ------------------------------------------------------------------------ el orden

test("primero lo urgente, y dentro de eso lo que más plata mueve", () => {
  const r = calcularSeguimientos(entrada({
    contactos: [
      { id: "c1", nombre: "Carlos", proxima_interaccion_en: HOY, activo: true },
      { id: "c2", nombre: "Marta", proxima_interaccion_en: HOY, activo: true },
      { id: "c3", nombre: "Luis", proxima_interaccion_en: "2026-09-10", activo: true },
    ],
    oportunidades: [propuesta({ id: "o1", contacto_id: "c1", monto: 1_000_000 }), propuesta({ id: "o2", contacto_id: "c2", monto: 9_000_000 })],
    puedenRecibir: new Set(),
  }));
  assert.deepEqual(r.map((s) => s.contacto_nombre), ["Marta", "Carlos", "Luis"]);
});

test("no se devuelven más de 20", () => {
  const contactos = Array.from({ length: 60 }, (_, i) => ({ id: `c${i}`, nombre: `Cliente ${i}`, proxima_interaccion_en: HOY, activo: true }));
  assert.equal(calcularSeguimientos(entrada({ contactos, puedenRecibir: new Set() })).length, 20);
});

test("datos rotos (fechas ilegibles, contactos huérfanos) no rompen", () => {
  const r = calcularSeguimientos(entrada({
    contactos: [{ id: "c1", nombre: "Carlos", proxima_interaccion_en: "no es fecha", activo: true }],
    actividades: [{ contacto_id: "no-existe", tipo: "tarea", fecha: "2026-09-10", hecha: false }, { contacto_id: null, tipo: "tarea", fecha: "x", hecha: false }],
    mensajes: [{ contacto_id: null, direccion: "entrante", estado: "recibido", ocurrio_en: "x" }],
  }));
  assert.deepEqual(r, []);
});

test("el titular cuenta y marca lo urgente", () => {
  assert.equal(titularDeSeguimientos([]), "Nada para retomar hoy.");
  const r = calcularSeguimientos(entrada({ oportunidades: [propuesta()], mensajes: [saliente("2026-09-14T14:00:00Z")] }));
  assert.equal(titularDeSeguimientos(r), "1 seguimiento, 1 urgente.");
});
