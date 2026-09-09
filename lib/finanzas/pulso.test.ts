import assert from "node:assert/strict";
import test from "node:test";

import {
  CON_UMBRALES_PERSONALES,
  DIMENSIONES_PERSONALES,
  indicadoresPersonales,
  type EntradaPulso,
} from "./pulso.ts";
import { detectarAnomalias, ordenar } from "../kpi/anomalias.ts";
import { calcularScore, explicarCambio } from "../kpi/score.ts";

const HOY = "2026-09-08";

function entrada(cambios: Partial<EntradaPulso> = {}): EntradaPulso {
  return {
    hoy: HOY,
    moneda: "PYG",
    periodo: { desde: "2026-09-01", hasta: HOY },
    disponibleReal: 2_000_000,
    gastoHabitualMensual: 3_000_000,
    gastoDelMes: 1_200_000,
    ingresoDelMes: 4_200_000,
    deudaTotal: 10_800_000,
    cuotasMensuales: 800_000,
    porcentajeAhorroDeclarado: 15,
    mesesCubiertos: 1,
    mesesElegidos: 6,
    utilizacionMaxima: 0.4,
    ...cambios,
  };
}

const buscar = (id: string, e = entrada()) => indicadoresPersonales(e).find((r) => r.id === id)!;

test("los días de colchón salen del disponible sobre lo que gasta por día", () => {
  const r = buscar("pers_dias_de_colchon");

  // 3.000.000 por mes son 98.563 por día; 2.000.000 aguantan 20,3 días.
  assert.ok(Math.abs((r.valor ?? 0) - 20.3) < 0.2);
  assert.equal(r.estado, "atencion");
});

test("sin saber cuánto gasta no hay días de colchón inventados", () => {
  const r = buscar("pers_dias_de_colchon", entrada({ gastoHabitualMensual: null }));

  assert.equal(r.valor, null);
  assert.equal(r.estado, "sin_datos");
  assert.match(r.falta ?? "", /cuánto gastás/);
});

test("la carga de deuda se compara contra donde los bancos dejan de prestar", () => {
  // 800.000 sobre 4.200.000 son 19%: dentro de lo que se puede refinanciar.
  const bien = buscar("pers_carga_de_deuda");
  assert.ok(Math.abs((bien.valor ?? 0) - 19) < 0.1);
  assert.equal(bien.estado, "bien");

  // 1.800.000 sobre 4.200.000 son 42,9%: por encima, pierde la capacidad de
  // refinanciar justo cuando más la necesita.
  const mal = buscar("pers_carga_de_deuda", entrada({ cuotasMensuales: 1_800_000 }));
  assert.equal(mal.estado, "alerta");
});

test("la tasa de ahorro se mide contra SU porcentaje, no contra uno recomendado", () => {
  /*
   * Quien declaró querer ahorrar el 15% está bien cuando ahorra 15. Comparar
   * contra un "20% recomendado" sería juzgarla con la meta de otra persona.
   */
  const cumple = buscar("pers_tasa_de_ahorro", entrada({ gastoDelMes: 3_500_000 }));
  // (4.200.000 − 3.500.000) / 4.200.000 = 16,7%
  assert.equal(cumple.estado, "bien");

  const flojo = buscar("pers_tasa_de_ahorro", entrada({ gastoDelMes: 3_750_000 }));
  // 10,7%: por debajo de su 15% pero por encima de la mitad.
  assert.equal(flojo.estado, "atencion");

  const lejos = buscar("pers_tasa_de_ahorro", entrada({ gastoDelMes: 3_900_000 }));
  // 7,1%: menos de la mitad de lo que se propuso.
  assert.equal(lejos.estado, "alerta");
});

test("sin porcentaje declarado el ahorro informa y no juzga", () => {
  const r = buscar("pers_tasa_de_ahorro", entrada({ porcentajeAhorroDeclarado: 0 }));

  assert.ok(r.valor !== null);
  assert.equal(r.estado, "bien");
});

test("la cobertura del fondo se mide contra los meses que ELIGIÓ", () => {
  const r = buscar("pers_cobertura_del_fondo");

  // Cubre 1 mes y eligió 6: la mitad de 6 es 3, así que está en alerta.
  assert.equal(r.valor, 1);
  assert.equal(r.estado, "alerta");

  const sinElegir = buscar("pers_cobertura_del_fondo", entrada({ mesesElegidos: null }));
  assert.equal(sinElegir.estado, "bien");
});

test("el gasto del mes se compara contra su propia mediana, sin umbral", () => {
  /*
   * Un monto solo no es bueno ni malo. Lo que lo vuelve noticia es moverse
   * contra lo que esa persona gasta normalmente.
   */
  const r = buscar("pers_gasto_del_mes");

  assert.equal(r.anterior, 3_000_000);
  assert.equal(r.variacion, -1_800_000);
  assert.equal(r.tendencia, "baja");
  assert.equal(r.estado, "bien");
});

