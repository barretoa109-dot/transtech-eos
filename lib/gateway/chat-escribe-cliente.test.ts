import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  aplicar01Int,
  aplicar05Gw,
  aplicar06Gw,
  aplicarPrompt,
  aplicarWorker,
} from "../../n8n/parches/cambios-chat-escribe-cliente.mjs";
import { verificarFlujo } from "../../n8n/parches/verificar.mjs";
import { fraseDelEnvio, type EnvioDeChat } from "../whatsapp-crm/envio-por-chat.ts";
import { ACCIONES_INTERNAS } from "./ejecutar.ts";
import { ACCIONES_CON_RIESGO } from "../autonomia/riesgo.ts";

/**
 * El chat le escribe a un cliente (v186).
 *
 * Toma los workflows EXPORTADOS —lo que corre— y, si el parche todavía no se aplicó a n8n, lo
 * aplica sobre una COPIA en memoria y prueba eso: se valida antes de tocar producción, y
 * después de aplicarlo el mismo test sigue protegiendo lo que quedó corriendo.
 */

const VERBO = "ENVIAR_WHATSAPP_CLIENTE";

type Nodo = { name: string; parameters: { jsCode?: string; jsonBody?: string } };
type Flujo = { nodes: Nodo[] };

const leer = (nombre: string): Flujo => JSON.parse(readFileSync(new URL(`../../n8n/workflows/${nombre}`, import.meta.url), "utf8"));

const gateway = leer("eos-conversational-gateway-rc1.json");
const worker = leer("eos-background-worker-rc1.json");

const nodo = (f: Flujo, prefijo: string) => {
  const n = f.nodes.find((x) => x.name === prefijo || x.name.startsWith(prefijo));
  assert.ok(n, prefijo);
  return n;
};

// Sobre una copia: si el flujo exportado ya trae el verbo, se usa tal cual.
function parchado(f: Flujo, prefijo: string, campo: "jsCode" | "jsonBody", aplicar: (t: string) => string): string {
  const original = nodo(f, prefijo).parameters[campo]!;
  return original.includes(VERBO) ? original : aplicar(original);
}

const prompt = parchado(gateway, "HTTP Request", "jsonBody", (t) => aplicarPrompt(t, "copia"));
const gw05 = parchado(gateway, "05 GW", "jsCode", (t) => aplicar05Gw(t));
const gw06 = parchado(gateway, "06 GW", "jsCode", (t) => aplicar06Gw(t));
const w01 = parchado(worker, "01 INT", "jsCode", (t) => aplicar01Int(t));
const w05 = parchado(worker, "05 INT Respuesta", "jsCode", (t) => aplicarWorker(t, "copia"));

// ------------------------------------------------------------------ los lugares

test("el verbo está en los cinco lugares de n8n", () => {
  for (const [lugar, texto] of Object.entries({ prompt, gw05, gw06, w01, w05 })) {
    assert.ok(texto.includes(VERBO), lugar);
  }
});

test("los nodos parchados compilan (lo que comprueba verificarFlujo antes de escribir)", () => {
  const g = structuredClone(gateway);
  nodo(g, "05 GW").parameters.jsCode = gw05;
  nodo(g, "06 GW").parameters.jsCode = gw06;
  nodo(g, "HTTP Request").parameters.jsonBody = prompt;

  const w = structuredClone(worker);
  nodo(w, "01 INT").parameters.jsCode = w01;
  nodo(w, "05 INT Respuesta").parameters.jsCode = w05;

  assert.ok(verificarFlujo(g, "gateway") > 0);
  assert.ok(verificarFlujo(w, "worker") > 0);
});

test("el verbo está también del lado del código de Vercel: riesgo, ejecutor y ruta", () => {
  assert.ok(ACCIONES_CON_RIESGO.has(VERBO));
  assert.ok(ACCIONES_INTERNAS.has(VERBO));
  assert.match(gw06, /ENVIAR_WHATSAPP_CLIENTE: 'eos-worker-rc1-internal'/);
});

// ------------------------------------------------------------------ el prompt

