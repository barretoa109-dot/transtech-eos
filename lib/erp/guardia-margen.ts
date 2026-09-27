import type { ClienteSinTipos } from "../supabase/sin-tipos.ts";
import { formatearMonto } from "../finanzas/formato.ts";
import { requestIdDeAccion } from "../gateway/jobs.ts";
import { sumarDias } from "../fecha.ts";
import { VENTANA_DIAS, type ProductoAgotable, type SalidaDeStock } from "./agotamiento.ts";
import { avisoDeStockTrasVenta } from "./stock-tras-venta.ts";
import { estaPendiente, saldoDe, type DocumentoCartera } from "./cartera.ts";
import { leerCartera } from "./cartera-leer.ts";

/**
 * La guardia de margen (fila D4 de docs/estrategia/plan-diferenciacion-2026-09-27.md).
 *
 * Cuando una venta queda por debajo de lo que el producto le cuesta al
 * negocio, EOS lo dice EN LA MISMA RESPUESTA en que confirma la venta:
 *
 *     Ojo: “Zapatos Mary Jane” lo vendiste a ₲ 150.000 y te cuesta ₲ 160.000.
 *     Perdiste ₲ 10.000 en esta venta. Quedó registrada igual.
 *
 * Es uno de los "momentos imprescindibles" del plan: el dueño se entera en el
 * momento, no a fin de mes cuando ya vendió diez así. Ningún ERP con
 * formularios se lo dice mientras vende por WhatsApp.
 *
 * Reglas, todas deliberadas:
 *
 *  - AVISA, NO FRENA. La venta ya quedó registrada y así se queda: a veces se
 *    vende a pérdida a propósito (liquidar, un cliente especial). El dueño
 *    decide; EOS solo se asegura de que lo sepa.
 *  - SOLO CON COSTO DECLARADO. Un costo estimado (`costo_estimado`) o que no
 *    existe no dispara nada. Una falsa alarma de "estás perdiendo plata" hace
 *    más daño que el aviso que falta: después nadie le cree al verdadero.
 *  - EL COSTO ES EL DE LA LÍNEA, no el del catálogo de hoy. La línea congela
 *    el costo en el momento de vender (v100), que es contra el que se ganó o
 *    se perdió.
 *  - PRECIO Y COSTO SE COMPARAN CON LA MISMA TASA DE IVA, así que perder es
 *    exactamente precio < costo (lo mismo que `calcularMargen` en margen.ts).
 *  - NUNCA ROMPE LA RESPUESTA. Si la lectura falla, no hay aviso y la venta
 *    se confirma como siempre.
 */

export type LineaVendida = {
  descripcion: string;
  cantidad: number;
  precio_unitario: number;
  costo_unitario: number | null;
  costo_estimado: boolean | null;
  moneda: string;
};

export type LineaAPerdida = {
  descripcion: string;
  precio: number;
  costo: number;
  /** Lo que se perdió en toda la línea (por unidad × cantidad). */
  perdida: number;
  moneda: string;
};

export function lineasAPerdida(lineas: LineaVendida[]): LineaAPerdida[] {
  return lineas
    .filter((l) => {
      const costo = Number(l.costo_unitario);
      const precio = Number(l.precio_unitario);
      return (
        l.costo_estimado !== true &&
        Number.isFinite(costo) &&
        costo > 0 &&
        Number.isFinite(precio) &&
        precio < costo
      );
    })
    .map((l) => ({
      descripcion: l.descripcion,
      precio: Number(l.precio_unitario),
      costo: Number(l.costo_unitario),
      perdida: (Number(l.costo_unitario) - Number(l.precio_unitario)) * Number(l.cantidad || 1),
      moneda: l.moneda,
    }));
}

const dinero = (n: number, moneda: string) => formatearMonto(n, moneda);

