import assert from "node:assert/strict";
import test from "node:test";

import {
  agendaAInstante,
  agruparPorDia,
  compararEventos,
  diasDeGrilla,
  esFechaValida,
  estaAtrasado,
  instanteAAgenda,
  moverMes,
  normalizarHora,
  resumir,
  validarEventoPropio,
  type EventoAgenda,
} from "./agenda.ts";

function evento(parcial: Partial<EventoAgenda> & { id: string; fecha: string }): EventoAgenda {
  return {
    origen: "propio",
    categoria: "actividad",
    titulo: parcial.id,
    detalle: null,
    hora: null,
    hora_fin: null,
    estado: "pendiente",
    contacto: null,
    monto: null,
    moneda: null,
    editable: true,
    completable: true,
    repite: null,
    ocurrencia: null,
    serie_desde: null,
    serie_hasta: null,
    ...parcial,
  };
}

test("la grilla siempre tiene 42 días, arranca en lunes y contiene todo el mes", () => {
  for (const [anio, mes] of [
    [2026, 2],
    [2026, 9],
    [2027, 5],
    [2028, 2],
  ] as const) {
    const dias = diasDeGrilla(anio, mes);
    assert.equal(dias.length, 42);
    assert.equal(new Date(`${dias[0]}T00:00:00Z`).getUTCDay(), 1, `${anio}-${mes} no arranca en lunes`);

    const prefijo = `${anio}-${String(mes).padStart(2, "0")}-`;
    const delMes = dias.filter((d) => d.startsWith(prefijo));
    const esperados = new Date(Date.UTC(anio, mes, 0)).getUTCDate();
    assert.equal(delMes.length, esperados);
  }
});

test("la grilla de septiembre 2026 arranca el lunes 31 de agosto", () => {
  const dias = diasDeGrilla(2026, 9);
  assert.equal(dias[0], "2026-08-31");
  assert.equal(dias[41], "2026-10-11");
});

test("moverMes cruza el año en las dos direcciones", () => {
  assert.deepEqual(moverMes(2026, 12, 1), { anio: 2027, mes: 1 });
  assert.deepEqual(moverMes(2026, 1, -1), { anio: 2025, mes: 12 });
  assert.deepEqual(moverMes(2026, 9, 0), { anio: 2026, mes: 9 });
});

test("esFechaValida rechaza los días que no existen", () => {
  assert.equal(esFechaValida("2026-09-20"), true);
  assert.equal(esFechaValida("2028-02-29"), true);
  assert.equal(esFechaValida("2026-02-29"), false);
  assert.equal(esFechaValida("2026-13-01"), false);
  assert.equal(esFechaValida("20/09/2026"), false);
  assert.equal(esFechaValida(null), false);
});

test("normalizarHora acepta lo que devuelve Postgres y rechaza lo demás", () => {
  assert.equal(normalizarHora("09:30:00"), "09:30");
  assert.equal(normalizarHora("23:59"), "23:59");
  assert.equal(normalizarHora("24:00"), null);
  assert.equal(normalizarHora("9:30"), null);
  assert.equal(normalizarHora(undefined), null);
});

test("dentro de un día: todo el día primero, después por hora", () => {
  const dia = "2026-09-20";
  const lista = agruparPorDia([
    evento({ id: "tarde", fecha: dia, hora: "16:00" }),
    evento({ id: "manana", fecha: dia, hora: "08:00" }),
    evento({ id: "todo", fecha: dia, hora: null }),
  ]).get(dia)!;

  assert.deepEqual(lista.map((e) => e.id), ["todo", "manana", "tarde"]);
});

test("a igual hora, la agenda va antes que el trabajo realizado", () => {
  const a = evento({ id: "a", fecha: "2026-09-20", categoria: "trabajo", estado: "hecho" });
  const b = evento({ id: "b", fecha: "2026-09-20", categoria: "agenda" });
  assert.ok(compararEventos(b, a) < 0);
});

test("un evento de hoy no está atrasado aunque su hora ya haya pasado", () => {
  const hoy = "2026-09-20";
  assert.equal(estaAtrasado({ estado: "pendiente", fecha: "2026-09-19" }, hoy), true);
  assert.equal(estaAtrasado({ estado: "pendiente", fecha: hoy }, hoy), false);
  assert.equal(estaAtrasado({ estado: "hecho", fecha: "2026-09-01" }, hoy), false);
  assert.equal(estaAtrasado({ estado: "cancelado", fecha: "2026-09-01" }, hoy), false);
});

test("el resumen cuenta solo pendientes y no repite hoy en los próximos 7 días", () => {
  const hoy = "2026-09-20";
  const resumen = resumir(
    [
      evento({ id: "viejo", fecha: "2026-09-10" }),
      evento({ id: "hoy1", fecha: hoy }),
      evento({ id: "hoy2", fecha: hoy }),
      evento({ id: "manana", fecha: "2026-09-21" }),
      evento({ id: "dia7", fecha: "2026-09-27" }),
      evento({ id: "dia8", fecha: "2026-09-28" }),
      evento({ id: "hecho", fecha: "2026-09-10", estado: "hecho" }),
      evento({ id: "cancelado", fecha: hoy, estado: "cancelado" }),
    ],
    hoy,
  );

  assert.deepEqual(resumen, { atrasados: 1, hoy: 2, proximos7: 2 });
});

