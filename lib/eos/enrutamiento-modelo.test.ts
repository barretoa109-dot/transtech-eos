import assert from "node:assert/strict";
import { test } from "node:test";

import { MODELO, MODELO_PRINCIPAL } from "../gateway/sistema.ts";
import {
  clasificarTurno,
  elegirModelo,
  modeloDelTurno,
  modeloSimple,
  pareceAccion,
  registroDeEnrutamiento,
  type TurnoParaClasificar,
} from "./enrutamiento-modelo.ts";

function turno(mensaje: string, extra: Partial<TurnoParaClasificar> = {}): TurnoParaClasificar {
  return { mensaje, adjuntos: 0, conCita: false, historial: [], ...extra };
}

const clase = (mensaje: string, extra: Partial<TurnoParaClasificar> = {}) =>
  clasificarTurno(turno(mensaje, extra)).clase;

test("saludos, agradecimientos y despedidas son simples", () => {
  for (const m of ["hola", "Buenas!", "buen día", "¡Muchas gracias!", "chau", "hola, ¿qué tal?"]) {
    assert.equal(clase(m), "simple", m);
  }
});

test("un acuse sin pregunta pendiente es simple", () => {
  assert.equal(clase("dale"), "simple");
  assert.equal(clase("ok"), "simple");
});

test("un 'sí' después de que EOS preguntó algo NO es simple: es el que ejecuta", () => {
  const historial = [
    { rol: "usuario" as const, texto: "vendí 3 panes a Ana" },
    { rol: "eos" as const, texto: "¿Registro la venta de 3 panes a Ana por Gs. 15.000?" },
  ];
  const r = clasificarTurno(turno("sí", { historial }));
  assert.deepEqual(r, { clase: "completo", motivo: "confirma_pendiente" });
  assert.equal(clase("dale", { historial }), "completo");
});

test("mira la ÚLTIMA respuesta de EOS, no una pregunta vieja", () => {
  const historial = [
    { rol: "eos" as const, texto: "¿Lo registro?" },
    { rol: "usuario" as const, texto: "sí" },
    { rol: "eos" as const, texto: "Listo, quedó registrado." },
  ];
  assert.equal(clase("genial", { historial }), "simple");
});

test("cualquier número manda al modelo completo", () => {
  assert.deepEqual(clasificarTurno(turno("3 panes")), { clase: "completo", motivo: "numeros" });
  assert.equal(clase("gracias, eran 50 mil"), "completo");
});

test("adjuntos y citas mandan al modelo completo", () => {
  assert.equal(clase("hola", { adjuntos: 1 }), "completo");
  assert.equal(clase("gracias", { conCita: true }), "completo");
});

test("vocabulario de negocio o de plata manda al modelo completo aunque sea corto", () => {
  for (const m of ["¿y el stock?", "mostrame el dashboard", "¿cómo vengo este mes?", "anotá: revisar la caja", "acordate de eso"]) {
    assert.equal(clase(m), "completo", m);
  }
});

test("lo desconocido y lo largo quedan en el modelo completo", () => {
  assert.equal(clase("contame un chiste"), "completo");
  assert.equal(clase("hola eos te quería preguntar algo sobre lo de ayer"), "completo");
  assert.equal(clase(""), "completo");
});

test("el registro marca cuando un turno simple igual pidió una acción", () => {
  const simple = clasificarTurno(turno("gracias"));
  assert.equal(registroDeEnrutamiento(simple, 0).simple_con_accion, false);
  assert.equal(registroDeEnrutamiento(simple, 1).simple_con_accion, true);
  const completo = clasificarTurno(turno("vendí 3 panes"));
  assert.equal(registroDeEnrutamiento(completo, 2).simple_con_accion, false);
});


test("pareceAccion: lo de plata o negocio va directo a n8n aunque sea largo", () => {
  const largo =
    "quiero que me ayudes a ver cómo llego a fin de mes porque no quiero que me quede tan justo este mes con todo lo que tengo";
  assert.equal(pareceAccion(turno(largo)), true);
  assert.equal(pareceAccion(turno("cargá la tarjeta green")), true);
  assert.equal(pareceAccion(turno("son 50 mil")), true);
  assert.equal(pareceAccion(turno("hola", { adjuntos: 1 })), true);
});

test("pareceAccion: la conversación pura sigue por el camino rápido", () => {
  assert.equal(pareceAccion(turno("hola")), false);
  assert.equal(pareceAccion(turno("contame un chiste")), false);
  assert.equal(pareceAccion(turno("gracias, sos un genio")), false);
});

test("pareceAccion: un sí con pregunta pendiente es acción", () => {
  const historial = [{ rol: "eos" as const, texto: "¿Registro la venta?" }];
  assert.equal(pareceAccion(turno("sí", { historial })), true);
  assert.equal(pareceAccion(turno("sí")), false);
});

// ---------------------------------------------------------------------------
// Paso 4: el interruptor
// ---------------------------------------------------------------------------

