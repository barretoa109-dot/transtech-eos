import assert from "node:assert/strict";
import test from "node:test";

import { normalizarTelefono, mismoTelefono } from "./telefono.ts";
import { detectarBaja } from "./baja.ts";
import { clasificarIntencion, accionSugerida } from "./intencion.ts";
import { evaluarEnvio, horaEnParaguay, type EntradaPolitica } from "./politica.ts";

// ============================================================
// Teléfonos
// ============================================================

test("el mismo cliente escrito de cuatro maneras da el mismo número", () => {
  const formas = ["0981 123 456", "+595 981 123456", "595981123456", "981123456", "00595981123456", "(0981) 123-456"];
  for (const f of formas) assert.equal(normalizarTelefono(f), "595981123456", f);
});

test("un número con otro código de país se respeta y no se le pega el 595", () => {
  assert.equal(normalizarTelefono("+54 9 11 2345 6789"), "5491123456789");
  assert.equal(normalizarTelefono("+1 415 555 2671"), "14155552671");
});

test("lo que no es un teléfono devuelve null, no un número inventado", () => {
  for (const x of [null, undefined, "", "sin teléfono", "12", "1".repeat(16)]) {
    assert.equal(normalizarTelefono(x as string | null | undefined), null);
  }
});

test("dos null no son el mismo teléfono", () => {
  assert.equal(mismoTelefono(null, null), false);
  assert.equal(mismoTelefono("abc", "def"), false);
  assert.equal(mismoTelefono("0981123456", "+595981123456"), true);
  assert.equal(mismoTelefono("0981123456", "0982123456"), false);
});

// ============================================================
// Baja
// ============================================================

test("los pedidos explícitos de parar son baja", () => {
  for (const t of [
    "STOP",
    "stop.",
    "Baja",
    "BAJA por favor",
    "no me escriban más",
    "Por favor no me manden más mensajes",
    "sáquenme de la lista",
    "quiero darme de baja",
    "dejen de escribirme",
    "no quiero recibir mensajes",
    "No me molesten",
  ]) {
    assert.equal(detectarBaja(t), true, t);
  }
});

test("un 'no' comercial NO es una baja: el cliente sigue siendo cliente", () => {
  for (const t of [
    "no",
    "no gracias",
    "no me interesa esa marca",
    "ahora no puedo, escribime mañana",
    "hola, necesito baja tensión para el local", // 'baja' dentro de otra frase
    "cuánto cuesta el plan básico",
    "",
  ]) {
    assert.equal(detectarBaja(t), false, t);
  }
});

test("null y undefined no rompen", () => {
  assert.equal(detectarBaja(null), false);
  assert.equal(detectarBaja(undefined), false);
});

// ============================================================
// Intención
// ============================================================

test("el ejemplo del pedido: consulta de precio → oportunidad", () => {
  const i = clasificarIntencion("Estoy interesado en el plan empresarial, ¿cuánto cuesta?");
  assert.equal(i, "consulta_precio");
  assert.equal(accionSugerida(i), "crear_oportunidad");
});

test("'lo voy a pensar' crea un seguimiento futuro", () => {
  const i = clasificarIntencion("Lo voy a pensar, gracias");
  assert.equal(i, "lo_pensara");
  assert.equal(accionSugerida(i), "crear_seguimiento");
});

test("confirmar la compra prepara la venta para autorizar, no la cierra sola", () => {
  const i = clasificarIntencion("Dale, confirmo. Ya hice la transferencia");
  assert.equal(i, "confirma_compra");
  assert.equal(accionSugerida(i), "preparar_venta");
});

test("cuando un mensaje dice dos cosas gana la más costosa de ignorar", () => {
  assert.equal(clasificarIntencion("Quiero comprar, pero antes sáquenme de la lista"), "baja");
  assert.equal(clasificarIntencion("Me interesa, pero quiero hablar con una persona"), "pide_persona");
  assert.equal(clasificarIntencion("Confirmo, aunque lo tengo que pensar un poco"), "confirma_compra");
});

test("un reclamo va a una persona", () => {
  const i = clasificarIntencion("Tengo un reclamo, me cobraron mal");
  assert.equal(i, "pide_persona");
  assert.equal(accionSugerida(i), "avisar_al_dueno");
});

test("lo que no se entiende queda como otro y no dispara nada", () => {
  assert.equal(clasificarIntencion("👍"), "otro");
  assert.equal(clasificarIntencion(""), "otro");
  assert.equal(clasificarIntencion(null), "otro");
  assert.equal(accionSugerida("otro"), "ninguna");
});

// ============================================================
// Política de envío
// ============================================================

// Miércoles 18 de septiembre de 2026, 10:00 en Paraguay (13:00 UTC).
const AHORA = "2026-09-18T13:00:00Z";

function entrada(parcial: Partial<EntradaPolitica> = {}): EntradaPolitica {
  return {
    ahora: AHORA,
    canal: {
      estado: "activo",
      limite_diario: 250,
      enviados_hoy: 0,
      limite_por_contacto_dia: 2,
      silencio_desde_hora: 21,
      silencio_hasta_hora: 7,
    },
    consentimiento: "otorgado",
    ultimo_entrante_en: "2026-09-18T12:30:00Z", // hace media hora
    enviados_a_este_contacto_hoy: 0,
    es_plantilla: false,
    plantilla_aprobada: false,
    origen: "usuario",
    autorizacion: "ninguna",
    ...parcial,
  };
}

