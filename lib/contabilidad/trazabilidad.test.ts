import test from "node:test";
import assert from "node:assert/strict";

import { estadoDeResultados } from "./resultado.ts";
import { trazarResultado } from "./trazabilidad.ts";
import type {
  FijoHecho,
  Hechos,
  ItemVentaHecho,
  MovimientoHecho,
  MovimientoStockHecho,
  Periodo,
  ProductoHecho,
  VentaHecho,
} from "../kpi/tipos.ts";

const PERIODO: Periodo = { desde: "2026-09-01", hasta: "2026-09-30" };

function item(p: Partial<ItemVentaHecho> = {}): ItemVentaHecho {
  return {
    total: p.total ?? 1_100_000,
    iva: p.iva ?? 10,
    cantidad: p.cantidad ?? 1,
    costo_unitario: p.costo_unitario ?? null,
    producto_id: p.producto_id ?? "p1",
  };
}

function venta(p: Partial<VentaHecho> = {}): VentaHecho {
  return {
    id: p.id ?? "v1",
    fecha: p.fecha ?? "2026-09-10",
    moneda: p.moneda ?? "PYG",
    estado: p.estado ?? "emitida",
    contacto_id: p.contacto_id ?? null,
    contacto_nombre: p.contacto_nombre ?? null,
    total: p.total ?? 1_100_000,
    vence_el: null,
    cobrado: 0,
    items: p.items ?? [item()],
  };
}

function gasto(p: Partial<MovimientoHecho> = {}): MovimientoHecho {
  return {
    fecha: p.fecha ?? "2026-09-15",
    moneda: p.moneda ?? "PYG",
    monto: p.monto ?? 200_000,
    tipo: p.tipo ?? "gasto",
    descripcion: "descripcion" in p ? p.descripcion : "Alquiler",
  };
}

function fijo(p: Partial<FijoHecho> = {}): FijoHecho {
  return {
    moneda: p.moneda ?? "PYG",
    monto: p.monto ?? 300_000,
    tipo: p.tipo ?? "gasto",
    descripcion: p.descripcion ?? "Sueldo",
  };
}

function salida(p: Partial<MovimientoStockHecho> = {}): MovimientoStockHecho {
  return {
    fecha: p.fecha ?? "2026-09-10",
    tipo: p.tipo ?? "salida",
    cantidad: p.cantidad ?? 1,
    costo_unitario: p.costo_unitario ?? 400_000,
    valor_resultante: p.valor_resultante ?? 0,
    producto_id: p.producto_id ?? "p1",
    moneda: p.moneda ?? "PYG",
  };
}

function producto(p: Partial<ProductoHecho> = {}): ProductoHecho {
  return {
    id: p.id ?? "p1",
    nombre: p.nombre ?? "Producto",
    moneda: p.moneda ?? "PYG",
    activo: p.activo ?? true,
    controla_stock: p.controla_stock ?? true,
    stock_actual: p.stock_actual ?? 10,
    stock_minimo: p.stock_minimo ?? 0,
    costo: p.costo ?? null,
    costo_promedio: p.costo_promedio ?? null,
    iva: p.iva ?? 10,
  };
}

function trazar(h: Hechos, periodo = PERIODO) {
  const resultados = estadoDeResultados(h, periodo);
  assert.equal(resultados.length, 1, "se esperaba una sola moneda");
  return { resultado: resultados[0], trazas: trazarResultado(h, periodo, resultados[0]) };
}

test("ventas_netas: la partida es el neto de IVA de cada venta, no el total facturado", () => {
  const { resultado, trazas } = trazar({
    ventas: [venta({ contacto_nombre: "Rossana", items: [item({ total: 1_100_000, iva: 10 })] })],
  });

  const t = trazas.find((x) => x.cifra === "ventas_netas");
  assert.ok(t && t.tipo === "suma");
  assert.equal(t.total, resultado.ventas_netas);
  assert.equal(t.partidas.length, 1);
  assert.equal(t.partidas[0].monto, 1_000_000);
  assert.equal(t.partidas[0].descripcion, "Venta — Rossana");
  assert.ok(t.cuadra);
});

