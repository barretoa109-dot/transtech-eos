import test from "node:test";
import assert from "node:assert/strict";

import { renderBriefing, type BriefingFila } from "./email.ts";

/**
 * Tests del correo del briefing.
 *
 * Es lo único que EOS manda sin que se lo pidan, así que un error acá llega
 * directo a la bandeja de un cliente. Los dos casos centrales salieron de
 * renderizar con datos reales de la base: había títulos con restos de QA que
 * habrían salido como asunto, y un `enfoque_dia` con el valor "media".
 */

const base: BriefingFila = {
  briefing_date: "2026-08-21",
  saludo: "Buen día, Augusto.",
  titulo_dia: "Cerrar la validación RC1",
  resumen: "Tenés un objetivo activo con 0% de progreso.",
  enfoque_dia: "Definí el próximo paso concreto del objetivo activo y dejalo con responsable.",
  prioridad_1: "Aterrizá el objetivo en una acción concreta.",
  prioridad_2: null,
  prioridad_3: null,
  recomendacion_principal: "Elegí una sola prioridad y definí el resultado esperado.",
  proximos_pasos: [],
  riesgos: [],
  score: 60,
};

const opciones = { nombre: "Augusto", urlApp: "https://www.transtech.com.py/eos/chat" };

test("el asunto es estable y no depende del contenido generado", () => {
  const sano = renderBriefing(base, opciones);
  assert.equal(sano.asunto, "Tu briefing de hoy · 21 de agosto");

  // Estos valores existen de verdad en la base, como restos de pruebas de QA.
  for (const basura of ["EOS_RC1_QA_CREAR_TAREA_1786974099398", "hola", "media"]) {
    const r = renderBriefing({ ...base, titulo_dia: basura }, opciones);
    assert.equal(
      r.asunto,
      "Tu briefing de hoy · 21 de agosto",
      `un título con basura no puede salir como asunto: ${basura}`,
    );
  }
});

test("omite el enfoque cuando no es una frase", () => {
  for (const invalido of ["media", "hola", "EOS_RC1_QA_CREAR_TAREA_1786974099398"]) {
    const r = renderBriefing({ ...base, enfoque_dia: invalido }, opciones);
    assert.ok(
      !r.texto.includes("Enfoque de hoy"),
      `"Enfoque de hoy: ${invalido}" no significa nada para el usuario`,
    );
  }

  const valido = renderBriefing(base, opciones);
  assert.ok(valido.texto.includes("Enfoque de hoy"), "un enfoque real sí debe mostrarse");
});

test("cuando no hay nada que decidir, lo dice", () => {
  const tranquilo = renderBriefing(
    { ...base, prioridad_1: null, prioridad_2: null, prioridad_3: null, riesgos: [] },
    opciones,
  );

  // La doctrina: la interfaz reduce ansiedad. "No necesitás hacer nada" es el
  // producto, no un relleno.
  assert.ok(tranquilo.texto.includes("No necesitás hacer nada"));
});

test("cuando hay prioridades no dice que no hay nada que hacer", () => {
  const conTrabajo = renderBriefing(base, opciones);
  assert.ok(!conTrabajo.texto.includes("No necesitás hacer nada"));
  assert.ok(conTrabajo.texto.includes("Aterrizá el objetivo"));
});

test("escapa el HTML del contenido generado", () => {
  const r = renderBriefing(
    { ...base, titulo_dia: '<script>alert("x")</script>', resumen: "5 < 10 & 20 > 15" },
    opciones,
  );

  assert.ok(!r.html.includes("<script>"), "no puede inyectarse HTML desde el contenido");
  assert.ok(r.html.includes("&lt;script&gt;"));
  assert.ok(r.html.includes("5 &lt; 10 &amp; 20 &gt; 15"));
});

test("la fecha no se corre un día por la zona horaria", () => {
  // `new Date("2026-08-21")` es medianoche UTC: formateado en Paraguay daría 20.
  const r = renderBriefing({ ...base, briefing_date: "2026-08-21" }, opciones);
  assert.ok(r.asunto.includes("21 de agosto"));
});

test("normaliza los jsonb que vienen como objetos", () => {
  const r = renderBriefing(
    { ...base, riesgos: [{ titulo: "Objetivo estancado" }, "Sin próximos pasos"] },
    opciones,
  );

  assert.ok(r.texto.includes("Objetivo estancado"), "debe leer el campo del objeto");
  assert.ok(r.texto.includes("Sin próximos pasos"), "y también los strings sueltos");
  assert.ok(!r.texto.includes("[object Object]"));
});