test("la hora de Paraguay es UTC-3", () => {
  assert.equal(horaEnParaguay("2026-09-18T13:00:00Z"), 10);
  assert.equal(horaEnParaguay("2026-09-18T02:00:00Z"), 23);
});

test("responder dentro de la ventana de 24 horas con texto libre sale", () => {
  const d = evaluarEnvio(entrada());
  assert.deepEqual(d, { permitido: true, motivo: "ok", via: "ventana_abierta" });
});

test("un opt-out bloquea SIEMPRE, incluso con la ventana abierta y con autorización", () => {
  const d = evaluarEnvio(entrada({ consentimiento: "revocado", autorizacion: "aprobada", origen: "eos_autonomo" }));
  assert.equal(d.permitido, false);
  assert.equal(d.permitido === false && d.motivo, "opt_out");
});

test("un canal pausado o sin conectar no envía nada", () => {
  for (const estado of ["pendiente", "pausado", "desconectado"] as const) {
    const d = evaluarEnvio(entrada({ canal: { ...entrada().canal, estado } }));
    assert.equal(d.permitido === false && d.motivo, "canal_inactivo", estado);
  }
});

test("pasadas las 24 horas el texto libre no sale: hace falta una plantilla", () => {
  const d = evaluarEnvio(entrada({ ultimo_entrante_en: "2026-09-16T13:00:00Z" }));
  assert.equal(d.permitido === false && d.motivo, "fuera_de_ventana_requiere_plantilla");
});

test("con plantilla aprobada y consentimiento, se puede retomar pasada la ventana", () => {
  const d = evaluarEnvio(
    entrada({ ultimo_entrante_en: "2026-09-10T13:00:00Z", es_plantilla: true, plantilla_aprobada: true }),
  );
  assert.deepEqual(d, { permitido: true, motivo: "ok", via: "plantilla" });
});

test("una plantilla sin aprobar no sale", () => {
  const d = evaluarEnvio(
    entrada({ ultimo_entrante_en: "2026-09-10T13:00:00Z", es_plantilla: true, plantilla_aprobada: false }),
  );
  assert.equal(d.permitido === false && d.motivo, "plantilla_no_aprobada");
});

test("a un cliente que nunca escribió y no dio consentimiento no se le inicia nada", () => {
  const d = evaluarEnvio(
    entrada({ ultimo_entrante_en: null, consentimiento: "sin_registro", es_plantilla: true, plantilla_aprobada: true }),
  );
  assert.equal(d.permitido === false && d.motivo, "sin_consentimiento");
});

test("lo que EOS inicia por su cuenta sin autorización queda para aprobar", () => {
  const d = evaluarEnvio(
    entrada({
      origen: "eos_autonomo",
      ultimo_entrante_en: "2026-09-10T13:00:00Z",
      es_plantilla: true,
      plantilla_aprobada: true,
      autorizacion: "ninguna",
    }),
  );
  assert.equal(d.permitido === false && d.motivo, "requiere_aprobacion");
});

test("el 'Sí, escribile' del dueño lo habilita", () => {
  const d = evaluarEnvio(
    entrada({
      origen: "eos_autonomo",
      ultimo_entrante_en: "2026-09-10T13:00:00Z",
      es_plantilla: true,
      plantilla_aprobada: true,
      autorizacion: "aprobada",
    }),
  );
  assert.equal(d.permitido, true);
});

test("EOS puede contestar solo a quien le acaba de escribir", () => {
  const d = evaluarEnvio(entrada({ origen: "eos_autonomo", autorizacion: "ninguna" }));
  assert.equal(d.permitido, true);
});

test("el límite diario del canal corta todo", () => {
  const d = evaluarEnvio(entrada({ canal: { ...entrada().canal, enviados_hoy: 250 } }));
  assert.equal(d.permitido === false && d.motivo, "limite_diario_del_canal");
});

test("a un mismo cliente EOS no le escribe más de lo permitido por día", () => {
  const d = evaluarEnvio(
    entrada({
      origen: "eos_autonomo",
      autorizacion: "aprobada",
      enviados_a_este_contacto_hoy: 2,
    }),
  );
  assert.equal(d.permitido === false && d.motivo, "limite_por_contacto");
});

test("de noche EOS no inicia seguimientos, pero sí contesta al instante", () => {
  const noche = "2026-09-18T02:00:00Z"; // 23:00 en Paraguay
  const inicia = evaluarEnvio(
    entrada({
      ahora: noche,
      origen: "eos_autonomo",
      autorizacion: "aprobada",
      ultimo_entrante_en: "2026-09-16T13:00:00Z",
      es_plantilla: true,
      plantilla_aprobada: true,
    }),
  );
  assert.equal(inicia.permitido === false && inicia.motivo, "horario_de_silencio");

  const contesta = evaluarEnvio(
    entrada({ ahora: noche, origen: "eos_autonomo", ultimo_entrante_en: "2026-09-18T01:50:00Z" }),
  );
  assert.equal(contesta.permitido, true);
});