/** El aviso, o "" si no hay nada que avisar. */
export function avisoDeVentaAPerdida(perdidas: LineaAPerdida[]): string {
  if (perdidas.length === 0) return "";

  if (perdidas.length === 1) {
    const p = perdidas[0];
    return (
      `Ojo: “${p.descripcion}” lo vendiste a ${dinero(p.precio, p.moneda)} y te cuesta ${dinero(p.costo, p.moneda)}. ` +
      `Perdiste ${dinero(p.perdida, p.moneda)} en esta venta. Quedó registrada igual.`
    );
  }

  const detalle = perdidas
    .map((p) => `“${p.descripcion}” (a ${dinero(p.precio, p.moneda)}, te cuesta ${dinero(p.costo, p.moneda)})`)
    .join(", ");

  // Solo se suma si es todo la misma moneda: guaraníes más dólares no es nada.
  const monedas = new Set(perdidas.map((p) => p.moneda));
  const total =
    monedas.size === 1
      ? ` Entre todos perdiste ${dinero(
          perdidas.reduce((s, p) => s + p.perdida, 0),
          perdidas[0].moneda,
        )}.`
      : "";

  return `Ojo: estos quedaron por debajo de lo que te cuestan: ${detalle}.${total} Las ventas quedaron registradas igual.`;
}

/**
 * Lee las ventas que dejó ESTE pedido y devuelve los avisos que corresponden
 * (margen y stock, ver `stock-tras-venta.ts`), o "".
 *
 * Encuentra las ventas por la orden que las creó (`action_command_id`) y la
 * orden por el `request_id` del mensaje: así solo mira lo que se acaba de
 * vender, no ventas viejas.
 *
 * Con varias ventas en un mismo mensaje, la primera orden lleva el
 * `request_id` del mensaje y las siguientes uno derivado
 * (`requestIdDeAccion`, en lib/gateway/jobs.ts). Por eso se pide cuántas
 * ventas hubo: con solo el id del mensaje, la segunda venta quedaba sin mirar.
 */
export async function avisosDeLaVenta(
  admin: ClienteSinTipos,
  usuarioId: string,
  requestId: string,
  opciones: { ventasEnElMensaje?: number; hoy: string },
): Promise<string> {
  const ventasEnElMensaje = opciones.ventasEnElMensaje ?? 1;
  const ids = Array.from({ length: Math.max(1, ventasEnElMensaje) }, (_, n) => requestIdDeAccion(requestId, n));

  const { data: ordenes, error: errOrdenes } = await admin
    .from("eos_action_commands")
    .select("id")
    .eq("usuario_id", usuarioId)
    .in("request_id", ids)
    .eq("accion", "REGISTRAR_VENTA")
    .eq("estado", "completada");

  if (errOrdenes) throw new Error(errOrdenes.message ?? "no se pudieron leer las órdenes");
  const ordenIds = ((ordenes ?? []) as { id: string }[]).map((o) => o.id);
  if (ordenIds.length === 0) return "";

  const { data: ventas, error: errVentas } = await admin
    .from("eos_erp_ventas")
    .select("id,moneda,condicion,contacto_id")
    .eq("usuario_id", usuarioId)
    .in("action_command_id", ordenIds)
    .neq("estado", "anulada");

  if (errVentas) throw new Error(errVentas.message ?? "no se pudieron leer las ventas");
  type Venta = { id: string; moneda: string | null; condicion: string | null; contacto_id: string | null };
  const vendidas = (ventas ?? []) as Venta[];
  const monedaDe = new Map(vendidas.map((v) => [v.id, v.moneda ?? "PYG"]));
  if (monedaDe.size === 0) return "";

  const { data: items, error: errItems } = await admin
    .from("eos_erp_venta_items")
    .select("venta_id,producto_id,descripcion,cantidad,precio_unitario,costo_unitario,costo_estimado")
    .in("venta_id", [...monedaDe.keys()]);

  if (errItems) throw new Error(errItems.message ?? "no se pudieron leer los ítems");

  type Fila = Omit<LineaVendida, "moneda"> & { venta_id: string; producto_id: string | null };
  const filas = (items ?? []) as Fila[];
  const lineas: LineaVendida[] = filas.map((i) => ({
    descripcion: i.descripcion,
    cantidad: Number(i.cantidad),
    precio_unitario: Number(i.precio_unitario),
    costo_unitario: i.costo_unitario === null ? null : Number(i.costo_unitario),
    costo_estimado: i.costo_estimado,
    moneda: monedaDe.get(i.venta_id) ?? "PYG",
  }));

  const margen = avisoDeVentaAPerdida(lineasAPerdida(lineas));

  // El stock, en su propio try: si falla, el aviso de margen igual sale.
  let stock = "";
  try {
    stock = await avisoDeStock(admin, usuarioId, opciones.hoy, filas);
  } catch (error) {
    console.error("EOS: no se pudo revisar el stock de la venta:", error instanceof Error ? error.message : error);
  }

  // Lo que ahora le debe cada cliente al que se le fió: también en su propio try.
  let deuda = "";
  const fiadoA = [
    ...new Set(vendidas.filter((v) => v.condicion === "credito" && v.contacto_id).map((v) => v.contacto_id as string)),
  ];
  if (fiadoA.length > 0) {
    try {
      const { documentos } = await leerCartera(admin, usuarioId, "cobrar");
      deuda = avisoDeDeudaTrasVenta(documentos, fiadoA);
    } catch (error) {
      console.error("EOS: no se pudo leer lo que debe el cliente:", error instanceof Error ? error.message : error);
    }
  }

  return [margen, stock, deuda].filter(Boolean).join("\n\n");
}

