import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

import { aplicarJobs, aplicarPrompt, aplicarWorker } from "../../n8n/parches/cambios-agenda-repite.mjs";
import { normalizarDatos } from "./jobs.ts";

/**
 * "El 25 de cada mes" llega al Calendario como UNA tarea que se repite (v191).
 *
 * Como `chat-agenda-tareas.test.ts`: lee el prompt, el nodo 06 y las frases de los
 * workflows EXPORTADOS. Si el parche todavía no se aplicó a n8n, lo aplica sobre
 * una COPIA en memoria y prueba eso; después de aplicarlo, el mismo test protege lo
 * que quedó corriendo.
 */

type Nodo = { name: string; parameters: Record<string, string> };

const leer = (nombre: string) =>
  JSON.parse(readFileSync(new URL(`../../n8n/workflows/${nombre}`, import.meta.url), "utf8"));

const gateway = leer("eos-conversational-gateway-rc1.json");
const worker = leer("eos-background-worker-rc1.json");

const promptOriginal: string = gateway.nodes.find((n: Nodo) => n.name.startsWith("HTTP Request")).parameters.jsonBody;
const prompt = promptOriginal.includes("hora?, repite? }") ? promptOriginal : aplicarPrompt(promptOriginal, "copia");

const jobsOriginal: string = gateway.nodes.find((n: Nodo) => n.name === "06 GW Preparar Jobs Worker").parameters.jsCode;
const jobs = jobsOriginal.includes("'hora', 'repite'") ? jobsOriginal : aplicarJobs(jobsOriginal, "copia");

const codigoOriginal: string = worker.nodes.find((n: Nodo) => n.name === "05 INT Respuesta").parameters.jsCode;
const codigo = codigoOriginal.includes("const cadaCuanto") ? codigoOriginal : aplicarWorker(codigoOriginal, "copia");

// ------------------------------------------------------------------ el prompt

test("el prompt le enseña a repetir, con los cuatro valores y el caso de los salarios", () => {
  const seccion = prompt.slice(prompt.indexOf("CREAR_TAREA\n  datos"), prompt.indexOf("GUARDAR_MEMORIA\n  datos"));

  assert.match(seccion, /hora\?, repite\? \}/);
  for (const valor of ["mensual", "semanal", "diaria", "anual"]) assert.ok(seccion.includes(valor), valor);
  assert.match(seccion, /el 25 de cada mes/);
});

test("el prompt dice que una tarea que se repite es UNA, y que necesita el día en que empieza", () => {
  const seccion = prompt.slice(prompt.indexOf("CREAR_TAREA\n  datos"), prompt.indexOf("GUARDAR_MEMORIA\n  datos"));

  assert.match(seccion, /es UNA sola, no una por mes/);
  assert.match(seccion, /Necesita el día en que\n  empieza/);
});

test("el prompt no rompe el literal de plantilla donde vive", () => {
  const seccion = prompt.slice(prompt.indexOf("CREAR_TAREA\n  datos"), prompt.indexOf("GUARDAR_MEMORIA\n  datos"));
  assert.ok(!seccion.includes("`"), "comilla invertida");
  assert.ok(!seccion.includes("${"), "dólar-llave");
});

test("los parches son idempotentes, y exigen el de fechas por chat antes", () => {
  assert.throws(() => aplicarPrompt(prompt, "ya aplicado"), /ya conoce repite/);
  assert.throws(() => aplicarJobs(jobs, "ya aplicado"), /ya conoce repite/);
  assert.throws(() => aplicarWorker(codigo, "ya aplicado"), /ya conoce la repetición/);
  assert.throws(() => aplicarPrompt("un prompt sin fechas", "sin el anterior"), /falta el parche de fechas por chat/);
});

// ----------------------------------------------------- el nodo 06 y jobs.ts

test("el nodo 06 de n8n deja pasar repite, solo si vino con algo", () => {
  const bloque = jobs.slice(jobs.indexOf("if (tipo === 'CREAR_TAREA')"), jobs.indexOf("if (tipo === 'GUARDAR_MEMORIA')"));

  assert.ok(bloque.includes("'repite'"));
  assert.match(bloque, /if \(valor\) cuando\[campo\] = valor;/, "entraría vacío y cambiaría la huella exactly-once");
});

test("jobs.ts, el gemelo, también", () => {
  const conRegla = normalizarDatos("CREAR_TAREA", { titulo: "Pagar salarios", vence_dia: 25, repite: "mensual" });
  assert.equal(conRegla.repite, "mensual");
  assert.equal(conRegla.vence_dia, "25");

  // Sin decir que se repite, la huella es la de siempre.
  const sinRegla = normalizarDatos("CREAR_TAREA", { titulo: "Pagar salarios", vence_dia: 25 });
  assert.ok(!("repite" in sinRegla));
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

test("una tarea mensual lo dice: 'todos los meses, desde el 25 de septiembre'", () => {
  const t = f.fraseDeTarea({ resultado: { fecha_limite: `${anio}-09-25`, hora: null, repite: "mensual" } });

  assert.match(t, /lo anoté en tu Calendario todos los meses, desde el 25 de septiembre\./);
  assert.ok(!t.includes("para el 25"), "diría 'para el 25', que suena a una sola vez");
});

test("las cuatro repeticiones tienen su frase", () => {
  const frases = { diaria: "todos los días", semanal: "todas las semanas", mensual: "todos los meses", anual: "todos los años" };

  for (const [repite, esperado] of Object.entries(frases)) {
    const t = f.fraseDeTarea({ resultado: { fecha_limite: `${anio}-09-25`, repite } });
    assert.ok(t.includes(esperado), `${repite}: ${t}`);
  }
});

test("con hora y repetición dice las dos cosas", () => {
  const t = f.fraseDeTarea({ resultado: { fecha_limite: `${anio}-09-28`, hora: "09:00", repite: "semanal" } });
  assert.match(t, /todas las semanas, desde el 28 de septiembre a las 09:00\./);
});

test("sin repetición sigue diciendo 'para el 25', como antes", () => {
  const t = f.fraseDeTarea({ resultado: { fecha_limite: `${anio}-09-25` } });
  assert.match(t, /para el 25 de septiembre\./);
});

test("una repetición que no se reconoce no rompe la frase", () => {
  const t = f.fraseDeTarea({ resultado: { fecha_limite: `${anio}-09-25`, repite: "cada_tanto" } });
  assert.match(t, /para el 25 de septiembre\./);
});

// -------------------------------------------------------------- la migración

test("la migración v191 existe, es idempotente, exige la v189 y no trae begin/commit", () => {
  const ruta = new URL("../../supabase/migrations/20260922100000_eos_calendario_repite_avisa_v191.sql", import.meta.url);
  assert.ok(existsSync(ruta), "falta la migración");

  const sql = readFileSync(ruta, "utf8");
  assert.ok(!/^\s*(begin|commit);/im.test(sql), "begin/commit de nivel superior: db push ya envuelve el archivo");
  assert.match(sql, /position\('eos_repite_desde_datos_v191' in v_def\) > 0/, "sin salida idempotente");
  assert.match(sql, /falta la v189/, "no exige la v189");
  assert.match(sql, /raise exception 'v191: el ancla/, "sin corte si el ancla no está exactamente una vez");
  assert.match(sql, /revoke all on table public\.eos_agenda_avisos from public, anon, authenticated/, "el aviso queda abierto");
  assert.match(sql, /revoke all on function public\.eos_repite_desde_datos_v191/, "sin revoke a anon");
});
