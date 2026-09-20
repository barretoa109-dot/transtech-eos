import assert from "node:assert/strict";
import test from "node:test";

import { contextoDeSeguimientos, textoSeguimientos } from "./contexto-chat.ts";
import type { Seguimiento } from "./seguimientos.ts";
import { baseFalsa } from "../whatsapp-crm/base-falsa.ts";

const seg = (extra: Partial<Seguimiento> = {}): Seguimiento => ({
  clave: "k",
  tipo: "sin_respuesta",
  prioridad: 1,
  contacto_id: "c-1",
  contacto_nombre: "Marcos",
  oportunidad_id: null,
  texto: "x",
  recomendacion: "y",
  accion: "escribir",
  puede_escribir: true,
  borrador: "Hola Marcos, ¿pudiste ver la propuesta?",
  dias: 4,
  monto: null,
  ...extra,
});

test("dice a quién, por qué y el mensaje propuesto, para que «sí, escribile» tenga sentido", () => {
  const t = textoSeguimientos([seg()]);

  assert.match(t, /- Marcos: no contesta hace 4 días\. Mensaje propuesto: «Hola Marcos, ¿pudiste ver la propuesta\?»/);
  assert.match(t, /ENVIAR_WHATSAPP_CLIENTE/);
  assert.match(t, /Sin una confirmación suya, no lo mandes/);
});

test("si no se le puede escribir desde EOS, lo dice y NO ofrece un mensaje", () => {
  const t = textoSeguimientos([seg({ puede_escribir: false, borrador: null })]);

  assert.match(t, /No se le puede escribir desde EOS/);
  assert.ok(!/Mensaje propuesto/.test(t));
});

test("los de prioridad 3 no entran, y son cinco como máximo", () => {
  const muchos = Array.from({ length: 9 }, (_, i) => seg({ contacto_nombre: `Cliente ${i}` }));
  const t = textoSeguimientos([...muchos, seg({ prioridad: 3, contacto_nombre: "Ruido" })]);

  assert.equal((t.match(/^- /gm) ?? []).length, 5);
  assert.ok(!t.includes("Ruido"));
  assert.equal(textoSeguimientos([seg({ prioridad: 3 })]), "");
  assert.equal(textoSeguimientos([]), "");
});

test("el mensaje propuesto se recorta: no llena el contexto", () => {
  const t = textoSeguimientos([seg({ borrador: "a ".repeat(500) })]);
  assert.ok(t.length < 700);
  assert.match(t, /…»/);
});

test("llamar y revisar no ofrecen escribir", () => {
  assert.match(textoSeguimientos([seg({ accion: "llamar", borrador: null })]), /Conviene llamarlo/);
  assert.match(textoSeguimientos([seg({ accion: "revisar", borrador: null })]), /Conviene revisarlo/);
});

// ------------------------------------------------------------------ el costo

test("sin el módulo CRM no se calcula nada", async () => {
  const { admin } = baseFalsa({ "eos_usuario_modulos.select": { data: null, error: null } });
  let llamado = false;

  const t = await contextoDeSeguimientos(admin, "u-1", {
    hoy: "2026-09-19",
    leer: async () => {
      llamado = true;
      return [seg()];
    },
  });

  assert.equal(t, "");
  assert.equal(llamado, false);
});

test("con el módulo, lee los seguimientos del usuario correcto", async () => {
  const { admin, pedidos } = baseFalsa({ "eos_usuario_modulos.select": { data: { usuario_id: "u-1" }, error: null } });
  let para = "";

  const t = await contextoDeSeguimientos(admin, "u-1", {
    hoy: "2026-09-19",
    leer: async (_db, uid) => {
      para = uid;
      return [seg()];
    },
  });

  assert.match(t, /Marcos/);
  assert.equal(para, "u-1");
  const consulta = pedidos.find((p) => p.clave === "eos_usuario_modulos.select")!;
  assert.ok(consulta.filtros.some((f) => f.metodo === "eq" && f.args[0] === "usuario_id" && f.args[1] === "u-1"));
});

test("si tarda más del plazo, el chat sigue sin esta sección", async () => {
  const { admin } = baseFalsa({ "eos_usuario_modulos.select": { data: { usuario_id: "u-1" }, error: null } });
  const empezo = Date.now();

  const t = await contextoDeSeguimientos(admin, "u-1", {
    hoy: "2026-09-19",
    plazoMs: 30,
    leer: () => new Promise((resolver) => setTimeout(() => resolver([seg()]), 2000).unref()),
  });

  assert.equal(t, "");
  assert.ok(Date.now() - empezo < 1000, "no esperó a que terminara");
});

test("si algo falla, el chat sigue sin esta sección", async () => {
  const { admin } = baseFalsa({ "eos_usuario_modulos.select": { data: { usuario_id: "u-1" }, error: null } });
  const original = console.error;
  console.error = () => {};

  try {
    const t = await contextoDeSeguimientos(admin, "u-1", {
      hoy: "2026-09-19",
      leer: async () => {
        throw new Error("boom");
      },
    });
    assert.equal(t, "");
  } finally {
    console.error = original;
  }
});
