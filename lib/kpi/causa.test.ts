import assert from "node:assert/strict";
import test from "node:test";
import { descomponerVentas, principales, redactar } from "./causa.ts";
import type { Hechos, VentaHecho } from "./tipos.ts";

const AGOSTO = { desde: "2026-08-01", hasta: "2026-08-31" };
const JULIO = { desde: "2026-07-01", hasta: "2026-07-31" };

function venta(p: {
  id: string;
  fecha: string;
  items: { total: number; producto_id: string | null }[];
  contacto_id?: string | null;
  contacto_nombre?: string | null;
}): VentaHecho {
  return {
    id: p.id,
    fecha: p.fecha,
    moneda: "PYG",
    estado: "emitida",
    contacto_id: p.contacto_id ?? null,
    contacto_nombre: p.contacto_nombre ?? null,
    total: p.items.reduce((s, i) => s + i.total, 0),
    vence_el: null,
    cobrado: 0,
    items: p.items.map((i) => ({
      total: i.total,
      iva: 10 as const,
      cantidad: 1,
      costo_unitario: null,
      producto_id: i.producto_id,
    })),
  };
}

const PRODUCTOS = [
  { id: "p1", nombre: "Taladro", moneda: "PYG", activo: true, controla_stock: true, stock_actual: 5, stock_minimo: 1, costo: null, costo_promedio: null, iva: 10 as const },
  { id: "p2", nombre: "Martillo", moneda: "PYG", activo: true, controla_stock: true, stock_actual: 5, stock_minimo: 1, costo: null, costo_promedio: null, iva: 10 as const },
];

test("descompone por producto usando el neto de IVA, no el bruto", () => {
  const hechos: Hechos = {
    productos: PRODUCTOS,
    ventas: [
      venta({ id: "v1", fecha: "2026-07-10", items: [{ total: 110, producto_id: "p1" }] }),
      venta({ id: "v2", fecha: "2026-08-10", items: [{ total: 220, producto_id: "p1" }] }),
    ],
  };

  const d = descomponerVentas(hechos, AGOSTO, JULIO, "producto", "PYG");
  // 220 con IVA = 200 neto; 110 = 100 neto.
  assert.equal(d.totalActual, 200);
  assert.equal(d.totalAnterior, 100);
  assert.equal(d.cambio, 100);
  assert.notEqual(d.totalActual, 220);
});

test("una venta con varios ítems se reparte entre sus productos, no se le asigna al primero", () => {
  const hechos: Hechos = {
    productos: PRODUCTOS,
    ventas: [
      venta({
        id: "v1",
        fecha: "2026-08-10",
        items: [
          { total: 110, producto_id: "p1" },
          { total: 220, producto_id: "p2" },
        ],
      }),
    ],
  };

  const d = descomponerVentas(hechos, AGOSTO, JULIO, "producto", "PYG");
  const p1 = d.aportes.find((a) => a.clave === "p1");
  const p2 = d.aportes.find((a) => a.clave === "p2");
  assert.equal(p1?.actual, 100);
  assert.equal(p2?.actual, 200);
});

test("el id de producto se traduce a su nombre; sin nombre no se muestra el uuid", () => {
  const hechos: Hechos = {
    productos: PRODUCTOS,
    ventas: [venta({ id: "v1", fecha: "2026-08-10", items: [{ total: 110, producto_id: "desconocido" }] })],
  };
  const d = descomponerVentas(hechos, AGOSTO, JULIO, "producto", "PYG");
  assert.equal(d.aportes[0].nombre, "Producto sin nombre");
});

test("descompone por cliente, y quien no tiene se agrupa como consumidor final", () => {
  const hechos: Hechos = {
    ventas: [
      venta({ id: "v1", fecha: "2026-08-10", items: [{ total: 110, producto_id: null }], contacto_id: "c1", contacto_nombre: "Kiosco María" }),
      venta({ id: "v2", fecha: "2026-08-11", items: [{ total: 220, producto_id: null }] }),
    ],
  };
  const d = descomponerVentas(hechos, AGOSTO, JULIO, "cliente", "PYG");
  assert.equal(d.aportes.find((a) => a.clave === "c1")?.nombre, "Kiosco María");
  assert.equal(d.aportes.find((a) => a.clave === "sin-cliente")?.nombre, "Consumidor final");
});

