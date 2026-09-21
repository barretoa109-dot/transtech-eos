import assert from "node:assert/strict";
import test from "node:test";

import { armarAgenda, type ContextoAgenda } from "./fuentes.ts";

type Respuesta = { data: unknown[] | null; error: unknown };

/**
 * Un cliente de Supabase de mentira: cada método de la cadena devuelve la misma
 * cadena, y al esperarla contesta según la tabla. Alcanza para probar qué hace
 * el calendario con lo que la base le contesta, sin base.
 */
function cliente(porTabla: Record<string, Respuesta>, consultadas: string[] = []) {
  return {
    from(tabla: string) {
      consultadas.push(tabla);
      const respuesta = porTabla[tabla] ?? { data: [], error: null };
      const cadena: Record<string, unknown> = {};
      const metodos = ["select", "eq", "neq", "in", "not", "or", "gte", "lte", "lt", "order", "limit"];
      for (const m of metodos) cadena[m] = () => cadena;
      cadena.then = (resolver: (r: Respuesta) => unknown) => Promise.resolve(respuesta).then(resolver);
      return cadena;
    },
  };
}

function contexto(parcial: Partial<ContextoAgenda> & Pick<ContextoAgenda, "supabase">): ContextoAgenda {
  return {
    usuarioId: "u1",
    empresaId: "e1",
    admin: cliente({}),
    hoy: "2026-09-20",
    desde: "2026-08-31",
    hasta: "2026-10-11",
    modulos: { crm: false, erp: false, finanzas: false },
    ...parcial,
  };
}

const PROPIO = {
  id: "abc",
  titulo: "Reunión con el contador",
  detalle: null,
  categoria: "agenda",
  fecha: "2026-09-21",
  hora_inicio: "10:00:00",
  hora_fin: null,
  estado: "pendiente",
  contacto_nombre: null,
};

test("lo anotado a mano aparece, con la hora normalizada y como editable", async () => {
  const { eventos, fuentes_caidas } = await armarAgenda(
    contexto({ supabase: cliente({ eos_calendario_eventos: { data: [PROPIO], error: null } }) }),
  );

  assert.deepEqual(fuentes_caidas, []);
  assert.equal(eventos.length, 1);
  assert.equal(eventos[0].id, "propio:abc");
  assert.equal(eventos[0].hora, "10:00");
  assert.equal(eventos[0].editable, true);
});

test("si una fuente falla, las demás siguen y el calendario dice cuál faltó", async () => {
  // Las metas se caen. El calendario NO puede mostrar el mes como si no
  // tuviera metas: tiene que decir que no pudo leerlas.
  const { eventos, fuentes_caidas } = await armarAgenda(
    contexto({
      supabase: cliente({
        eos_calendario_eventos: { data: [PROPIO], error: null },
        eos_goals: { data: null, error: { message: "boom" } },
      }),
    }),
  );

  assert.equal(eventos.length, 1, "lo que sí se pudo leer tiene que aparecer");
  assert.deepEqual(fuentes_caidas, ["las metas"]);
});

test("sin el módulo, no se consulta la tabla del módulo", async () => {
  // Una tarea del CRM no puede colarse por el calendario a quien no lo contrató.
  const consultadas: string[] = [];
  const supabase = cliente({}, consultadas);

  await armarAgenda(contexto({ supabase, modulos: { crm: false, erp: false, finanzas: false } }));

  assert.ok(!consultadas.some((t) => t.startsWith("eos_crm_")), `consultó ${consultadas.join(", ")}`);
});