test("el prompt condiciona el envío a una confirmación y a un texto que la persona vio", () => {
  const bloque = prompt.slice(prompt.indexOf("ENVIAR_WHATSAPP_CLIENTE\n  datos"), prompt.indexOf("GUARDAR_MEMORIA\n  datos"));

  assert.match(bloque, /datos: \{ cliente, mensaje \}/);
  assert.match(bloque, /UN MENSAJE ENVIADO NO SE DESHACE/);
  assert.match(bloque, /Mandalo SOLO si la persona confirmó/);
  assert.match(bloque, /NO mandes la acción: proponé/);
  assert.match(bloque, /NO inventes precios, fechas, descuentos ni promesas/);
  assert.match(bloque, /NUNCA digas que se\n {2}envió si no lo confirmó/);
});

test("el prompt no rompe el literal de plantilla donde vive (sin comillas invertidas)", () => {
  const bloque = prompt.slice(prompt.indexOf("ENVIAR_WHATSAPP_CLIENTE\n  datos"), prompt.indexOf("GUARDAR_MEMORIA\n  datos"));
  assert.ok(!bloque.includes("`"));
});

test("los parches son idempotentes: no se aplican dos veces", () => {
  assert.throws(() => aplicarPrompt(prompt, "ya"), /ya conoce ENVIAR_WHATSAPP_CLIENTE/);
  assert.throws(() => aplicar05Gw(gw05), /ya conoce/);
  assert.throws(() => aplicar06Gw(gw06), /ya conoce/);
  assert.throws(() => aplicar01Int(w01), /ya conoce/);
  assert.throws(() => aplicarWorker(w05), /ya conoce/);
});

// ------------------------------------------------------------------ las frases

type Despacho = (accion: string, result: unknown) => string | null;

function cargar(): Despacho {
  const fin = w05.indexOf("const prep = $('03 INT Preparar Efecto')");
  assert.ok(fin > 0, "no se encontró dónde termina el bloque de funciones");
  return new Function("plata", "signoDe", `${w05.slice(0, fin)}\nreturn fraseDeAccion;`)((n: number) => String(n), () => "₲ ") as Despacho;
}

const frase = cargar();
const resultadoDe = (envio: unknown, nombre = "Marcos") => ({ resultado: { contacto_nombre: nombre, envio } });

test("el despacho del worker conoce el verbo", () => {
  assert.equal(frase(VERBO, resultadoDe({ estado: "enviado" })), "Listo, le escribí a Marcos por WhatsApp.");
});

test("la frase del worker y la de Vercel dicen EXACTAMENTE lo mismo, en todos los estados", () => {
  const casos: (EnvioDeChat | null)[] = [
    { estado: "enviado" },
    { estado: "ya_enviado" },
    { estado: "bloqueado", motivo: "Pasaron más de 24 horas desde que el cliente escribió" },
    { estado: "bloqueado" },
    { estado: "pendiente_aprobacion", motivo: "Falta la aprobación." },
    { estado: "fallido", motivo: "Meta no respondió", reintentable: true },
    { estado: "fallido", motivo: "El token venció." },
    { estado: "fallido" },
    { estado: "invalido", motivo: "No encontré a ese cliente" },
    { estado: "pendiente", motivo: "No pude confirmar que el mensaje saliera." },
    null,
  ];

  for (const envio of casos) {
    assert.equal(frase(VERBO, resultadoDe(envio)), fraseDelEnvio("Marcos", envio), JSON.stringify(envio));
  }
  // Sin nombre.
  assert.equal(frase(VERBO, resultadoDe({ estado: "enviado" }, "")), fraseDelEnvio("", { estado: "enviado" }));
});

test("NUNCA dice que le escribió si el mensaje no salió", () => {
  for (const estado of ["bloqueado", "pendiente_aprobacion", "fallido", "invalido", "pendiente"]) {
    assert.ok(!/^Listo/.test(frase(VERBO, resultadoDe({ estado, motivo: "x" })) ?? ""), estado);
  }
  assert.ok(!/Listo/.test(frase(VERBO, { resultado: {} }) ?? ""));
});