/**
 * Después de fiarle a alguien, cuánto debe EN TOTAL (fila D2: el dato que
 * importa). Es el número que el dueño no tiene en la cabeza cuando le vuelve
 * a fiar al mismo cliente. Sale de la cartera, igual que la pantalla: con los
 * pagos parciales descontados.
 */
export function avisoDeDeudaTrasVenta(documentos: DocumentoCartera[], contactos: string[]): string {
  const frases: string[] = [];
  for (const id of contactos) {
    const suyos = documentos.filter((d) => d.contacto_id === id && estaPendiente(d));
    if (suyos.length === 0) continue;
    const nombre = suyos[0].contacto_nombre ?? "Este cliente";
    // Por moneda: guaraníes y dólares no se suman.
    const porMoneda = new Map<string, number>();
    for (const d of suyos) porMoneda.set(d.moneda, (porMoneda.get(d.moneda) ?? 0) + saldoDe(d));
    const total = [...porMoneda.entries()].map(([m, t]) => formatearMonto(t, m)).join(" y ");
    frases.push(
      suyos.length === 1 ? `${nombre} te debe ${total} por esta venta.` : `Con esta, ${nombre} te debe ${total} en total.`,
    );
  }
  return frases.join(" ");
}

async function avisoDeStock(
  admin: ClienteSinTipos,
  usuarioId: string,
  hoy: string,
  filas: { producto_id: string | null; cantidad: number }[],
): Promise<string> {
  const vendidos = new Map<string, number>();
  for (const f of filas) {
    if (!f.producto_id) continue;
    vendidos.set(f.producto_id, (vendidos.get(f.producto_id) ?? 0) + Number(f.cantidad));
  }
  if (vendidos.size === 0) return "";

  const [productos, salidas] = await Promise.all([
    admin
      .from("eos_erp_productos")
      .select("id,nombre,stock_actual,stock_minimo,controla_stock,activo")
      .eq("usuario_id", usuarioId)
      .in("id", [...vendidos.keys()]),
    admin
      .from("eos_erp_movimientos_stock")
      .select("producto_id,fecha,cantidad")
      .eq("usuario_id", usuarioId)
      .eq("tipo", "salida")
      .in("producto_id", [...vendidos.keys()])
      .gte("fecha", sumarDias(hoy, -VENTANA_DIAS))
      .limit(5000),
  ]);

  if (productos.error) throw new Error(productos.error.message ?? "no se pudieron leer los productos");
  if (salidas.error) throw new Error(salidas.error.message ?? "no se pudieron leer las salidas");

  return avisoDeStockTrasVenta({
    hoy,
    vendidos,
    productos: ((productos.data ?? []) as ProductoAgotable[]).map((p) => ({
      ...p,
      stock_actual: Number(p.stock_actual ?? 0),
      stock_minimo: Number(p.stock_minimo ?? 0),
    })),
    salidas: ((salidas.data ?? []) as SalidaDeStock[]).map((s) => ({ ...s, cantidad: Number(s.cantidad ?? 0) })),
  });
}
