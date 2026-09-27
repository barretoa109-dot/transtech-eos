import type { ClienteSinTipos } from "../supabase/sin-tipos.ts";
import { formatearMonto } from "../finanzas/formato.ts";
import { requestIdDeAccion } from "../gateway/jobs.ts";

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
 * Lee las ventas que dejó ESTE pedido y devuelve el aviso, o "".
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
export async function avisoDeMargenDelPedido(
  admin: ClienteSinTipos,
  usuarioId: string,
  requestId: string,
  ventasEnElMensaje = 1,
): Promise<string> {
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
    .select("id,moneda")
    .eq("usuario_id", usuarioId)
    .in("action_command_id", ordenIds)
    .neq("estado", "anulada");

  if (errVentas) throw new Error(errVentas.message ?? "no se pudieron leer las ventas");
  const monedaDe = new Map(((ventas ?? []) as { id: string; moneda: string | null }[]).map((v) => [v.id, v.moneda ?? "PYG"]));
  if (monedaDe.size === 0) return "";

  const { data: items, error: errItems } = await admin
    .from("eos_erp_venta_items")
    .select("venta_id,descripcion,cantidad,precio_unitario,costo_unitario,costo_estimado")
    .in("venta_id", [...monedaDe.keys()]);

  if (errItems) throw new Error(errItems.message ?? "no se pudieron leer los ítems");

  type Fila = Omit<LineaVendida, "moneda"> & { venta_id: string };
  const lineas: LineaVendida[] = ((items ?? []) as Fila[]).map((i) => ({
    descripcion: i.descripcion,
    cantidad: Number(i.cantidad),
    precio_unitario: Number(i.precio_unitario),
    costo_unitario: i.costo_unitario === null ? null : Number(i.costo_unitario),
    costo_estimado: i.costo_estimado,
    moneda: monedaDe.get(i.venta_id) ?? "PYG",
  }));

  return avisoDeVentaAPerdida(lineasAPerdida(lineas));
}
