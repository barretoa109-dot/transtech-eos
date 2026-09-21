import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

import { aplicarJobs, aplicarPrompt, aplicarWorker } from "../../n8n/parches/cambios-agenda-por-chat.mjs";
import { normalizarDatos } from "./jobs.ts";

/**
 * "Tengo que pagar los salarios el 25" llega solo al Calendario (v189).
 *
 * Como `chat-vence-el.test.ts`: toma el prompt, el nodo 06 y las frases de los
 * workflows EXPORTADOS —lo que corre—. Si el parche todavía no se aplicó a n8n, lo
 * aplica sobre una COPIA en memoria y prueba eso: se valida antes de tocar
 * producción, y después de aplicarlo el mismo test sigue protegiendo lo que
 * quedó corriendo.
 *
 * ============================================================
 * LA CADENA, ESLABÓN POR ESLABÓN
 * ============================================================
 *
 * La fecha tiene que sobrevivir cinco saltos, y cada uno la puede perder sin
 * ruido: el prompt (si no enseña la forma, el modelo no la manda), el nodo 06 (una
 * lista explícita que descarta lo que no nombra), el ejecutor de la base, la frase
 * de la respuesta y la lectura del calendario. Acá se prueban los que viven en el
 * repositorio; los de la base los prueba la migración contra producción.
 */

type Nodo = { name: string; parameters: Record<string, string> };

const leer = (nombre: string) =>
  JSON.parse(readFileSync(new URL(`../../n8n/workflows/${nombre}`, import.meta.url), "utf8"));

const gateway = leer("eos-conversational-gateway-rc1.json");
const worker = leer("eos-background-worker-rc1.json");

const promptOriginal: string = gateway.nodes.find((n: Nodo) => n.name.startsWith("HTTP Request")).parameters.jsonBody;
const prompt = promptOriginal.includes("vence_semana") ? promptOriginal : aplicarPrompt(promptOriginal, "copia");

const jobsOriginal: string = gateway.nodes.find((n: Nodo) => n.name === "06 GW Preparar Jobs Worker").parameters.jsCode;
const jobs = jobsOriginal.includes("vence_semana") ? jobsOriginal : aplicarJobs(jobsOriginal, "copia");

const codigoOriginal: string = worker.nodes.find((n: Nodo) => n.name === "05 INT Respuesta").parameters.jsCode;
const codigo = codigoOriginal.includes("function fraseDeTarea") ? codigoOriginal : aplicarWorker(codigoOriginal, "copia");

// ------------------------------------------------------------------ el prompt

test("el prompt enseña la forma de los datos de CREAR_TAREA, con los campos de fecha", () => {
  const seccion = prompt.slice(prompt.indexOf("CREAR_TAREA\n  datos"), prompt.indexOf("GUARDAR_MEMORIA\n  datos"));

  assert.ok(seccion.length > 200, "no hay una sección de CREAR_TAREA con su forma de datos");
  for (const campo of ["vence_dia", "vence_en_dias", "vence_semana", "vence_el", "hora"]) {
    assert.ok(seccion.includes(campo), campo);
  }
  assert.match(seccion, /Calendario/);
});

test("el prompt usa el caso de los salarios y no le pide al modelo que calcule la fecha", () => {
  const seccion = prompt.slice(prompt.indexOf("CREAR_TAREA\n  datos"), prompt.indexOf("GUARDAR_MEMORIA\n  datos"));

  assert.match(seccion, /tengo que pagar los\n  salarios el 25/);
  assert.match(seccion, /no hagas la cuenta vos/);
  assert.match(seccion, /SOLO si dicen la fecha completa con el año/);
});

test("el prompt separa lo que va a pasar de lo que ya pasó: 'tengo que pagar' no es un gasto", () => {
  assert.match(prompt, /TODAVÍA NO pasó no es un gasto ni una venta/);
});

test("GUARDAR_MEMORIA ya no tapa una obligación con fecha", () => {
  const memoria = prompt.slice(prompt.indexOf("GUARDAR_MEMORIA\n  datos"), prompt.indexOf("CREAR_OBJETIVO\n  datos"));
  assert.match(memoria, /algo que hay\n  que hacer o pagar en una fecha/);
  assert.match(memoria, /en\n  CREAR_TAREA/);
});

test("el prompt no rompe el literal de plantilla donde vive", () => {
  const seccion = prompt.slice(prompt.indexOf("CREAR_TAREA\n  datos"), prompt.indexOf("GUARDAR_MEMORIA\n  datos"));
  assert.ok(!seccion.includes("`"), "comilla invertida");
  assert.ok(!seccion.includes("${"), "dólar-llave");
});

test("los parches son idempotentes", () => {
  assert.throws(() => aplicarPrompt(prompt, "ya aplicado"), /ya conoce vence_semana/);
  assert.throws(() => aplicarJobs(jobs, "ya aplicado"), /ya conoce vence_semana/);
  assert.throws(() => aplicarWorker(codigo, "ya aplicado"), /ya existe fraseDeTarea/);
});