test("la utilización de tarjetas usa el mismo umbral que la pantalla de tarjetas", () => {
  const comoda = buscar("pers_utilizacion_tarjetas");
  assert.equal(comoda.estado, "bien");

  const apretada = buscar("pers_utilizacion_tarjetas", entrada({ utilizacionMaxima: 0.82 }));
  assert.equal(apretada.estado, "atencion");

  const sinTarjetas = buscar("pers_utilizacion_tarjetas", entrada({ utilizacionMaxima: null }));
  assert.equal(sinTarjetas.valor, null);
  assert.equal(sinTarjetas.estado, "sin_datos");
});

test("todos los ids llevan el prefijo que los separa de los del negocio", () => {
  /*
   * Comparten la tabla de historia. Sin el prefijo, una consulta del tablero
   * del negocio podría traer el alquiler de la casa de alguien.
   */
  for (const r of indicadoresPersonales(entrada())) {
    assert.match(r.id, /^pers_/);
  }
});

test("el detector de anomalías del negocio funciona tal cual sobre estos", () => {
  /*
   * Es el punto del módulo: Personal no estrena una segunda forma de decidir
   * qué es grave. Habla el idioma de `lib/kpi/` y reusa su detector.
   */
  const resultados = indicadoresPersonales(entrada({ cuotasMensuales: 2_000_000, mesesCubiertos: 0.2 }));
  const hallazgos = ordenar(detectarAnomalias(resultados.map((r) => ({ resultado: r }))));

  assert.ok(hallazgos.length > 0);
  // Lo más grave primero, con su evidencia.
  assert.equal(hallazgos[0].severidad, "critico");
  assert.ok(hallazgos[0].evidencia.length > 0);
});

test("el score usa la misma aritmética que el del negocio, con otras dimensiones", () => {
  const resultados = indicadoresPersonales(entrada());
  const score = calcularScore(resultados, CON_UMBRALES_PERSONALES, "PYG", DIMENSIONES_PERSONALES);

  assert.ok(score.puntaje !== null);
  assert.equal(score.dimensiones.length, DIMENSIONES_PERSONALES.length);
  // Y cada componente que puntuó viene con su nombre y su detalle: eso es lo
  // que hace que el número se pueda explicar en vez de tener que creerlo.
  const conComponentes = score.dimensiones.filter((d) => d.componentes.length > 0);
  assert.ok(conComponentes.length > 0);
  assert.ok(conComponentes[0].componentes[0].detalle.length > 0);
});

test("explica el cambio del score dimensión por dimensión", () => {
  const antes = calcularScore(
    indicadoresPersonales(entrada({ disponibleReal: 500_000, deudaTotal: 12_000_000 })),
    CON_UMBRALES_PERSONALES,
    "PYG",
    DIMENSIONES_PERSONALES,
  );

  const ahora = calcularScore(
    indicadoresPersonales(entrada({ disponibleReal: 3_500_000, deudaTotal: 10_800_000 })),
    CON_UMBRALES_PERSONALES,
    "PYG",
    DIMENSIONES_PERSONALES,
  );

  const cambios = explicarCambio(ahora, antes);

  assert.ok(cambios.length > 0);
  // De mayor a menor movimiento: quien lee la primera línea encuentra lo que
  // más pesó.
  assert.equal(cambios[0].dimension, "Colchón");
  assert.ok(cambios[0].cambio > 0);
});

test("un disponible negativo no puede decir que estás bien", () => {
  /*
   * Apareció en una cuenta real el 8 de septiembre de 2026: −49.500.000 con
   * estado "bien", porque el indicador no tenía ningún umbral. Un disponible
   * negativo no es una opinión sobre cuánto conviene tener: es una cuenta que
   * no cierra.
   */
  const rojo = buscar("pers_disponible_real", entrada({ disponibleReal: -49_500_000 }));
  assert.equal(rojo.estado, "alerta");

  const enCero = buscar("pers_disponible_real", entrada({ disponibleReal: 0 }));
  assert.equal(enCero.estado, "atencion");

  const bien = buscar("pers_disponible_real", entrada({ disponibleReal: 2_000_000 }));
  assert.equal(bien.estado, "bien");
});

test("los indicadores sin umbral no puntúan, así que su 'bien' no es un veredicto", () => {
  // `pers_deuda_total` informa "bien" por convención del motor. Lo que impide
  // que eso se lea como "tu deuda está bien" es que queda fuera del score.
  assert.equal(CON_UMBRALES_PERSONALES.has("pers_deuda_total"), false);
  assert.equal(CON_UMBRALES_PERSONALES.has("pers_gasto_del_mes"), false);
});