test("gastos_operativos es una cuenta: anotados + fijos, y cada término abre su propia lista", () => {
  const { resultado, trazas } = trazar({
    movimientos: [gasto({ monto: 200_000, descripcion: "Luz" })],
    fijos: [fijo({ monto: 300_000, descripcion: "Alquiler del local" })],
  });

  const operativos = trazas.find((x) => x.cifra === "gastos_operativos");
  assert.ok(operativos && operativos.tipo === "cuenta");
  assert.equal(operativos.total, resultado.gastos_operativos);
  assert.equal(operativos.total, 500_000);
  assert.ok(operativos.cuadra);

  const anotados = trazas.find((x) => x.cifra === "gastos_anotados");
  assert.ok(anotados && anotados.tipo === "suma");
  assert.equal(anotados.partidas[0].descripcion, "Luz");
  assert.equal(anotados.partidas[0].monto, 200_000);

  const fijos = trazas.find((x) => x.cifra === "gastos_fijos");
  assert.ok(fijos && fijos.tipo === "suma");
  assert.equal(fijos.partidas[0].descripcion, "Alquiler del local");
  assert.equal(fijos.partidas[0].monto, 300_000);
});

test("un gasto sin descripción no rompe la traza: queda como 'Gasto'", () => {
  const { trazas } = trazar({
    movimientos: [gasto({ descripcion: null })],
  });

  const anotados = trazas.find((x) => x.cifra === "gastos_anotados");
  assert.ok(anotados && anotados.tipo === "suma");
  assert.equal(anotados.partidas[0].descripcion, "Gasto");
});

test("con kardex, el costo vendido y los dos resultados se pueden trazar y cuadran", () => {
  const { resultado, trazas } = trazar({
    ventas: [venta({ items: [item({ total: 1_100_000, iva: 10 })] })],
    movimientos: [gasto({ monto: 100_000 })],
    productos: [producto({ id: "p1", nombre: "Taladro" })],
    movimientos_stock: [salida({ producto_id: "p1", cantidad: 1, costo_unitario: 400_000 })],
  });

  assert.notEqual(resultado.costo_vendido, null, "el fixture debía dejar costeable la venta");

  const costo = trazas.find((x) => x.cifra === "costo_vendido");
  assert.ok(costo && costo.tipo === "suma");
  assert.equal(costo.total, resultado.costo_vendido);
  assert.equal(costo.partidas[0].descripcion, "Taladro");
  assert.ok(costo.cuadra);

  const bruto = trazas.find((x) => x.cifra === "resultado_bruto");
  assert.ok(bruto && bruto.tipo === "cuenta");
  assert.equal(bruto.total, resultado.resultado_bruto);
  assert.ok(bruto.cuadra);

  const operativo = trazas.find((x) => x.cifra === "resultado_operativo");
  assert.ok(operativo && operativo.tipo === "cuenta");
  assert.equal(operativo.total, resultado.resultado_operativo);
  assert.ok(operativo.cuadra);
});

test("sin kardex no se promete una traza para lo que no se puede calcular", () => {
  const { resultado, trazas } = trazar({
    ventas: [venta({ items: [item({ total: 1_100_000, iva: 10 })] })],
  });

  assert.equal(resultado.costo_vendido, null);
  assert.equal(resultado.resultado_bruto, null);
  assert.equal(resultado.resultado_operativo, null);

  assert.equal(trazas.some((x) => x.cifra === "costo_vendido"), false);
  assert.equal(trazas.some((x) => x.cifra === "resultado_bruto"), false);
  assert.equal(trazas.some((x) => x.cifra === "resultado_operativo"), false);
});

test("un producto dado de baja no rompe la traza del costo: queda con un texto genérico", () => {
  const { trazas } = trazar({
    ventas: [venta({ items: [item({ total: 1_100_000, iva: 10 })] })],
    movimientos_stock: [salida({ producto_id: "fantasma", cantidad: 1, costo_unitario: 400_000 })],
  });

  const costo = trazas.find((x) => x.cifra === "costo_vendido");
  assert.ok(costo && costo.tipo === "suma");
  assert.equal(costo.partidas[0].descripcion, "Producto dado de baja");
});
