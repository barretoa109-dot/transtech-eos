import assert from "node:assert/strict";
import test from "node:test";

import { agendaPropia, armarAgenda, tareasSinFecha, type ContextoAgenda } from "./fuentes.ts";

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
      const metodos = ["select", "eq", "neq", "in", "not", "is", "or", "gte", "lte", "lt", "order", "limit"];
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

test("lo que la persona dijo por el chat aparece en el calendario sin cargar nada", async () => {
  // "Tengo que pagar los salarios el 25": el chat crea una tarea con fecha y el
  // calendario la muestra. Es el camino que evita la carga manual.
  const { eventos, fuentes_caidas } = await armarAgenda(
    contexto({
      supabase: cliente({
        eos_tasks: {
          data: [
            // La que guarda el ejecutor nuevo: 00:00 del 25 en Asunción.
            { id: "t1", titulo: "Pagar los salarios", descripcion: "Tengo que pagar los salarios el 25", estado: "pendiente", fecha_limite: "2026-09-25T03:00:00+00:00" },
            // Con hora, y la descripción repite el título.
            { id: "t2", titulo: "Reunión con el contador", descripcion: "reunión con el contador", estado: "pendiente", fecha_limite: "2026-09-22T13:00:00+00:00" },
            // Guardada antes de la v188, como medianoche UTC.
            { id: "t3", titulo: "Renovar el seguro", descripcion: null, estado: "completada", fecha_limite: "2026-09-23T00:00:00+00:00" },
            // Fuera del rango que se mira.
            { id: "t4", titulo: "De otro mes", descripcion: null, estado: "pendiente", fecha_limite: "2026-12-01T03:00:00+00:00" },
          ],
          error: null,
        },
      }),
    }),
  );

  assert.deepEqual(fuentes_caidas, []);

  const porId = new Map(eventos.map((e) => [e.id, e]));
  assert.equal(porId.has("tarea:t4"), false, "una tarea de otro mes no va en esta grilla");

  const salarios = porId.get("tarea:t1")!;
  assert.equal(salarios.fecha, "2026-09-25");
  assert.equal(salarios.hora, null);
  assert.equal(salarios.estado, "pendiente");
  assert.equal(salarios.categoria, "recordatorio");
  assert.equal(salarios.origen, "tareas");
  // Se puede completar, editar y borrar desde el calendario.
  assert.equal(salarios.completable, true);
  assert.equal(salarios.editable, true);
  // Lo que dijo la persona queda como detalle porque agrega algo al título.
  assert.equal(salarios.detalle, "Tengo que pagar los salarios el 25");

  const reunion = porId.get("tarea:t2")!;
  assert.equal(reunion.hora, "10:00");
  assert.equal(reunion.detalle, null, "la descripción que repite el título no se muestra");

  const seguro = porId.get("tarea:t3")!;
  assert.equal(seguro.fecha, "2026-09-23", "una tarea vieja no se corre un día");
  assert.equal(seguro.estado, "hecho");
});

test("si no se pueden leer las tareas, el calendario lo dice en vez de mostrarse vacío", async () => {
  const { fuentes_caidas } = await armarAgenda(
    contexto({ supabase: cliente({ eos_tasks: { data: null, error: { message: "boom" } } }) }),
  );

  assert.deepEqual(fuentes_caidas, ["tus tareas"]);
});

// ------------------------------------------------------------- lo que se repite

test("una serie mensual aparece en cada mes que se mira, con su ocurrencia hecha aparte", async () => {
  // "El 25 de cada mes": una sola fila, y septiembre ya se marcó como hecho.
  const { eventos } = await armarAgenda(
    contexto({
      hasta: "2026-12-31",
      supabase: cliente({
        eos_calendario_eventos: {
          data: [
            {
              id: "s1", titulo: "Pagar los salarios", detalle: null, categoria: "recordatorio",
              fecha: "2026-09-25", hora_inicio: null, hora_fin: null, estado: "pendiente", contacto_nombre: null,
              repite: "mensual", repite_hasta: null, repite_hechas: ["2026-09-25"],
            },
          ],
          error: null,
        },
      }),
    }),
  );

  const salarios = eventos.filter((e) => e.origen === "propio");
  assert.deepEqual(salarios.map((e) => e.fecha), ["2026-09-25", "2026-10-25", "2026-11-25", "2026-12-25"]);
  // Cada ocurrencia tiene su propio id: con el mismo, se pisarían en la grilla.
  assert.equal(new Set(salarios.map((e) => e.id)).size, 4);
  assert.equal(salarios[0].id, "propio:s1@2026-09-25");
  // Marcar septiembre como hecho no marca octubre.
  assert.deepEqual(salarios.map((e) => e.estado), ["hecho", "pendiente", "pendiente", "pendiente"]);
  // Cada una sabe de qué serie es y cuál es su día.
  assert.equal(salarios[1].repite, "mensual");
  assert.equal(salarios[1].ocurrencia, "2026-10-25");
  assert.equal(salarios[1].serie_desde, "2026-09-25");
});

