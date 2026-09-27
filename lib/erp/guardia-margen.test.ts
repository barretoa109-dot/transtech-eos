import assert from "node:assert/strict";
import { test } from "node:test";

import {
  avisoDeDeudaTrasVenta,
  avisosDeLaVenta,
  avisoDeVentaAPerdida,
  lineasAPerdida,
  type LineaVendida,
} from "./guardia-margen.ts";
import type { ClienteSinTipos } from "../supabase/sin-tipos.ts";
import { requestIdDeAccion } from "../gateway/jobs.ts";

const linea = (p: Partial<LineaVendida>): LineaVendida => ({
  descripcion: "Zapatos Mary Jane",
  cantidad: 1,
  precio_unitario: 150_000,
  costo_unitario: 160_000,
  costo_estimado: false,
  moneda: "PYG",
  ...p,
});

test("una venta por debajo del costo declarado se avisa, con la pérdida de la línea", () => {
  const aviso = avisoDeVentaAPerdida(lineasAPerdida([linea({ cantidad: 2 })]));

  assert.equal(
    aviso,
    "Ojo: “Zapatos Mary Jane” lo vendiste a ₲ 150.000 y te cuesta ₲ 160.000. Perdiste ₲ 20.000 en esta venta. Quedó registrada igual.",
  );
});

test("sin costo, con costo estimado, o vendiendo al costo o arriba: silencio", () => {
  assert.deepEqual(
    lineasAPerdida([
      linea({ costo_unitario: null }),
      linea({ costo_unitario: 0 }),
      linea({ costo_estimado: true }),
      linea({ precio_unitario: 160_000 }),
      linea({ precio_unitario: 180_000 }),
    ]),
    [],
  );
  assert.equal(avisoDeVentaAPerdida([]), "");
});

test("varias líneas a pérdida van en un solo aviso, con el total si es la misma moneda", () => {
  const aviso = avisoDeVentaAPerdida(
    lineasAPerdida([
      linea({}),
      linea({ descripcion: "Pantalón", precio_unitario: 100_000, costo_unitario: 116_000 }),
      linea({ descripcion: "Remera", precio_unitario: 90_000, costo_unitario: 50_000 }),
    ]),
  );

  assert.ok(aviso.includes("“Zapatos Mary Jane” (a ₲ 150.000, te cuesta ₲ 160.000)"));
  assert.ok(aviso.includes("“Pantalón” (a ₲ 100.000, te cuesta ₲ 116.000)"));
  assert.ok(!aviso.includes("Remera"));
  assert.ok(aviso.includes("Entre todos perdiste ₲ 26.000."));
  assert.ok(aviso.endsWith("Las ventas quedaron registradas igual."));
});

test("con monedas distintas no se suma un total", () => {
  const aviso = avisoDeVentaAPerdida(
    lineasAPerdida([linea({}), linea({ descripcion: "Importado", moneda: "USD", precio_unitario: 10, costo_unitario: 12 })]),
  );
  assert.ok(!aviso.includes("Entre todos"));
});

// ---------------------------------------------------------------------------
// La lectura: solo las ventas de ESTE pedido, y de esta cuenta
// ---------------------------------------------------------------------------

function baseFalsa(tablas: Record<string, Record<string, unknown>[]>) {
  const consultas: { tabla: string; filtros: [string, string, unknown][] }[] = [];

  const cliente = {
    // `empresaDe` (eos_empresa_de_v109): todas las cuentas de prueba son de "emp1".
    rpc: async () => ({ data: "emp1", error: null }),
    from(tabla: string) {
      const filtros: [string, string, unknown][] = [];
      consultas.push({ tabla, filtros });
      const q = {
        select: () => q,
        eq: (c: string, v: unknown) => (filtros.push(["eq", c, v]), q),
        neq: (c: string, v: unknown) => (filtros.push(["neq", c, v]), q),
        in: (c: string, v: unknown[]) => (filtros.push(["in", c, v]), q),
        gte: () => q,
        limit: () => q,
        order: () => q,
        // filtroDeEmpresa: "empresa_id.eq.<id>"
        or: (expr: string) => {
          const m = /^(\w+)\.eq\.(.+)$/.exec(expr);
          if (m) filtros.push(["eq", m[1], m[2]]);
          return q;
        },
        then: (ok: (r: unknown) => unknown) => {
          const filas = (tablas[tabla] ?? []).filter((f) =>
            filtros.every(([op, c, v]) =>
              op === "eq" ? f[c] === v : op === "neq" ? f[c] !== v : (v as unknown[]).includes(f[c]),
            ),
          );
          return Promise.resolve({ data: filas, error: null }).then(ok);
        },
      };
      return q;
    },
  };

  return { cliente: cliente as unknown as ClienteSinTipos, consultas };
}

