import test from "node:test";
import assert from "node:assert/strict";

import {
  PERFIL_POR_DEFECTO,
  decidirAutonomia,
  diaEnZonaHoraria,
  inicioVentanaDiaria,
  type EventoAutomatico,
  type PerfilAutonomia,
  type ReglaAutonomia,
} from "./decision.ts";
import { SYSTEM_RISK, type SystemRisk } from "./riesgo.ts";

/**
 * La escalera del gate y el presupuesto diario.
 *
 * Cada caso de acá es una forma en que EOS promete y no cumple —el gate frena
 * lo que la persona pidió— o cumple lo que no debía —el gate deja pasar lo que
 * tenía que frenar—. Las dos pasaron en producción y ninguna hizo ruido.
 */

// Mediodía en Asunción. Los instantes de abajo están lejos de la medianoche
// local a propósito: dan el mismo día con UTC-3 (la hora de Paraguay desde
// 2024) y con UTC-4 (la de un tzdata viejo), así que la prueba no depende de
// qué versión de ICU traiga Node.
const AHORA = new Date("2026-09-12T15:00:00Z");
const HOY_TEMPRANO = "2026-09-12T04:30:00Z"; // 01:30 o 00:30 del 12
const AYER_TARDE = "2026-09-12T02:30:00Z"; // 23:30 o 22:30 del 11

function eventos(cantidad: number, puntos: unknown, cuando = HOY_TEMPRANO): EventoAutomatico[] {
  return Array.from({ length: cantidad }, () => ({
    created_at: cuando,
    detail: { risk_points: puntos },
  }));
}

function decidir(p: {
  accion?: string;
  riesgo?: SystemRisk;
  perfil?: Partial<PerfilAutonomia>;
  regla?: ReglaAutonomia;
  eventos?: EventoAutomatico[];
}) {
  return decidirAutonomia({
    perfil: { ...PERFIL_POR_DEFECTO, ...(p.perfil ?? {}) },
    regla: p.regla ?? null,
    riesgo: p.riesgo ?? SYSTEM_RISK[p.accion ?? "REGISTRAR_VENTA"],
    eventosAutomaticos: p.eventos ?? [],
    ahora: AHORA,
  });
}

// ---------------------------------------------------------------------------
// Lo que el usuario pidió: todo lo del chat se ejecuta solo
// ---------------------------------------------------------------------------

test("con el perfil por defecto, una venta pedida en el chat se ejecuta sola", () => {
  const r = decidir({ accion: "REGISTRAR_VENTA" });

  assert.equal(r.decision, "allow");
  assert.equal(r.effectiveLevel, 3);
});

test("NINGUNA acción del sistema queda esperando aprobación con el perfil por defecto", () => {
  /*
   * "Auto-aprobar todo lo que venga del chat, sin excepción" (3/09/2026).
   *
   * El día que alguien agregue una acción de tier 2 o 3 copiando una fila y
   * olvide `forceApproval: false`, esa acción cae en `approval`: queda
   * esperando en una pantalla que nadie abre y el chat vuelve a prometer sin
   * cumplir. Es el fallo que ya se reportó dos veces desde el uso real.
   */
  const frenadas = Object.keys(SYSTEM_RISK).filter(
    (accion) => decidir({ accion }).decision !== "allow",
  );

  assert.deepEqual(frenadas, []);
});

test("el perfil por defecto dice lo mismo que la base", () => {
  /*
   * Leído de `information_schema.columns` de producción el 12/09/2026:
   * `eos_autonomy_profiles_v12` tiene default 3, 40, 240, 60 y true, las
   * cinco columnas NOT NULL. Cuando este archivo y la base dijeron cosas
   * distintas, cinco usuarios corrieron catorce días en nivel 1.
   *
   * Si esta prueba falla, la pregunta es qué dice la columna.
   */
  assert.deepEqual(PERFIL_POR_DEFECTO, {
    default_level: 3,
    max_auto_actions_per_day: 40,
    max_daily_risk_points: 240,
    approval_ttl_minutes: 60,
    enabled: true,
  });
});

test("con el override, un perfil en nivel 1 no alcanza a frenar una venta", () => {
  assert.equal(decidir({ accion: "REGISTRAR_VENTA", perfil: { default_level: 1 } }).decision, "allow");
});

// ---------------------------------------------------------------------------
// El techo diario: frena un bucle, no a alguien trabajando
// ---------------------------------------------------------------------------

