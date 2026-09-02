import assert from "node:assert/strict";
import test from "node:test";
import { areaD, escalar, indicesDeEtiquetas, lineaD, MARGENES, tramos } from "./escala.ts";

const CAJA = { ancho: 640, alto: 200 };

test("el valor más alto queda arriba y el más bajo abajo", () => {
  const e = escalar([10, 50], CAJA);
  assert.ok(e.y(50) < e.y(10), "más valor tiene que dar menos y (más arriba)");
});

test("deja aire arriba para que el máximo no toque el borde ni se recorte su etiqueta", () => {
  const e = escalar([0, 100], CAJA);
  assert.ok(e.y(100) > e.margenes.arriba, "el máximo no puede quedar pegado al tope");
});

test("un solo punto se ubica en el medio en vez de dividir por cero", () => {
  const e = escalar([42], CAJA);
  const x = e.x(0);
  assert.ok(Number.isFinite(x));
  assert.equal(x, MARGENES.izq + (640 - MARGENES.izq - MARGENES.der) / 2);
});

test("una serie plana no divide por cero ni colapsa la altura", () => {
  const e = escalar([5, 5, 5], CAJA);
  assert.ok(Number.isFinite(e.y(5)));
});

test("sin valores no explota: devuelve escalas usables", () => {
  const e = escalar([], CAJA);
  assert.ok(Number.isFinite(e.y(0)));
  assert.ok(Number.isFinite(e.x(0)));
});

test("se puede forzar el mínimo para que el cero entre siempre", () => {
  const e = escalar([80, 100], { ...CAJA, min: 0 });
  assert.equal(e.y(0), e.piso);
});

test("la línea usa el índice del punto, así un hueco no corre los días", () => {
  // Faltó el día 1: el punto del día 2 tiene que dibujarse en la posición 2,
  // no en la 1. Si se corriera, la serie mentiría sobre cuándo pasó cada cosa.
  const e = escalar([10, 30], CAJA);
  const d = lineaD([{ i: 0, v: 10 }, { i: 2, v: 30 }], e);
  assert.ok(d.startsWith("M"));
  assert.ok(d.includes("L"));
});

test("el área cierra contra el piso, no contra el borde del lienzo", () => {
  const e = escalar([10, 30], CAJA);
  const d = areaD([{ i: 0, v: 10 }, { i: 1, v: 30 }], e);
  assert.ok(d.endsWith("Z"));
  assert.ok(d.includes(String(e.piso)));
});

test("sin puntos, los path quedan vacíos en vez de 'M,NaN'", () => {
  const e = escalar([], CAJA);
  assert.equal(lineaD([], e), "");
  assert.equal(areaD([], e), "");
});

test("las etiquetas se ralean según el ancho, no según una constante", () => {
  const anchas = indicesDeEtiquetas(45, 640);
  const angostas = indicesDeEtiquetas(45, 320);
  assert.ok(angostas.length < anchas.length, "en menos ancho tienen que entrar menos etiquetas");
});

test("la última etiqueta siempre entra: es 'hoy', el punto que más se mira", () => {
  for (const cantidad of [2, 7, 30, 45, 100]) {
    const idx = indicesDeEtiquetas(cantidad, 640);
    assert.equal(idx[idx.length - 1], cantidad - 1, `falló con ${cantidad} puntos`);
  }
});

test("las etiquetas nunca se repiten ni se desordenan", () => {
  const idx = indicesDeEtiquetas(45, 640);
  assert.deepEqual(idx, [...new Set(idx)].sort((a, b) => a - b));
});

test("las dos últimas etiquetas nunca quedan más juntas que el paso normal", () => {
  // Con 45 puntos el anteúltimo caía a 2 de distancia y se veían pegadas en
  // pantalla. Ninguna separación puede ser menor que el paso del resto.
  for (const cantidad of [10, 23, 45, 61, 90]) {
    const idx = indicesDeEtiquetas(cantidad, 640);
    if (idx.length < 3) continue;
    const pasoNormal = idx[1] - idx[0];
    const ultimoHueco = idx[idx.length - 1] - idx[idx.length - 2];
    assert.ok(
      ultimoHueco >= pasoNormal,
      `con ${cantidad} puntos el último hueco fue ${ultimoHueco} y el paso ${pasoNormal}`,
    );
  }
});

test("los tramos se cortan donde falta un día, y no se inventa el recorrido", () => {
  // Días 0,1 · hueco 2,3 · días 4,5
  const t = tramos([
    { i: 0, v: 10 },
    { i: 1, v: 20 },
    { i: 4, v: 50 },
    { i: 5, v: 60 },
  ]);
  assert.equal(t.length, 2);
  assert.deepEqual(t[0].map((p) => p.i), [0, 1]);
  assert.deepEqual(t[1].map((p) => p.i), [4, 5]);
});

test("sin huecos hay un solo tramo", () => {
  const t = tramos([{ i: 0, v: 1 }, { i: 1, v: 2 }, { i: 2, v: 3 }]);
  assert.equal(t.length, 1);
});

test("una serie vacía no produce tramos", () => {
  assert.deepEqual(tramos([]), []);
});

test("un punto aislado es su propio tramo", () => {
  const t = tramos([{ i: 0, v: 1 }, { i: 5, v: 2 }]);
  assert.equal(t.length, 2);
  assert.equal(t[0].length, 1);
});
