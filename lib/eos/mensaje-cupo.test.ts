import assert from "node:assert/strict";
import { test } from "node:test";

import { mensajeDeCupo, type SituacionCupo } from "./mensaje-cupo.ts";

const SITUACIONES: SituacionCupo[] = ["limite", "en_proceso", "ya_procesado", "suscripcion"];

test("en la web, el límite invita a ver los planes", () => {
  assert.match(mensajeDeCupo("limite", { planGratis: true, appNativa: false }), /Planes/);
  assert.match(mensajeDeCupo("limite", { planGratis: false, appNativa: false }), /Planes/);
  assert.match(mensajeDeCupo("suscripcion", { planGratis: false, appNativa: false }), /plan/);
});

test("en la app nativa ningún mensaje invita a comprar", () => {
  for (const situacion of SITUACIONES) {
    for (const planGratis of [true, false]) {
      const texto = mensajeDeCupo(situacion, { planGratis, appNativa: true });
      assert.doesNotMatch(texto, /planes|elegir un plan|revisá tu plan|opciones/i, `${situacion}: ${texto}`);
    }
  }
});

test("en la app el plan gratis igual dice cuándo se renueva", () => {
  assert.match(
    mensajeDeCupo("limite", { planGratis: true, appNativa: true }),
    /se renueva mañana/,
  );
});

test("los textos de la web no cambiaron", () => {
  assert.equal(
    mensajeDeCupo("limite", { planGratis: true, appNativa: false }),
    "Llegaste a tus 5 mensajes gratuitos de hoy. Tu cupo se renueva mañana según la hora de Paraguay. Si querés seguir ahora, podés elegir un plan en Planes.",
  );
  assert.equal(
    mensajeDeCupo("suscripcion", { planGratis: false, appNativa: false }),
    "Tu suscripción no permite enviar mensajes en este momento. Revisá tu plan para continuar.",
  );
});