test("los aportes se ordenan por magnitud, no por signo", () => {
  const hechos: Hechos = {
    productos: PRODUCTOS,
    ventas: [
      venta({ id: "v1", fecha: "2026-07-10", items: [{ total: 1100, producto_id: "p1" }] }),
      venta({ id: "v2", fecha: "2026-08-10", items: [{ total: 110, producto_id: "p1" }] }), // -900
      venta({ id: "v3", fecha: "2026-08-11", items: [{ total: 220, producto_id: "p2" }] }), // +200
    ],
  };
  const d = descomponerVentas(hechos, AGOSTO, JULIO, "producto", "PYG");
  assert.equal(d.aportes[0].clave, "p1");
  assert.ok(Math.abs(d.aportes[0].cambio) > Math.abs(d.aportes[1].cambio));
});

test("principales toma solo a los que empujan para el mismo lado que el cambio total", () => {
  const hechos: Hechos = {
    productos: PRODUCTOS,
    ventas: [
      venta({ id: "v1", fecha: "2026-07-10", items: [{ total: 1100, producto_id: "p1" }] }),
      venta({ id: "v2", fecha: "2026-08-10", items: [{ total: 110, producto_id: "p1" }] }),
      venta({ id: "v3", fecha: "2026-08-11", items: [{ total: 220, producto_id: "p2" }] }),
    ],
  };
  const d = descomponerVentas(hechos, AGOSTO, JULIO, "producto", "PYG");
  const { aportes } = principales(d);
  // El total cayó; p2 subió, así que no puede figurar entre los que explican la caída.
  assert.ok(aportes.every((a) => a.cambio < 0));
  assert.ok(!aportes.some((a) => a.clave === "p2"));
});

test("sin cambio no hay proporción: no se divide por cero", () => {
  const hechos: Hechos = {
    productos: PRODUCTOS,
    ventas: [
      venta({ id: "v1", fecha: "2026-07-10", items: [{ total: 110, producto_id: "p1" }] }),
      venta({ id: "v2", fecha: "2026-08-10", items: [{ total: 110, producto_id: "p1" }] }),
    ],
  };
  const d = descomponerVentas(hechos, AGOSTO, JULIO, "producto", "PYG");
  assert.equal(d.cambio, 0);
  assert.deepEqual(principales(d), { aportes: [], proporcion: 0 });
  assert.equal(redactar(d, String), null);
});

test("la frase dice 'explican' y nunca 'causaron'", () => {
  const hechos: Hechos = {
    productos: PRODUCTOS,
    ventas: [
      venta({ id: "v1", fecha: "2026-07-10", items: [{ total: 1100, producto_id: "p1" }] }),
      venta({ id: "v2", fecha: "2026-08-10", items: [{ total: 110, producto_id: "p1" }] }),
    ],
  };
  const d = descomponerVentas(hechos, AGOSTO, JULIO, "producto", "PYG");
  const texto = redactar(d, (n) => `Gs. ${n}`);

  assert.ok(texto);
  assert.match(texto, /explican/);
  assert.doesNotMatch(texto, /caus/i);
  assert.match(texto, /Taladro/);
});

test("la frase dice la caída en positivo, con su dirección en palabras", () => {
  const hechos: Hechos = {
    productos: PRODUCTOS,
    ventas: [
      venta({ id: "v1", fecha: "2026-07-10", items: [{ total: 1100, producto_id: "p1" }] }),
      venta({ id: "v2", fecha: "2026-08-10", items: [{ total: 110, producto_id: "p1" }] }),
    ],
  };
  const d = descomponerVentas(hechos, AGOSTO, JULIO, "producto", "PYG");
  const texto = redactar(d, (n) => `Gs. ${n}`) as string;

  assert.match(texto, /la caída/);
  assert.doesNotMatch(texto, /-900/);
});

test("las ventas de otra moneda no entran: nunca se suman entre monedas", () => {
  const enDolares = { ...venta({ id: "v9", fecha: "2026-08-10", items: [{ total: 1000, producto_id: "p1" }] }), moneda: "USD" };
  const hechos: Hechos = {
    productos: PRODUCTOS,
    ventas: [venta({ id: "v1", fecha: "2026-08-10", items: [{ total: 110, producto_id: "p1" }] }), enDolares],
  };
  const d = descomponerVentas(hechos, AGOSTO, JULIO, "producto", "PYG");
  assert.equal(d.totalActual, 100);
});