test("lee solo la venta del pedido actual y avisa", async () => {
  const { cliente, consultas } = baseFalsa({
    eos_action_commands: [
      { id: "c1", usuario_id: "u1", request_id: "r1", accion: "REGISTRAR_VENTA", estado: "completada" },
      { id: "c0", usuario_id: "u1", request_id: "r0", accion: "REGISTRAR_VENTA", estado: "completada" },
    ],
    eos_erp_ventas: [
      { id: "v1", usuario_id: "u1", action_command_id: "c1", estado: "emitida", moneda: "PYG" },
      { id: "v0", usuario_id: "u1", action_command_id: "c0", estado: "emitida", moneda: "PYG" },
    ],
    eos_erp_venta_items: [
      { venta_id: "v1", descripcion: "Balanceado", cantidad: 3, precio_unitario: 150_000, costo_unitario: 160_000, costo_estimado: false },
      { venta_id: "v0", descripcion: "Venta vieja", cantidad: 1, precio_unitario: 1, costo_unitario: 999, costo_estimado: false },
    ],
  });

  const aviso = await avisosDeLaVenta(cliente, "u1", "r1", { hoy: "2026-09-27" });

  assert.ok(aviso.includes("“Balanceado”"));
  assert.ok(aviso.includes("Perdiste ₲ 30.000"));
  assert.ok(!aviso.includes("Venta vieja"));
  // Toda lectura de órdenes y ventas va acotada a la cuenta.
  for (const c of consultas.filter((c) => c.tabla !== "eos_erp_venta_items")) {
    assert.ok(c.filtros.some(([op, col, v]) => op === "eq" && col === "usuario_id" && v === "u1"), c.tabla);
  }
});

test("con dos ventas en el mismo mensaje también mira la segunda (request_id derivado)", async () => {
  const r1 = "3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b";
  const segunda = requestIdDeAccion(r1, 1);
  const { cliente } = baseFalsa({
    eos_action_commands: [
      { id: "c1", usuario_id: "u1", request_id: r1, accion: "REGISTRAR_VENTA", estado: "completada" },
      { id: "c2", usuario_id: "u1", request_id: segunda, accion: "REGISTRAR_VENTA", estado: "completada" },
    ],
    eos_erp_ventas: [
      { id: "v1", usuario_id: "u1", action_command_id: "c1", estado: "emitida", moneda: "PYG" },
      { id: "v2", usuario_id: "u1", action_command_id: "c2", estado: "emitida", moneda: "PYG" },
    ],
    eos_erp_venta_items: [
      { venta_id: "v1", descripcion: "Bien", cantidad: 1, precio_unitario: 200, costo_unitario: 100, costo_estimado: false },
      { venta_id: "v2", descripcion: "Segunda", cantidad: 1, precio_unitario: 100, costo_unitario: 120, costo_estimado: false },
    ],
  });

  assert.equal(await avisosDeLaVenta(cliente, "u1", r1, { ventasEnElMensaje: 1, hoy: "2026-09-27" }), "");
  assert.ok((await avisosDeLaVenta(cliente, "u1", r1, { ventasEnElMensaje: 2, hoy: "2026-09-27" })).includes("“Segunda”"));
});

test("sin venta completada en el pedido no hay aviso ni más lecturas", async () => {
  const { cliente, consultas } = baseFalsa({ eos_action_commands: [] });

  assert.equal(await avisosDeLaVenta(cliente, "u1", "r1", { hoy: "2026-09-27" }), "");
  assert.equal(consultas.length, 1);
});

