import assert from "node:assert/strict";
import test from "node:test";

import {
  detectarRiesgosNegocio,
  redactarRiesgoNegocio,
  type ProductoStock,
  type VentaACobrar,
} from "./riesgos-negocio.ts";
import { formatearMonto } from "../finanzas/formato.ts";

const HOY = "2026-08-31";

function producto(parcial: Partial<ProductoStock> & { id: string }): ProductoStock {
  return {
    nombre: `Producto ${parcial.id}`,
    stock_actual: 10,
    stock_minimo: 3,
    controla_stock: true,
    activo: true,
    ...parcial,
  };
}

function venta(parcial: Partial<VentaACobrar> & { id: string }): VentaACobrar {
  return { fecha: "2026-08-01", total: 100_000, moneda: "PYG", ...parcial };
}

// ============================================================
// Que no avise cuando no pasa nada
// ============================================================
//
// Es la respuesta más frecuente y la más importante: un detector que encuentra
// algo todos los días es ruido.

test("sin nada abajo del mínimo y sin cobros viejos, no hay riesgos", () => {
  const riesgos = detectarRiesgosNegocio({
    hoy: HOY,
    productos: [producto({ id: "a" }), producto({ id: "b", stock_actual: 4, stock_minimo: 3 })],
    ventasACobrar: [venta({ id: "v1", fecha: "2026-08-25" })],
  });

  assert.deepEqual(riesgos, []);
});

test("un servicio no puede faltar, aunque su saldo diga cero", () => {
  const riesgos = detectarRiesgosNegocio({
    hoy: HOY,
    productos: [producto({ id: "s", stock_actual: 0, controla_stock: false })],
    ventasACobrar: [],
  });

  assert.deepEqual(riesgos, []);
});

test("un producto dado de baja no genera aviso", () => {
  const riesgos = detectarRiesgosNegocio({
    hoy: HOY,
    productos: [producto({ id: "x", stock_actual: 0, activo: false })],
    ventasACobrar: [],
  });

  assert.deepEqual(riesgos, []);
});

// ============================================================
// Inventario bajo
// ============================================================

test("avisa de lo que está en el mínimo o por debajo, lo más urgente primero", () => {
  const riesgos = detectarRiesgosNegocio({
    hoy: HOY,
    productos: [
      producto({ id: "a", nombre: "Harina", stock_actual: 3, stock_minimo: 3 }),
      producto({ id: "b", nombre: "Levadura", stock_actual: 0, stock_minimo: 2 }),
      producto({ id: "c", nombre: "Azúcar", stock_actual: 50 }),
    ],
    ventasACobrar: [],
  });

  assert.equal(riesgos.length, 1);
  const bajo = riesgos[0];
  if (bajo.tipo !== "inventario_bajo") return assert.fail("tipo equivocado");

  assert.deepEqual(
    bajo.productos.map((p) => p.nombre),
    ["Levadura", "Harina"],
  );
});

test("solo se nombran cinco, pero la clave los cuenta a todos", () => {
  const muchos = Array.from({ length: 8 }, (_, i) =>
    producto({ id: `p${i}`, stock_actual: 0, stock_minimo: 1 }),
  );

  const riesgos = detectarRiesgosNegocio({ hoy: HOY, productos: muchos, ventasACobrar: [] });
  const bajo = riesgos[0];
  if (bajo.tipo !== "inventario_bajo") return assert.fail("tipo equivocado");

  assert.equal(bajo.productos.length, 5);
  assert.equal(bajo.clave.split(",").length, 8);
});

// ============================================================
// La clave es lo que frena la repetición
// ============================================================

test("los mismos productos dan la misma clave, en cualquier orden", () => {
  const a = producto({ id: "a", stock_actual: 0, stock_minimo: 1 });
  const b = producto({ id: "b", stock_actual: 0, stock_minimo: 1 });

  const uno = detectarRiesgosNegocio({ hoy: HOY, productos: [a, b], ventasACobrar: [] })[0];
  const otro = detectarRiesgosNegocio({ hoy: HOY, productos: [b, a], ventasACobrar: [] })[0];

  assert.equal(uno.clave, otro.clave);
});

test("un producto nuevo en la lista sí cambia la clave: eso es una noticia", () => {
  const a = producto({ id: "a", stock_actual: 0, stock_minimo: 1 });
  const b = producto({ id: "b", stock_actual: 0, stock_minimo: 1 });

  const antes = detectarRiesgosNegocio({ hoy: HOY, productos: [a], ventasACobrar: [] })[0];
  const despues = detectarRiesgosNegocio({ hoy: HOY, productos: [a, b], ventasACobrar: [] })[0];

  assert.notEqual(antes.clave, despues.clave);
});

// ============================================================
// Cobros demorados
// ============================================================

test("una venta de hace menos de treinta días todavía no es noticia", () => {
  const riesgos = detectarRiesgosNegocio({
    hoy: HOY,
    productos: [],
    ventasACobrar: [venta({ id: "v", fecha: "2026-08-10" })],
  });

  assert.deepEqual(riesgos, []);
});