test("un día cargado de uso real entra holgado en el techo", () => {
  // El día del que salieron los números: quince ventas, tres contactos y dos
  // ajustes de stock. 90 + 9 + 12 = 111 puntos en 20 acciones.
  const dia = [
    ...eventos(15, SYSTEM_RISK.REGISTRAR_VENTA.points),
    ...eventos(3, SYSTEM_RISK.CREAR_CONTACTO.points),
    ...eventos(2, SYSTEM_RISK.AJUSTAR_STOCK.points),
  ];

  const r = decidir({ accion: "REGISTRAR_VENTA", eventos: dia });

  assert.equal(r.usedRisk, 111);
  assert.equal(r.autoCount, 20);
  assert.equal(r.decision, "allow");
});

test("un modelo trabado en un bucle se frena: la acción 41 del día no pasa", () => {
  const r = decidir({ accion: "DECLARAR_SALDO", eventos: eventos(40, 1) });

  assert.equal(r.decision, "block");
  assert.equal(r.reason, "Se alcanzó el límite diario de acciones automáticas.");
});

test("la acción 40 del día todavía pasa", () => {
  assert.equal(decidir({ accion: "DECLARAR_SALDO", eventos: eventos(39, 1) }).decision, "allow");
});

test("llegar justo al presupuesto se permite; pasarse por un punto, no", () => {
  const justo = decidir({ accion: "REGISTRAR_VENTA", eventos: eventos(1, 234) });
  const pasado = decidir({ accion: "REGISTRAR_VENTA", eventos: eventos(1, 235) });

  assert.equal(justo.decision, "allow");
  assert.equal(pasado.decision, "block");
  assert.equal(pasado.reason, "La acción superaría el presupuesto diario de riesgo automático.");
});

test("lo de ayer no gasta el día de hoy, aunque esté dentro de la ventana de 30 horas", () => {
  const deAyer = decidir({ accion: "DECLARAR_SALDO", eventos: eventos(40, 6, AYER_TARDE) });
  const deHoy = decidir({ accion: "DECLARAR_SALDO", eventos: eventos(40, 6, HOY_TEMPRANO) });

  assert.equal(deAyer.decision, "allow");
  assert.equal(deAyer.autoCount, 0);
  assert.equal(deHoy.decision, "block");
});

test("los puntos que no son números no suman; los que llegan como texto, sí", () => {
  const r = decidir({
    accion: "DECLARAR_SALDO",
    eventos: [
      { created_at: HOY_TEMPRANO, detail: { risk_points: "abc" } },
      { created_at: HOY_TEMPRANO, detail: { risk_points: "200" } },
      { created_at: HOY_TEMPRANO, detail: {} },
      { created_at: HOY_TEMPRANO, detail: null },
    ],
  });

  assert.equal(r.usedRisk, 200);
  assert.equal(r.autoCount, 4);
});

// ---------------------------------------------------------------------------
// Las reglas por usuario
// ---------------------------------------------------------------------------

test("una regla apagada se ignora ENTERA: nivel, tope y riesgo", () => {
  // La regresión que dejó a EOS sin guardar una sola memoria desde el 18 de
  // agosto: la regla apagada bajaba el nivel a 0 y todo terminaba en
  // `recommend`.
  const r = decidir({
    accion: "GUARDAR_MEMORIA",
    regla: { enabled: false, autonomy_level: 0, max_auto_per_day: 0, risk_points: 999, risk_tier: 3 },
  });

  assert.equal(r.decision, "allow");
  assert.equal(r.effectiveLevel, 3);
  assert.equal(r.actionLimit, 40);
  assert.equal(r.riskPoints, SYSTEM_RISK.GUARDAR_MEMORIA.points);
});

test("una regla prendida manda sobre el perfil y sobre el override", () => {
  const r = decidir({ accion: "REGISTRAR_VENTA", regla: { enabled: true, autonomy_level: 1 } });

  assert.equal(r.decision, "prepare");
});

test("una regla no puede bajar el riesgo que fija el sistema", () => {
  const r = decidir({
    accion: "REGISTRAR_VENTA",
    regla: { enabled: true, risk_points: 0, risk_tier: 0 },
  });

  assert.equal(r.riskPoints, SYSTEM_RISK.REGISTRAR_VENTA.points);
  assert.equal(r.riskTier, SYSTEM_RISK.REGISTRAR_VENTA.tier);
});

test("una regla puede achicar el tope diario, pero no agrandarlo", () => {
  assert.equal(decidir({ regla: { enabled: true, max_auto_per_day: 5 } }).actionLimit, 5);
  assert.equal(decidir({ regla: { enabled: true, max_auto_per_day: 500 } }).actionLimit, 40);
  assert.equal(decidir({ regla: { enabled: true, max_auto_per_day: null } }).actionLimit, 40);
});

