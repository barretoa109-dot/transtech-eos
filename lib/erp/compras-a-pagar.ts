import type { ClienteSinTipos } from "../supabase/sin-tipos.ts";
import type { CompraAPagar } from "./pagos-proveedores.ts";

/** Una PYME no tiene mil compras a crédito abiertas con fecha; si las tiene, se avisa de las primeras. */
const MAX_COMPRAS = 500;

/**
 * Las compras a crédito con vencimiento que todavía no se pagaron del todo,
 * con lo que ya se pagó de cada una.
 *
 * Lo usan el panel (`/api/kpi/hallazgos`) y el aviso proactivo
 * (`lib/erp/avisar-negocio.ts`): una sola lectura para los dos, porque si cada
 * uno armara la suya, el aviso podría no coincidir con lo que se ve al entrar.
 *
 * DE QUIÉN SON LOS DATOS: `usuario_id` es un parámetro obligatorio y se aplica
 * como filtro en las dos consultas. Se lee con la clave de servicio, así que ese
 * filtro escrito a mano es la única frontera (ver `scripts/rutas-con-alcance.mjs`).
 *
 * Devuelve `null` si no pudo leer: quien llama NO debe tratarlo como "no hay
 * pagos pendientes", sino saltear este aviso. Callar por un error de lectura es
 * incómodo; decir "todo al día" con la deuda sin mirar es peor.
 */
export async function leerComprasAPagar(
  admin: ClienteSinTipos,
  usuarioId: string,
): Promise<CompraAPagar[] | null> {
  const { data: compras, error } = await admin
    .from("eos_erp_compras")
    .select("id,total,moneda,vence_el")
    .eq("usuario_id", usuarioId)
    .eq("condicion", "credito")
    .not("estado", "in", '("anulada","pagada")')
    .not("vence_el", "is", null)
    .order("vence_el", { ascending: true })
    .limit(MAX_COMPRAS);

  if (error) {
    console.error("Pagos a proveedores: no se pudieron leer las compras:", error);
    return null;
  }

  const filas = (compras ?? []) as { id: string; total: number | string; moneda: string | null; vence_el: string | null }[];
  if (filas.length === 0) return [];

  const { data: pagos, error: errorPagos } = await admin
    .from("eos_erp_cuenta_movimientos_v107")
    .select("compra_id,monto")
    .eq("usuario_id", usuarioId)
    .in("compra_id", filas.map((f) => f.id));

  if (errorPagos) {
    // Sin lo pagado el saldo saldría igual al total, o sea inflado: no se avisa.
    console.error("Pagos a proveedores: no se pudieron leer los pagos:", errorPagos);
    return null;
  }

  const pagado = new Map<string, number>();
  for (const p of (pagos ?? []) as { compra_id: string; monto: number | string }[]) {
    pagado.set(p.compra_id, (pagado.get(p.compra_id) ?? 0) + Number(p.monto ?? 0));
  }

  return filas.map((f) => ({
    id: f.id,
    total: Number(f.total ?? 0),
    pagado: pagado.get(f.id) ?? 0,
    moneda: f.moneda,
    vence_el: f.vence_el,
  }));
}