test("el modelo barato está apagado salvo con las dos variables", () => {
  assert.equal(modeloSimple({}), null);
  assert.equal(modeloSimple({ EOS_MODELO_SIMPLE: "barato" }), null, "sin EOS_ENRUTAR_MODELO no enruta");
  assert.equal(modeloSimple({ EOS_ENRUTAR_MODELO: "1" }), null, "sin modelo no hay a dónde enrutar");
  assert.equal(modeloSimple({ EOS_ENRUTAR_MODELO: "1", EOS_MODELO_SIMPLE: "  " }), null);
  assert.equal(modeloSimple({ EOS_ENRUTAR_MODELO: "0", EOS_MODELO_SIMPLE: "barato" }), null);
  assert.equal(modeloSimple({ EOS_ENRUTAR_MODELO: "1", EOS_MODELO_SIMPLE: " barato " }), "barato");
});

test("prendido, solo los turnos simples van al barato", () => {
  const env = { EOS_ENRUTAR_MODELO: "1", EOS_MODELO_SIMPLE: "barato" };
  assert.equal(modeloDelTurno(clasificarTurno(turno("hola")), env), "barato");
  assert.equal(modeloDelTurno(clasificarTurno(turno("vendí 3 panes a Ana")), env), null);
  // El "sí" que confirma una venta propuesta nunca va al barato.
  const confirma = clasificarTurno(
    turno("sí", { historial: [{ rol: "eos", texto: "¿Registro la venta de 3 panes?" }] }),
  );
  assert.equal(modeloDelTurno(confirma, env), null);
});

test("apagado, ningún turno va al barato", () => {
  assert.equal(modeloDelTurno(clasificarTurno(turno("hola")), {}), null);
});

// ------------------------------------------------------------------
// GPT 6 Sol para la mayoría, GPT 5.5 para lo complejo (01/10/2026)
// ------------------------------------------------------------------


const SIN_ENV = {};
const elegido = (mensaje: string, extra: Partial<TurnoParaClasificar> = {}) =>
  elegirModelo(turno(mensaje, extra), SIN_ENV);

test("lo de todos los días lo contesta el principal (gpt-6-sol)", () => {
  for (const m of [
    "vendí 3 bolsas de balanceado a 180 mil",
    "compré 20 bolsas de balanceado a 140 mil cada una a Agro Sur",
    "hola, buen día",
    "¿cuánto vendí esta semana?",
    "eran 3, no 30",
    "anulá la última",
  ]) {
    assert.deepEqual(elegido(m), { modelo: MODELO_PRINCIPAL, motivo: "principal" }, m);
  }
});

test("el caso Green (dos montos en un mensaje) va al completo", () => {
  assert.deepEqual(
    elegido("Gaste 46.000gs en Punto Farma con mi tarjeta de crédito Green que por cierto ya pagué el pago mínimo, y gané también 100.000gs recién"),
    { modelo: MODELO, motivo: "varias_operaciones" },
  );
  assert.equal(elegido("vendí 2 balanceados a 180 y compré 10 harinas a 45 mil").motivo, "varias_operaciones");
});

test("los reclamos van al completo", () => {
  for (const m of ["No está, no hiciste nada", "en donde se supone que lo anotaste? no está", "te equivocaste otra vez", "de donde sacaste eso?"]) {
    assert.equal(elegido(m).modelo, MODELO, m);
    assert.equal(elegido(m).motivo, "reclamo", m);
  }
});

test("fotos, documentos y mensajes largos van al completo", () => {
  assert.equal(elegido("esto", { adjuntos: 1 }).motivo, "adjunto");
  assert.equal(elegido("pasame en excel las ventas del mes").motivo, "documento");
  assert.equal(elegido("a".repeat(281)).motivo, "largo");
});

test("donde Sol preguntaba en vez de actuar, va al completo", () => {
  assert.equal(elegido("mandale a Juan un mensaje que ya llegó su pedido").motivo, "whatsapp");
  assert.equal(elegido("le pagué a Agro Sur lo del balanceado").motivo, "cartera");
  assert.equal(elegido("osẽ 10 varilla ko'ẽme").motivo, "jopara");
});

test("un teléfono no son varios montos", () => {
  assert.equal(elegido("agendá a Nati, 0985 444 000").motivo, "agenda");
  assert.equal(elegido("el número de Pedro es +595 981 123456").motivo, "principal");
});

test("EOS_MODELO_PRINCIPAL=gpt-5.5 devuelve todo al completo; otro nombre lo reemplaza", () => {
  assert.deepEqual(elegirModelo(turno("vendí 3 panes"), { EOS_MODELO_PRINCIPAL: MODELO }), { modelo: MODELO, motivo: "unico" });
  assert.deepEqual(elegirModelo(turno("vendí 3 panes"), { EOS_MODELO_PRINCIPAL: "otro" }), { modelo: "otro", motivo: "principal" });
  assert.equal(elegirModelo(turno("No está, no hiciste nada"), { EOS_MODELO_PRINCIPAL: "otro" }).modelo, MODELO);
});