test("avisa de las que pasaron el plazo, con la más vieja adelante", () => {
  const riesgos = detectarRiesgosNegocio({
    hoy: HOY,
    productos: [],
    ventasACobrar: [
      venta({ id: "v1", fecha: "2026-07-01", total: 500_000 }),
      venta({ id: "v2", fecha: "2026-07-15", total: 300_000 }),
      venta({ id: "v3", fecha: "2026-08-29", total: 900_000 }),
    ],
  });

  assert.equal(riesgos.length, 1);
  const cobros = riesgos[0];
  if (cobros.tipo !== "cobros_demorados") return assert.fail("tipo equivocado");

  assert.equal(cobros.cantidad, 2);
  assert.equal(cobros.total, 800_000);
  assert.equal(cobros.dias_de_la_mas_vieja, 61);
});

test("cada moneda tiene su propio aviso: no se suman", () => {
  const riesgos = detectarRiesgosNegocio({
    hoy: HOY,
    productos: [],
    ventasACobrar: [
      venta({ id: "a", fecha: "2026-07-01", total: 5_000_000, moneda: "PYG" }),
      venta({ id: "b", fecha: "2026-07-01", total: 400, moneda: "USD" }),
    ],
  });

  assert.equal(riesgos.length, 2);

  const totales = riesgos.map((r) => (r.tipo === "cobros_demorados" ? r.total : 0));
  assert.ok(totales.includes(5_000_000));
  assert.ok(totales.includes(400));
  // El número que no puede existir.
  assert.ok(!totales.includes(5_000_400));
});

// ============================================================
// Con vencimiento real (v168): se usa ESE, no el plazo de respaldo
// ============================================================

test("con vencimiento pactado, vencida es la que YA venció, no la de 30 días", () => {
  // Vendida hace 5 días, pero con 20 días de plazo: todavía no debería avisar
  // aunque una venta sin vencimiento de la misma antigüedad tampoco avisaría.
  const riesgos = detectarRiesgosNegocio({
    hoy: HOY,
    productos: [],
    ventasACobrar: [venta({ id: "v", fecha: "2026-08-26", vence_el: "2026-09-15" })],
  });

  assert.deepEqual(riesgos, []);
});

test("con vencimiento pactado, vencida apenas pasa un día del plazo — no espera 30", () => {
  // Vendida hace apenas 3 días: el respaldo de 30 nunca la marcaría. Pero
  // pactaron que vencía ayer, así que HOY sí es noticia.
  const riesgos = detectarRiesgosNegocio({
    hoy: HOY,
    productos: [],
    ventasACobrar: [venta({ id: "v", fecha: "2026-08-28", vence_el: "2026-08-30" })],
  });

  assert.equal(riesgos.length, 1);
  const cobros = riesgos[0];
  if (cobros.tipo !== "cobros_demorados") return assert.fail("tipo equivocado");
  assert.equal(cobros.dias_de_la_mas_vieja, 1);
});

test("sin vencimiento pactado, sigue el respaldo de 30 días de siempre", () => {
  const riesgos = detectarRiesgosNegocio({
    hoy: HOY,
    productos: [],
    ventasACobrar: [venta({ id: "v", fecha: "2026-07-01", vence_el: null })],
  });

  assert.equal(riesgos.length, 1);
});

test("una venta vencida y otra sin vencimiento reciente se combinan bien", () => {
  const riesgos = detectarRiesgosNegocio({
    hoy: HOY,
    productos: [],
    ventasACobrar: [
      venta({ id: "vencida", fecha: "2026-08-20", vence_el: "2026-08-25", total: 200_000 }),
      venta({ id: "reciente", fecha: "2026-08-29", total: 300_000 }), // sin vence_el, hace 2 días: no cuenta
    ],
  });

  assert.equal(riesgos.length, 1);
  const cobros = riesgos[0];
  if (cobros.tipo !== "cobros_demorados") return assert.fail("tipo equivocado");
  assert.equal(cobros.cantidad, 1);
  assert.equal(cobros.total, 200_000);
});

// ============================================================
// El texto tiene que servir para actuar
// ============================================================

test("el aviso de stock nombra el producto y sus dos números", () => {
  const riesgo = detectarRiesgosNegocio({
    hoy: HOY,
    productos: [producto({ id: "a", nombre: "Harina", stock_actual: 1, stock_minimo: 5 })],
    ventasACobrar: [],
  })[0];

  const texto = redactarRiesgoNegocio(riesgo, formatearMonto);

  assert.match(texto, /Harina/);
  assert.match(texto, /1 de 5/);
});

