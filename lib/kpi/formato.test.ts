import assert from "node:assert/strict";
import test from "node:test";
import {
  avisoDeConfianza,
  flechaDe,
  formatearValor,
  formatearVariacion,
  porPrioridad,
  textoSinValor,
  tonoDeVariacion,
} from "./formato.ts";
import type { ResultadoKPI } from "./tipos.ts";

function resultado(p: Partial<ResultadoKPI> = {}): ResultadoKPI {
  return {
    id: p.id ?? "k",
    nombre: p.nombre ?? "Indicador",
    familia: p.familia ?? "ventas",
    unidad: p.unidad ?? "moneda",
    direccion: p.direccion ?? "mas_es_mejor",
    moneda: p.moneda ?? "PYG",
    valor: p.valor ?? 0,
    anterior: p.anterior ?? null,
    variacion: p.variacion ?? null,
    variacion_pct: p.variacion_pct ?? null,
    tendencia: p.tendencia ?? "desconocida",
    estado: p.estado ?? "bien",
    periodo: p.periodo ?? { desde: "2026-08-01", hasta: "2026-08-31" },
    calculado_en: p.calculado_en ?? "2026-08-31",
    confianza: p.confianza ?? { nivel: 1, motivos: [] },
    falta: p.falta ?? null,
  };
}

test("la plata se formatea con la función única del proyecto, no con una copia", () => {
  // Si esto se rompe, alguien reimplementó el formato de moneda acá adentro.
  assert.equal(formatearValor(1_250_000, "moneda", "PYG"), formatearValor(1_250_000, "moneda", "PYG"));
  assert.match(formatearValor(1_250_000, "moneda", "PYG"), /1\.250\.000/);
});

test("un porcentaje lleva un decimal: 69,8 y 70,3 son decisiones distintas", () => {
  assert.equal(formatearValor(69.83, "porcentaje", "PYG"), "69,8%");
  assert.equal(formatearValor(70, "porcentaje", "PYG"), "70%");
});

test("todo número no monetario usa la coma decimal paraguaya, no el punto", () => {
  // Dos separadores distintos en un mismo panel hacen dudar del resto.
  assert.equal(formatearValor(69.83, "porcentaje", "PYG"), "69,8%");
  assert.equal(formatearValor(3.5, "cantidad", "PYG"), "3,5");
  assert.equal(formatearValor(26.5, "dias", "PYG"), "26,5 días");
  assert.equal(formatearValor(1.25, "ratio", "PYG"), "1,25");
});

test("los días llevan su unidad escrita, para que 26 no se confunda con guaraníes", () => {
  assert.equal(formatearValor(26, "dias", "PYG"), "26 días");
});

test("una cantidad promedio conserva su decimal: 3,5 unidades por ticket significa algo", () => {
  assert.equal(formatearValor(3.5, "cantidad", "PYG"), "3,5");
});

test("sin período anterior la variación es null, no un 0% que se lee como 'no cambió'", () => {
  assert.equal(formatearVariacion(resultado({ variacion_pct: null })), null);
  assert.notEqual(formatearVariacion(resultado({ variacion_pct: null })), "0%");
});

test("la variación positiva lleva su signo adelante, con coma decimal", () => {
  assert.equal(formatearVariacion(resultado({ variacion_pct: 12.34 })), "+12,3%");
  assert.equal(formatearVariacion(resultado({ variacion_pct: -8 })), "-8%");
});

test("subir no es siempre bueno: depende de la dirección del indicador", () => {
  // Ventas que suben: buena noticia.
  assert.equal(tonoDeVariacion("sube", "mas_es_mejor"), "bueno");
  // Gastos que suben: la MISMA flecha, mala noticia.
  assert.equal(tonoDeVariacion("sube", "menos_es_mejor"), "malo");
  // Cuentas por cobrar que suben: ni bueno ni malo por sí solo.
  assert.equal(tonoDeVariacion("sube", "neutro"), "neutro");
});

test("bajar tampoco: cobros demorados que bajan es una buena noticia", () => {
  assert.equal(tonoDeVariacion("baja", "menos_es_mejor"), "bueno");
  assert.equal(tonoDeVariacion("baja", "mas_es_mejor"), "malo");
});

test("sin tendencia conocida no se pinta nada de color", () => {
  assert.equal(tonoDeVariacion("desconocida", "mas_es_mejor"), "neutro");
  assert.equal(tonoDeVariacion("estable", "menos_es_mejor"), "neutro");
  assert.equal(flechaDe("estable"), "");
  assert.equal(flechaDe("desconocida"), "");
});

test("cuando no hay valor se muestra el motivo de la definición, no un texto genérico", () => {
  const r = resultado({ valor: null, falta: "Ninguna venta del período tiene costo cargado" });
  assert.equal(textoSinValor(r), "Ninguna venta del período tiene costo cargado");
});

test("las alertas van primero; dentro del mismo estado se respeta el orden del catálogo", () => {
  const orden = porPrioridad([
    resultado({ id: "a", estado: "bien" }),
    resultado({ id: "b", estado: "sin_datos" }),
    resultado({ id: "c", estado: "alerta" }),
    resultado({ id: "d", estado: "bien" }),
    resultado({ id: "e", estado: "atencion" }),
  ]).map((r) => r.id);

  assert.deepEqual(orden, ["c", "e", "a", "d", "b"]);
});

test("con confianza total no se muestra ninguna leyenda: un aviso en cada tarjeta es ruido", () => {
  assert.equal(avisoDeConfianza(resultado({ confianza: { nivel: 1, motivos: [] } })), null);
});

test("con confianza parcial se dice exactamente qué faltó", () => {
  const r = resultado({ confianza: { nivel: 0.6, motivos: ["6 de 15 ventas no tienen costo cargado"] } });
  assert.equal(avisoDeConfianza(r), "6 de 15 ventas no tienen costo cargado");
});