test("con el módulo CRM se leen sus actividades, y los WhatsApp ya hechos no ensucian", async () => {
  const { eventos } = await armarAgenda(
    contexto({
      modulos: { crm: true, erp: false, finanzas: false },
      supabase: cliente({
        eos_crm_actividades: {
          data: [
            { id: "1", tipo: "tarea", detalle: "Llamar a Marta", fecha: "2026-09-21", hecha: false, contacto: { nombre: "Marta" } },
            { id: "2", tipo: "whatsapp", detalle: "El cliente escribió por WhatsApp: hola", fecha: "2026-09-21", hecha: true, contacto: null },
            { id: "3", tipo: "tarea", detalle: "Mandar factura", fecha: "2026-09-18", hecha: true, contacto: null },
            { id: "4", tipo: "reunion", detalle: "Visita a la chacra", fecha: "2026-09-22", hecha: false, contacto: null },
          ],
          error: null,
        },
      }),
    }),
  );

  const porId = new Map(eventos.map((e) => [e.id, e]));

  assert.equal(porId.has("crm:2"), false, "el WhatsApp entrante ya hecho tapa todo lo demás");
  assert.equal(porId.get("crm:1")?.categoria, "seguimiento");
  assert.equal(porId.get("crm:1")?.completable, true);
  assert.equal(porId.get("crm:1")?.contacto, "Marta");
  // Una tarea hecha es un trabajo realizado, y ya no se puede "completar".
  assert.equal(porId.get("crm:3")?.categoria, "trabajo");
  assert.equal(porId.get("crm:3")?.estado, "hecho");
  assert.equal(porId.get("crm:3")?.completable, false);
  assert.equal(porId.get("crm:4")?.categoria, "agenda");
});

test("un cobro con saldo cero no aparece; uno parcial muestra lo que falta", async () => {
  const admin = cliente({
    eos_erp_ventas: {
      data: [
        { id: "v1", vence_el: "2026-09-25", moneda: "PYG", total: 1000000, contacto: { nombre: "Saldada SA" } },
        { id: "v2", vence_el: "2026-09-26", moneda: "PYG", total: 1000000, contacto: { nombre: "Parcial SRL" } },
        { id: "v3", vence_el: "2026-09-27", moneda: "PYG", total: 500000, contacto: null },
      ],
      error: null,
    },
    eos_erp_cuenta_movimientos_v107: {
      data: [
        { venta_id: "v1", monto: 1000000 },
        { venta_id: "v2", monto: 400000 },
      ],
      error: null,
    },
  });

  const { eventos } = await armarAgenda(
    contexto({ supabase: cliente({}), admin, modulos: { crm: false, erp: true, finanzas: false } }),
  );

  const cobros = eventos.filter((e) => e.categoria === "cobro");

  assert.deepEqual(cobros.map((e) => e.id).sort(), ["erp-cobro:v2", "erp-cobro:v3"]);
  assert.equal(cobros.find((e) => e.id === "erp-cobro:v2")?.monto, 600000);
  assert.equal(cobros.find((e) => e.id === "erp-cobro:v3")?.monto, 500000);
});

test("si no se pueden leer los pagos registrados, no se muestran cobros que quizá ya se saldaron", async () => {
  const admin = cliente({
    eos_erp_ventas: {
      data: [{ id: "v1", vence_el: "2026-09-25", moneda: "PYG", total: 1000000, contacto: null }],
      error: null,
    },
    eos_erp_cuenta_movimientos_v107: { data: null, error: { message: "boom" } },
  });

  const { eventos, fuentes_caidas } = await armarAgenda(
    contexto({ supabase: cliente({}), admin, modulos: { crm: false, erp: true, finanzas: false } }),
  );

  assert.equal(eventos.filter((e) => e.categoria === "cobro").length, 0);
  assert.ok(fuentes_caidas.includes("los cobros y pagos registrados"));
});

test("en modo solo pendientes no se hacen las lecturas de lo ya hecho", async () => {
  const consultadas: string[] = [];

  await armarAgenda(
    contexto({
      supabase: cliente({}, consultadas),
      admin: cliente({}, consultadas),
      modulos: { crm: true, erp: true, finanzas: false },
      soloPendientes: true,
    }),
  );

  // `eos_erp_ventas` se lee UNA vez —los vencimientos por cobrar— y no una
  // segunda para "ventas hechas". Mirar dos meses hacia atrás en busca de
  // pendientes no debería traer además cada venta del período.
  assert.equal(consultadas.filter((t) => t === "eos_erp_ventas").length, 1);

  // Y las metas cumplidas y las oportunidades ganadas son lo ya hecho: no se
  // consultan. `eos_goals` queda en 2 (vencen, una por ámbito) en vez de 4.
  assert.equal(consultadas.filter((t) => t === "eos_goals").length, 2);
  assert.equal(consultadas.filter((t) => t === "eos_crm_oportunidades").length, 1);
});
