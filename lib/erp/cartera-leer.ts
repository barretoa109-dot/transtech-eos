import type { ClienteSinTipos } from "../supabase/sin-tipos.ts";
import { empresaDe, filtroDeEmpresa } from "../empresa/acceso.ts";
import { monedaConocida } from "../finanzas/monedas.ts";
import { cobradoEfectivo, type DocumentoCartera } from "./cartera.ts";

/**
 * La cartera leída de la base, en UN solo lugar.
 *
 * Antes la leía solo la pantalla (`app/api/erp/cartera`). Cuando el chat y el
 * Informe de impacto empezaron a decir "te deben ₲ X", lo calculaban por su
 * cuenta sumando el total de las ventas a crédito, y se equivocaban de dos
 * formas que la pantalla ya tenía resueltas:
 *
 *  - PAGOS PARCIALES (v107). Un cliente que pagó la mitad debe la mitad, no
 *    el total. Sumar totales decía que te debían de más.
 *  - LA EMPRESA, NO EL USUARIO (v109/v110). La cartera es de la empresa: si
 *    vende un miembro del equipo, esa venta también se debe.
 *
 * Dos números distintos para "cuánto me deben" en la misma cuenta hacen que la
 * persona no le crea a ninguno. Por eso todos leen de acá.
 *
 * Lanza si alguna lectura falla: una cartera sin las cobranzas saldría con
 * los saldos iguales al total, o sea mal, y es mejor no responder que
 * responder una cartera inflada.
 */

export type CarteraLeida = {
  documentos: DocumentoCartera[];
  /** Las filas de cobros o pagos parciales, para el DSO de la pantalla. */
  cobranzas: Record<string, unknown>[];
};

export async function leerCartera(
  admin: ClienteSinTipos,
  usuarioId: string,
  tipo: "cobrar" | "pagar",
): Promise<CarteraLeida> {
  const esVenta = tipo === "cobrar";
  const tabla = esVenta ? "eos_erp_ventas" : "eos_erp_compras";
  const columna = esVenta ? "venta_id" : "compra_id";

  // Las dos fronteras mientras dure la transición de la v109/v110.
  const empresaId = await empresaDe(admin, usuarioId);

  const [documentosRes, cobranzasRes] = await Promise.all([
    admin
      .from(tabla)
      .select("id,fecha,vence_el,moneda,total,estado,movimiento_id,contacto:eos_crm_contactos(id,nombre)")
      .or(filtroDeEmpresa(usuarioId, empresaId))
      .neq("estado", "anulada")
      .order("fecha", { ascending: false })
      .limit(1000),
    admin
      .from("eos_erp_cuenta_movimientos_v107")
      .select("id,venta_id,compra_id,monto,moneda,fecha")
      .or(filtroDeEmpresa(usuarioId, empresaId))
      .limit(5000),
  ]);

  if (documentosRes.error) {
    throw new Error(`no se pudo leer la cartera: ${documentosRes.error.message ?? "desconocido"}`);
  }
  if (cobranzasRes.error) {
    throw new Error(`no se pudieron leer las cobranzas: ${cobranzasRes.error.message ?? "desconocido"}`);
  }

  const cobranzas = (cobranzasRes.data ?? []) as Record<string, unknown>[];

  const cobradoPorDocumento = new Map<string, number>();
  for (const c of cobranzas) {
    const clave = c[columna] as string | null;
    if (!clave) continue;
    cobradoPorDocumento.set(clave, (cobradoPorDocumento.get(clave) ?? 0) + Number(c.monto ?? 0));
  }

  const documentos: DocumentoCartera[] = ((documentosRes.data ?? []) as Record<string, unknown>[]).map((d) => ({
    id: String(d.id),
    fecha: String(d.fecha),
    vence_el: (d.vence_el as string | null) ?? null,
    moneda: monedaConocida(d.moneda as string | null),
    total: Number(d.total ?? 0),
    // Lo saldado de una vez (contado, o cobrado/pagado entero) no deja filas
    // de pagos parciales: ver `cobradoEfectivo`.
    cobrado: cobradoEfectivo({
      estado: d.estado as string | null,
      movimiento_id: d.movimiento_id as string | null,
      total: Number(d.total ?? 0),
      cobrado: cobradoPorDocumento.get(String(d.id)) ?? 0,
    }),
    contacto_id: (d.contacto as { id?: string } | null)?.id ?? null,
    contacto_nombre: (d.contacto as { nombre?: string } | null)?.nombre ?? null,
  }));

  return { documentos, cobranzas };
}