test("el aviso de cobros dice cuánto y desde hace cuánto", () => {
  const riesgo = detectarRiesgosNegocio({
    hoy: HOY,
    productos: [],
    ventasACobrar: [venta({ id: "v", fecha: "2026-07-01", total: 1_200_000 })],
  })[0];

  const texto = redactarRiesgoNegocio(riesgo, formatearMonto);

  assert.match(texto, /Una venta a crédito lleva/);
  assert.match(texto, /1\.200\.000/);
  assert.match(texto, /61 días/);
});

test("sin historial de gastos, el riesgo de gasto anormal ni existe", () => {
  // Los dos campos son opcionales a propósito: quien no los pase no obtiene
  // un aviso vacío, obtiene ninguno.
  const riesgos = detectarRiesgosNegocio({ hoy: HOY, productos: [], ventasACobrar: [] });

  assert.equal(riesgos.some((r) => r.tipo === "gasto_anormal"), false);
});

test("dos gastos raros del mismo mes son UN aviso, no dos", () => {
  /*
   * Dos avisos separados el mismo día se leen como dos problemas, y son el
   * mismo mes raro. Es la misma decisión que ya tomaba el inventario bajo:
   * una lista adentro de un aviso.
   */
  const previos = [
    "2026-06-05", "2026-06-20", "2026-07-08",
    "2026-07-22", "2026-08-11", "2026-08-27",
  ].map((fecha, i) => ({
    id: `p${i}`,
    fecha,
    monto: 200_000,
    moneda: "PYG",
    categoria: "insumos",
    descripcion: "compra",
  }));

  const riesgos = detectarRiesgosNegocio({
    hoy: HOY,
    productos: [],
    ventasACobrar: [],
    gastos: [
      ...previos,
      { id: "raro-1", fecha: "2026-09-02", monto: 4_000_000, moneda: "PYG", categoria: "insumos", descripcion: "vitrinas" },
      { id: "raro-2", fecha: "2026-09-09", monto: 9_000_000, moneda: "PYG", categoria: "obras", descripcion: "reforma" },
    ],
  });

  const anormal = riesgos.filter((r) => r.tipo === "gasto_anormal");
  assert.equal(anormal.length, 1);

  // "obras" no tiene historial propio, así que solo entra el de insumos.
  assert.equal(anormal[0].tipo === "gasto_anormal" && anormal[0].gastos.length, 1);
  assert.equal(anormal[0].clave, "raro-1");
});

// ============================================================
// Stock por agotarse: el ritmo, no solo el mínimo
// ============================================================

test("con salidas reales avisa del que se agota antes de bajar del mínimo", () => {
  const riesgos = detectarRiesgosNegocio({
    hoy: HOY,
    productos: [producto({ id: "harina", nombre: "Harina", stock_actual: 8, stock_minimo: 2 })],
    ventasACobrar: [],
    salidasStock: Array.from({ length: 6 }, (_, i) => ({
      producto_id: "harina",
      fecha: `2026-08-${String(30 - i).padStart(2, "0")}`,
      cantidad: 5,
    })),
  });

  assert.equal(riesgos.length, 1);
  assert.equal(riesgos[0].tipo, "stock_por_agotarse");

  const texto = redactarRiesgoNegocio(riesgos[0], formatearMonto);
  assert.match(texto, /Harina tiene 8 unidades/);
  assert.match(texto, /unos 8 días/);
  assert.match(texto, /reposición como tarea/);
});

test("sin salidas no inventa un ritmo: no hay aviso de agotamiento", () => {
  const riesgos = detectarRiesgosNegocio({
    hoy: HOY,
    productos: [producto({ id: "harina", stock_actual: 8, stock_minimo: 2 })],
    ventasACobrar: [],
  });

  assert.deepEqual(riesgos, []);
});

test("el bajo el mínimo sale como inventario_bajo y NO también como agotamiento", () => {
  const riesgos = detectarRiesgosNegocio({
    hoy: HOY,
    productos: [producto({ id: "harina", stock_actual: 2, stock_minimo: 3 })],
    ventasACobrar: [],
    salidasStock: Array.from({ length: 6 }, (_, i) => ({
      producto_id: "harina",
      fecha: `2026-08-${String(30 - i).padStart(2, "0")}`,
      cantidad: 5,
    })),
  });

  assert.deepEqual(
    riesgos.map((r) => r.tipo),
    ["inventario_bajo"],
  );
});

test("la clave del agotamiento cambia si cambia qué productos se acaban", () => {
  const con = (ids: string[]) =>
    detectarRiesgosNegocio({
      hoy: HOY,
      productos: ids.map((id) => producto({ id, stock_actual: 8, stock_minimo: 2 })),
      ventasACobrar: [],
      salidasStock: ids.flatMap((id) =>
        Array.from({ length: 6 }, (_, i) => ({
          producto_id: id,
          fecha: `2026-08-${String(30 - i).padStart(2, "0")}`,
          cantidad: 5,
        })),
      ),
    })[0];

  assert.notEqual(con(["a"]).clave, con(["a", "b"]).clave);
  assert.equal(con(["b", "a"]).clave, con(["a", "b"]).clave);
});