// ------------------------------------------------------- el nodo 06 y jobs.ts

test("el nodo 06 de n8n deja pasar los campos de fecha de CREAR_TAREA", () => {
  const bloque = jobs.slice(jobs.indexOf("if (tipo === 'CREAR_TAREA')"), jobs.indexOf("if (tipo === 'GUARDAR_MEMORIA')"));

  for (const campo of ["vence_dia", "vence_en_dias", "vence_semana", "vence_el", "hora"]) {
    assert.ok(bloque.includes(`'${campo}'`), campo);
  }
  assert.match(bloque, /\.\.\.cuando/, "los campos recogidos no se suman al resultado");
});

test("jobs.ts, el gemelo en TypeScript, deja pasar los mismos campos", () => {
  const datos = normalizarDatos("CREAR_TAREA", {
    titulo: "Pagar los salarios",
    descripcion: "Tengo que pagar los salarios el 25",
    vence_dia: 25,
    hora: "10:00",
  });

  assert.equal(datos.titulo, "Pagar los salarios");
  assert.equal(datos.vence_dia, "25", "el número que manda el modelo se conserva como texto");
  assert.equal(datos.hora, "10:00");
  // Lo que no dijo, no se inventa: ni siquiera como cadena vacía.
  for (const campo of ["vence_en_dias", "vence_semana", "vence_el"]) {
    assert.ok(!(campo in datos), `${campo} apareció sin que la persona lo dijera`);
  }
});

test("una tarea sin fecha da EXACTAMENTE la misma huella que antes de la v189", () => {
  // La huella es lo que evita que un reintento cree la tarea dos veces. Si los
  // campos nuevos entraran siempre —aunque vacíos— cambiaría la huella de todas
  // las tareas ya emitidas. Los evals guardan este mismo contrato.
  assert.deepEqual(Object.keys(normalizarDatos("CREAR_TAREA", { titulo: "Llamar a Ana" })).sort(), [
    "descripcion",
    "fecha_limite",
    "prioridad",
    "titulo",
  ]);
});

// ------------------------------------------------------------------ la frase

type Frases = { fraseDeTarea: (r: unknown) => string };

function cargar(): Frases {
  const fin = codigo.indexOf("const prep = $('03 INT Preparar Efecto')");
  const cuerpo = codigo.slice(0, fin);
  const plata = (n: number) => String(n);
  const signoDe = () => "₲ ";
  return new Function("plata", "signoDe", `${cuerpo}\nreturn { fraseDeTarea };`)(plata, signoDe) as Frases;
}

const f = cargar();
const anio = new Date(Date.now() - 3 * 3600000).getUTCFullYear();

test("con fecha, dice el día que QUEDÓ y dónde verlo", () => {
  const t = f.fraseDeTarea({ resultado: { fecha_limite: `${anio}-09-25`, hora: null } });

  assert.match(t, /lo anoté en tu Calendario para el 25 de septiembre\./);
  assert.match(t, /lo podés cambiar o marcar como hecho/);
  assert.ok(!t.includes(" a las "), "no inventa una hora");
});

test("con hora, la dice", () => {
  const t = f.fraseDeTarea({ resultado: { fecha_limite: `${anio}-09-22`, hora: "10:30" } });
  assert.match(t, /para el 22 de septiembre a las 10:30\./);
});

test("sin fecha lo dice: no aparece en el Calendario", () => {
  // Callarlo dejaría a la persona esperando un aviso que no va a llegar.
  for (const r of [{ resultado: {} }, { resultado: { fecha_limite: null } }, {}, null]) {
    const t = f.fraseDeTarea(r);
    assert.match(t, /sin fecha, así que no aparece en el Calendario/);
  }
});

test("el worker elige fraseDeTarea para CREAR_TAREA", () => {
  assert.match(codigo, /if \(accion === 'CREAR_TAREA'\) return fraseDeTarea\(result\);/);
});

// -------------------------------------------------------------- la migración

test("la migración v189 existe, es idempotente y no trae begin/commit", () => {
  const ruta = new URL("../../supabase/migrations/20260921100000_eos_chat_agenda_tareas_v189.sql", import.meta.url);
  assert.ok(existsSync(ruta), "falta la migración");

  const sql = readFileSync(ruta, "utf8");
  assert.ok(!/^\s*(begin|commit);/im.test(sql), "begin/commit de nivel superior: db push ya envuelve el archivo");
  assert.match(sql, /position\('eos_tarea_fecha_desde_datos_v189' in v_def\) > 0/, "sin salida idempotente");
  assert.match(sql, /raise exception 'v189: el ancla/, "sin corte si un ancla no está exactamente una vez");
  assert.match(sql, /revoke all on function public\.eos_tarea_fecha_desde_datos_v189/, "sin revoke a anon");
});