test("el resumen no cuenta dos veces un evento que llega por dos listas", () => {
  const hoy = "2026-09-20";
  const e = evento({ id: "repetido", fecha: "2026-09-01" });
  assert.equal(resumir([e, e], hoy).atrasados, 1);
});

test("validarEventoPropio limpia y acepta un evento completo", () => {
  const r = validarEventoPropio({
    titulo: "  Reunión con Marta  ",
    categoria: "agenda",
    fecha: "2026-09-22",
    hora_inicio: "10:00",
    hora_fin: "11:00",
    contacto_nombre: "Marta",
  });

  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.datos.titulo, "Reunión con Marta");
    assert.equal(r.datos.categoria, "agenda");
    assert.equal(r.datos.detalle, null);
  }
});

test("validarEventoPropio dice qué corregir", () => {
  const base = { titulo: "x", fecha: "2026-09-22" };

  const casos: [Record<string, unknown>, RegExp][] = [
    [{ ...base, titulo: "   " }, /título/],
    [{ ...base, fecha: "2026-02-30" }, /fecha/],
    [{ ...base, hora_inicio: "25:00" }, /inicio/],
    [{ ...base, hora_fin: "11:00" }, /inicio/],
    [{ ...base, hora_inicio: "11:00", hora_fin: "10:00" }, /anterior/],
  ];

  for (const [cuerpo, esperado] of casos) {
    const r = validarEventoPropio(cuerpo);
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, esperado);
  }
});

test("una categoría desconocida cae en actividad y no pasa a la base", () => {
  // `cobro` existe en el calendario pero NO se puede crear a mano: viene de la
  // cartera. Si pasara, el CHECK de la tabla rechazaría el insert con un 500.
  const r = validarEventoPropio({ titulo: "x", fecha: "2026-09-22", categoria: "cobro" });
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.datos.categoria, "actividad");
});

test("una tarea que el chat guardó para 'el 25' se lee como el 25, con o sin hora", () => {
  // El ejecutor guarda la hora de Paraguay: 00:00 del 25 en Asunción = 03:00 UTC.
  assert.deepEqual(instanteAAgenda("2026-09-25T03:00:00+00:00"), { fecha: "2026-09-25", hora: null });
  // A las 10:30 del 25 en Asunción.
  assert.deepEqual(instanteAAgenda("2026-09-25T13:30:00+00:00"), { fecha: "2026-09-25", hora: "10:30" });
  // Cerca de la medianoche: las 23:30 del 24 en Asunción ya son el 25 en UTC.
  assert.deepEqual(instanteAAgenda("2026-09-25T02:30:00+00:00"), { fecha: "2026-09-24", hora: "23:30" });
});

test("una tarea vieja guardada como medianoche UTC sigue siendo el día que se pidió", () => {
  // Antes de la v188 "2026-09-25" entraba como 00:00 UTC, que en Asunción es el 24
  // a las 21:00. Leerla con la zona de Paraguay mostraría el 24.
  assert.deepEqual(instanteAAgenda("2026-09-25T00:00:00+00:00"), { fecha: "2026-09-25", hora: null });
});

test("instanteAAgenda rechaza lo que no es una fecha", () => {
  assert.equal(instanteAAgenda(null), null);
  assert.equal(instanteAAgenda("mañana"), null);
});

test("agendaAInstante y instanteAAgenda son inversas", () => {
  for (const [fecha, hora] of [
    ["2026-09-25", null],
    ["2026-09-25", "10:30"],
    ["2026-12-31", "23:59"],
  ] as const) {
    assert.deepEqual(instanteAAgenda(agendaAInstante(fecha, hora)), { fecha, hora });
  }
});

test("la repetición se valida: solo las cuatro que la base acepta", () => {
  const base = { titulo: "Pagar los salarios", fecha: "2026-09-25" };

  const ok = validarEventoPropio({ ...base, repite: "mensual", repite_hasta: "2027-09-25" });
  assert.equal(ok.ok, true);
  if (ok.ok) {
    assert.equal(ok.datos.repite, "mensual");
    assert.equal(ok.datos.repite_hasta, "2027-09-25");
  }

  const invalida = validarEventoPropio({ ...base, repite: "cada_mes" });
  assert.equal(invalida.ok, false);
  if (!invalida.ok) assert.match(invalida.error, /repetición/);
});

test("'No se repite' llega como vacío y no guarda ni un fin suelto", () => {
  const r = validarEventoPropio({ titulo: "x", fecha: "2026-09-25", repite: "", repite_hasta: "2027-01-01" });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.datos.repite, null);
    // Un fin sin regla no significa nada: se descarta en vez de guardarlo.
    assert.equal(r.datos.repite_hasta, null);
  }
});

test("una repetición no puede terminar antes de empezar, ni con una fecha que no existe", () => {
  const antes = validarEventoPropio({ titulo: "x", fecha: "2026-09-25", repite: "mensual", repite_hasta: "2026-09-01" });
  assert.equal(antes.ok, false);

  const imposible = validarEventoPropio({ titulo: "x", fecha: "2026-09-25", repite: "mensual", repite_hasta: "2027-02-30" });
  assert.equal(imposible.ok, false);
});
