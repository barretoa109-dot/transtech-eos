import test from "node:test";
import assert from "node:assert/strict";

import {
  conciliarExtracto,
  contarResultado,
  type MovimientoAnotado,
  type MovimientoCandidato,
} from "./conciliarExtracto.ts";

/**
 * Tests del diff línea por línea contra un extracto bancario.
 *
 * Esto es lo que EOS cuenta en el chat después de leer un PDF de banco: qué
 * falta, qué sobra y qué no cierra, sin que el usuario tenga que ir a
 * comparar nada a mano.
 */

const candidato = (
  monto: number,
  fecha: string,
  overrides: Partial<MovimientoCandidato> = {},
): MovimientoCandidato => ({
  finding_id: `f-${monto}-${fecha}`,
  tipo: "gasto",
  monto,
  moneda: "PYG",
  descripcion: "Biggie Parana Country",
  fecha,
  ...overrides,
});

const anotado = (
  id: string,
  monto: number,
  fecha: string,
  overrides: Partial<MovimientoAnotado> = {},
): MovimientoAnotado => ({
  id,
  tipo: "gasto",
  monto,
  moneda: "PYG",
  descripcion: "supermercado",
  fecha,
  ...overrides,
});

test("todo coincide: no hay items y la diferencia es cero", () => {
  const r = conciliarExtracto(
    [candidato(187_500, "2026-10-24")],
    [anotado("a1", 187_500, "2026-10-24")],
  );

  assert.equal(r.items.length, 0);
  assert.equal(r.diferencia_caja, 0);
  assert.equal(r.coinciden, 1);
  assert.match(contarResultado(r), /coincide todo/);
});

test("un gasto del banco sin anotar cae en 'pagaste y no anotaste'", () => {
  const r = conciliarExtracto([candidato(187_500, "2026-10-24")], []);

  assert.equal(r.items.length, 1);
  assert.equal(r.items[0].categoria, "pagaste_y_no_anotaste");
  assert.equal(r.diferencia_caja, 187_500);
});

test("dos anotados iguales al mismo gasto del banco: uno es duplicado", () => {
  const r = conciliarExtracto(
    [candidato(23_000, "2026-10-25", { descripcion: "Bolt trip", tipo: "gasto" })],
    [anotado("a1", 23_000, "2026-10-25"), anotado("a2", 23_000, "2026-10-25")],
  );

  assert.equal(r.items.length, 1);
  assert.equal(r.items[0].categoria, "anotado_dos_veces");
  if (r.items[0].categoria === "anotado_dos_veces") {
    assert.equal(r.items[0].anotados.length, 1);
  }
  assert.equal(r.coinciden, 1, "el primero de los dos iguales sí cuenta como coincidencia");
  assert.equal(r.diferencia_caja, 23_000);
});

test("un monto parecido pero no igual se marca como 'monto distinto', no como ausente", () => {
  // El banco cobró 64.000 y el usuario anotó 63.000 a mano.
  const r = conciliarExtracto(
    [candidato(64_000, "2026-10-26", { descripcion: "Farmacenter mcal lopez" })],
    [anotado("a1", 63_000, "2026-10-26")],
  );

  assert.equal(r.items.length, 1);
  assert.equal(r.items[0].categoria, "monto_distinto");
  assert.equal(r.diferencia_caja, 1_000);
});

test("un monto muy distinto (no el 20% de tolerancia) se trata como ausente, no como diferencia", () => {
  const r = conciliarExtracto(
    [candidato(64_000, "2026-10-26")],
    [anotado("a1", 10_000, "2026-10-26")],
  );

  // El anotado de 10.000 queda huérfano (no está en el banco) y el de 64.000
  // del banco queda sin anotar: son dos movimientos distintos, no uno mal
  // tipeado.
  const categorias = r.items.map((i) => i.categoria).sort();
  assert.deepEqual(categorias, ["no_esta_en_el_banco", "pagaste_y_no_anotaste"]);
});

test("un anotado que el banco no tiene cae en 'no está en el banco'", () => {
  const r = conciliarExtracto([], [anotado("a1", 50_000, "2026-10-20", { descripcion: "efectivo" })]);

  assert.equal(r.items.length, 1);
  assert.equal(r.items[0].categoria, "no_esta_en_el_banco");
  assert.equal(r.diferencia_caja, 50_000);
});

test("una fecha un día después del banco todavía se considera el mismo movimiento", () => {
  const r = conciliarExtracto(
    [candidato(100_000, "2026-10-10")],
    [anotado("a1", 100_000, "2026-10-12")],
  );

  assert.equal(r.items.length, 0, "dos días de tolerancia alcanzan para una acreditación demorada");
});

test("una fecha fuera de tolerancia no empareja, aunque el monto sea idéntico", () => {
  const r = conciliarExtracto(
    [candidato(100_000, "2026-10-01")],
    [anotado("a1", 100_000, "2026-10-20")],
  );

  const categorias = r.items.map((i) => i.categoria).sort();
  assert.deepEqual(categorias, ["no_esta_en_el_banco", "pagaste_y_no_anotaste"]);
});

test("un compromiso (vencimiento futuro) no se concilia: todavía no ocurrió", () => {
  const r = conciliarExtracto(
    [candidato(500_000, "2026-11-05", { tipo: "compromiso" })],
    [],
  );

  assert.equal(r.items.length, 0);
  assert.equal(r.diferencia_caja, 0);
});

test("ingreso y gasto del mismo monto y fecha no se confunden entre sí", () => {
  const r = conciliarExtracto(
    [candidato(100_000, "2026-10-05", { tipo: "ingreso" })],
    [anotado("a1", 100_000, "2026-10-05", { tipo: "gasto" })],
  );

  const categorias = r.items.map((i) => i.categoria).sort();
  assert.deepEqual(categorias, ["no_esta_en_el_banco", "pagaste_y_no_anotaste"]);
});

test("el mensaje de chat resume todas las categorías presentes", () => {
  const r = conciliarExtracto(
    [candidato(187_500, "2026-10-24"), candidato(23_000, "2026-10-25")],
    [anotado("a1", 23_000, "2026-10-25")],
  );

  const texto = contarResultado(r);
  assert.match(texto, /1 que pagaste y no anotaste/);
  assert.match(texto, /por resolver/);
});