test("una venta a pérdida que además vacía el stock trae los dos avisos, margen primero", async () => {
  const { cliente } = baseFalsa({
    eos_action_commands: [
      { id: "c1", usuario_id: "u1", request_id: "r1", accion: "REGISTRAR_VENTA", estado: "completada" },
    ],
    eos_erp_ventas: [{ id: "v1", usuario_id: "u1", action_command_id: "c1", estado: "emitida", moneda: "PYG" }],
    eos_erp_venta_items: [
      {
        venta_id: "v1",
        producto_id: "p1",
        descripcion: "Balanceado",
        cantidad: 2,
        precio_unitario: 150_000,
        costo_unitario: 160_000,
        costo_estimado: false,
      },
    ],
    eos_erp_productos: [
      {
        id: "p1",
        usuario_id: "u1",
        nombre: "Balanceado",
        stock_actual: 0,
        stock_minimo: 0,
        controla_stock: true,
        activo: true,
      },
    ],
    eos_erp_movimientos_stock: [],
  });

  const aviso = await avisosDeLaVenta(cliente, "u1", "r1", { hoy: "2026-09-27" });

  assert.equal(
    aviso,
    "Ojo: “Balanceado” lo vendiste a ₲ 150.000 y te cuesta ₲ 160.000. Perdiste ₲ 20.000 en esta venta. Quedó registrada igual." +
      "\n\nTe quedaste sin “Balanceado”: esa era la última.",
  );
});

// ---------------------------------------------------------------------------
// D2: después de fiar, cuánto debe el cliente en total
// ---------------------------------------------------------------------------

const deuda = (p: Record<string, unknown>) => ({
  id: String(Math.random()),
  fecha: "2026-09-20",
  vence_el: null,
  moneda: "PYG",
  total: 540_000,
  cobrado: 0,
  contacto_id: "juan",
  contacto_nombre: "Juan Pérez",
  ...p,
});

test("con una sola deuda dice cuánto debe por esta venta", () => {
  assert.equal(avisoDeDeudaTrasVenta([deuda({})], ["juan"]), "Juan Pérez te debe ₲ 540.000 por esta venta.");
});

test("con deudas anteriores dice el total, con los pagos parciales descontados", () => {
  const texto = avisoDeDeudaTrasVenta(
    [deuda({}), deuda({ total: 1_000_000, cobrado: 100_000 }), deuda({ contacto_id: "otro", total: 5 })],
    ["juan"],
  );
  assert.equal(texto, "Con esta, Juan Pérez te debe ₲ 1.440.000 en total.");
});

test("una venta fiada suma la línea de deuda en la respuesta", async () => {
  const { cliente } = baseFalsa({
    eos_action_commands: [
      { id: "c1", usuario_id: "u1", request_id: "r1", accion: "REGISTRAR_VENTA", estado: "completada" },
    ],
    eos_erp_ventas: [
      {
        id: "v1",
        usuario_id: "u1",
        empresa_id: "emp1",
        action_command_id: "c1",
        estado: "emitida",
        condicion: "credito",
        contacto_id: "juan",
        moneda: "PYG",
        fecha: "2026-09-27",
        vence_el: null,
        total: 540_000,
        movimiento_id: null,
        contacto: { id: "juan", nombre: "Juan Pérez" },
      },
      {
        id: "v0",
        usuario_id: "u1",
        empresa_id: "emp1",
        action_command_id: "c0",
        estado: "emitida",
        condicion: "credito",
        contacto_id: "juan",
        moneda: "PYG",
        fecha: "2026-09-10",
        vence_el: null,
        total: 900_000,
        movimiento_id: null,
        contacto: { id: "juan", nombre: "Juan Pérez" },
      },
    ],
    eos_erp_venta_items: [
      { venta_id: "v1", producto_id: null, descripcion: "Balanceado", cantidad: 3, precio_unitario: 180_000, costo_unitario: 140_000, costo_estimado: false },
    ],
    eos_erp_cuenta_movimientos_v107: [
      { id: "p1", empresa_id: "emp1", venta_id: "v0", monto: 300_000, moneda: "PYG", fecha: "2026-09-15" },
    ],
  });

  const aviso = await avisosDeLaVenta(cliente, "u1", "r1", { hoy: "2026-09-27" });
  // 540.000 de hoy + 600.000 que le quedaba de la anterior.
  assert.equal(aviso, "Con esta, Juan Pérez te debe ₲ 1.140.000 en total.");
});