test("una serie que empieza después del rango, o ya terminó, no aparece", async () => {
  const fila = (extra: Record<string, unknown>) => ({
    id: "s", titulo: "X", detalle: null, categoria: "actividad", hora_inicio: null, hora_fin: null,
    estado: "pendiente", contacto_nombre: null, repite: "semanal", repite_hasta: null, repite_hechas: [], ...extra,
  });

  const { eventos } = await armarAgenda(
    contexto({
      supabase: cliente({
        eos_calendario_eventos: {
          data: [
            fila({ id: "futura", fecha: "2027-03-01" }),
            fila({ id: "terminada", fecha: "2026-01-05", repite_hasta: "2026-06-30" }),
            fila({ id: "cancelada", fecha: "2026-09-01", estado: "cancelado" }),
          ],
          error: null,
        },
      }),
    }),
  );

  assert.deepEqual(eventos.filter((e) => e.origen === "propio"), []);
});

test("un evento de una sola vez fuera del rango no se cuela por la consulta de las series", async () => {
  // La consulta trae también lo que tiene regla; el resto se filtra por fecha.
  const { eventos } = await armarAgenda(
    contexto({
      supabase: cliente({
        eos_calendario_eventos: {
          data: [{ ...PROPIO, id: "lejano", fecha: "2027-05-01", repite: null, repite_hasta: null, repite_hechas: [] }],
          error: null,
        },
      }),
    }),
  );

  assert.equal(eventos.length, 0);
});

test("una tarea del chat que se repite ('el 25 de cada mes') se expande igual", async () => {
  const { eventos } = await armarAgenda(
    contexto({
      hasta: "2026-11-30",
      supabase: cliente({
        eos_tasks: {
          data: [
            {
              id: "t9", titulo: "Pagar salarios", descripcion: null, estado: "pendiente",
              // El 25 de septiembre, 00:00 en Asunción.
              fecha_limite: "2026-09-25T03:00:00+00:00",
              repite: "mensual", repite_hasta: null, repite_hechas: [],
            },
          ],
          error: null,
        },
      }),
    }),
  );

  const tareas = eventos.filter((e) => e.origen === "tareas");
  assert.deepEqual(tareas.map((e) => e.fecha), ["2026-09-25", "2026-10-25", "2026-11-25"]);
  assert.equal(tareas[2].id, "tarea:t9@2026-11-25");
  assert.ok(tareas.every((e) => e.hora === null && e.repite === "mensual"));
});

// -------------------------------------------------------------------- sin fecha

test("las tareas sin fecha se listan aparte, con su detalle solo si agrega algo", async () => {
  const lista = await tareasSinFecha({
    usuarioId: "u1",
    supabase: cliente({
      eos_tasks: {
        data: [
          { id: "a", titulo: "Llamar al proveedor", descripcion: "Llamar al proveedor", created_at: "2026-09-20T15:00:00+00:00" },
          { id: "b", titulo: "Revisar el contrato", descripcion: "Que incluya la cláusula de precio", created_at: "2026-09-19T12:00:00+00:00" },
        ],
        error: null,
      },
    }),
  });

  assert.deepEqual(lista, [
    { id: "tarea:a", titulo: "Llamar al proveedor", detalle: null, creada: "2026-09-20" },
    { id: "tarea:b", titulo: "Revisar el contrato", detalle: "Que incluya la cláusula de precio", creada: "2026-09-19" },
  ]);
});

test("si no se pueden leer las tareas sin fecha, se avisa y no se devuelve una lista vacía", async () => {
  await assert.rejects(
    tareasSinFecha({ usuarioId: "u1", supabase: cliente({ eos_tasks: { data: null, error: { message: "boom" } } }) }),
    /tus tareas sin fecha/,
  );
});

test("lo que lee el aviso de la mañana son solo las dos tablas propias, nunca los módulos", async () => {
  const consultadas: string[] = [];
  const supabase = cliente({}, consultadas);

  await agendaPropia(contexto({ supabase, modulos: { crm: true, erp: true, finanzas: true } }));

  assert.deepEqual([...new Set(consultadas)].sort(), ["eos_calendario_eventos", "eos_tasks"]);
});