// ---------------------------------------------------------------------------
// La escalera
// ---------------------------------------------------------------------------

const TAREA_SIN_OVERRIDE: SystemRisk = { tier: 1, points: 1, maxLevel: 3 };

test("sin override manda el nivel del perfil: 1 prepara, 0 recomienda", () => {
  const uno = decidir({ riesgo: TAREA_SIN_OVERRIDE, perfil: { default_level: 1 } });
  const cero = decidir({ riesgo: TAREA_SIN_OVERRIDE, perfil: { default_level: 0 } });

  assert.equal(uno.decision, "prepare");
  assert.equal(cero.decision, "recommend");
});

test("el maxLevel de la acción recorta al nivel configurado", () => {
  const r = decidir({ riesgo: { tier: 1, points: 1, maxLevel: 2 } });

  assert.equal(r.effectiveLevel, 2);
  assert.equal(r.decision, "approval");
  assert.equal(r.reason, "La configuración del usuario exige aprobación explícita.");
});

test("tier 2 pide aprobación, salvo que la acción lo excluya de forma explícita", () => {
  const sinExcluir = decidir({ riesgo: { tier: 2, points: 3, maxLevel: 3 } });
  const excluida = decidir({ riesgo: { tier: 2, points: 3, maxLevel: 3, forceApproval: false } });

  assert.equal(sinExcluir.decision, "approval");
  assert.equal(sinExcluir.reason, "El riesgo mínimo de sistema exige aprobación explícita.");
  assert.equal(excluida.decision, "allow");
});

test("con la autonomía apagada solo recomienda, aunque todo lo demás permita", () => {
  const r = decidir({ accion: "REGISTRAR_VENTA", perfil: { enabled: false } });

  assert.equal(r.decision, "recommend");
  assert.equal(r.reason, "La autonomía está desactivada para este usuario.");
});

// ---------------------------------------------------------------------------
// Lo que no se puede leer, frena
// ---------------------------------------------------------------------------

test("si el nivel no se puede leer, se frena — nunca se ejecuta", () => {
  /*
   * Antes de esta prueba, un nivel NaN atravesaba la escalera entera y daba
   * `allow`. No es alcanzable con la base de hoy —las columnas son NOT NULL—,
   * pero es el único caso en que el gate no sabe qué hacer, y justo ahí
   * ejecutaba.
   */
  const nan = decidir({ riesgo: TAREA_SIN_OVERRIDE, perfil: { default_level: Number.NaN } });
  const faltante = decidir({
    riesgo: TAREA_SIN_OVERRIDE,
    perfil: { default_level: undefined as unknown as number },
  });
  const partido = decidir({ riesgo: TAREA_SIN_OVERRIDE, perfil: { default_level: 2.5 } });

  for (const r of [nan, faltante, partido]) {
    assert.equal(r.decision, "block");
    assert.notEqual(r.decision, "allow");
  }
});

test("si un techo diario no se puede leer, se frena — un techo ilegible no es ningún techo", () => {
  const sinPresupuesto = decidir({ perfil: { max_daily_risk_points: Number.NaN } });
  const sinTope = decidir({ perfil: { max_auto_actions_per_day: Number.NaN } });
  const reglaRota = decidir({ regla: { enabled: true, risk_points: Number.NaN } });

  assert.equal(sinPresupuesto.decision, "block");
  assert.equal(sinTope.decision, "block");
  assert.equal(reglaRota.decision, "block");
});

// ---------------------------------------------------------------------------
// El día de Asunción
// ---------------------------------------------------------------------------

test("el día se cuenta en Asunción, no en UTC", () => {
  assert.equal(diaEnZonaHoraria(AYER_TARDE), "2026-09-11");
  assert.equal(diaEnZonaHoraria(HOY_TEMPRANO), "2026-09-12");
});

test("la ventana de lectura cubre el día local entero, a cualquier hora", () => {
  // Si la ventana empezara adentro del día de hoy, las primeras acciones de la
  // mañana no se contarían y el techo se podría pasar sin que salte.
  for (let hora = 0; hora < 24; hora++) {
    const ahora = new Date(Date.UTC(2026, 8, 12, 3 + hora, 0, 0));
    const inicio = inicioVentanaDiaria(ahora);

    assert.ok(
      diaEnZonaHoraria(inicio) < diaEnZonaHoraria(ahora.toISOString()),
      `a las ${ahora.toISOString()} la ventana empieza el mismo día local`,
    );
  }
});
