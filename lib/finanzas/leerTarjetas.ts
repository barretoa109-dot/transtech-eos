import { estadoDeTarjeta, obligacionesDe, type CompraEnCuotas, type EstadoTarjeta, type Tarjeta } from "./tarjetas.ts";
import type { MovimientoProyectado } from "./recurrencia.ts";
import type { ClienteSinTipos } from "../supabase/sin-tipos.ts";

/**
 * Las tarjetas de una persona, listas para la línea de tiempo.
 *
 * ============================================================
 * POR QUÉ ESTO ES UNA FUNCIÓN Y NO CÓDIGO EN CADA RUTA
 * ============================================================
 *
 * Cinco lugares llaman a `armarPanorama`: el panel, el calendario, el
 * presupuesto, la alerta de riesgo y el aviso por correo. Si cada uno leyera
 * las tarjetas por su cuenta, bastaría con que uno se olvidara para que esa
 * pantalla mostrara un disponible más alto que las otras sobre la misma plata.
 *
 * Ya pasó en este proyecto: el panel no contaba las cuotas de las deudas y la
 * alerta sí, así que las dos daban números distintos y una de las dos mentía.
 * Por eso el armado de la línea de tiempo vive en un solo módulo, y por eso
 * la lectura de las tarjetas vive en éste.
 *
 * Devuelve las dos cosas: el estado completo —para la pantalla de tarjetas— y
 * las obligaciones proyectadas —para el panorama—, calculadas de la misma
 * lectura para que no puedan discrepar.
 */

export async function leerTarjetas(
  cliente: ClienteSinTipos,
  usuarioId: string,
  opciones: { desde: string; hasta: string; ambito?: "personal" | "negocio" },
): Promise<{ tarjetas: EstadoTarjeta[]; obligaciones: MovimientoProyectado[] }> {
  const ambito = opciones.ambito ?? "personal";

  const { data: filas } = await cliente
    .from("eos_finanzas_tarjetas")
    .select(
      "id,emisor,nombre,moneda,linea_total,saldo_utilizado,saldo_al,dia_cierre,dia_vencimiento,pago_minimo,pago_total,resumen_al",
    )
    .eq("ambito", ambito)
    .eq("usuario_id", usuarioId)
    .eq("activa", true);

  const tarjetas = (filas ?? []) as Record<string, unknown>[];

  if (tarjetas.length === 0) return { tarjetas: [], obligaciones: [] };

  /*
   * Las compras se leen por usuario y no por tarjeta.
   *
   * Una consulta por tarjeta serían cinco viajes para alguien con cinco
   * tarjetas, en una ruta que se pide apenas abre la pantalla. `estadoDeTarjeta`
   * ya filtra por `tarjeta_id`, así que traerlas todas juntas no mezcla nada.
   */
  const { data: crudas } = await cliente
    .from("eos_finanzas_tarjeta_compras")
    .select(
      "id,tarjeta_id,descripcion,moneda,monto_total,monto_cuota,cuotas_totales,cuotas_pagadas,primera_cuota",
    )
    .eq("usuario_id", usuarioId);

  const compras = ((crudas ?? []) as Record<string, unknown>[]).map<CompraEnCuotas>((c) => ({
    id: c.id as string,
    tarjeta_id: c.tarjeta_id as string,
    descripcion: (c.descripcion as string) ?? "",
    moneda: (c.moneda as string) ?? "PYG",
    monto_total: c.monto_total === null ? null : num(c.monto_total),
    monto_cuota: num(c.monto_cuota),
    cuotas_totales: Number(c.cuotas_totales ?? 0),
    cuotas_pagadas: Number(c.cuotas_pagadas ?? 0),
    primera_cuota: c.primera_cuota as string,
  }));

  const estados = tarjetas.map((t) =>
    estadoDeTarjeta(
      {
        id: t.id as string,
        emisor: (t.emisor as string) ?? "",
        nombre: (t.nombre as string | null) ?? null,
        moneda: (t.moneda as string) ?? "PYG",
        linea_total: t.linea_total === null ? null : num(t.linea_total),
        saldo_utilizado: t.saldo_utilizado === null ? null : num(t.saldo_utilizado),
        saldo_al: (t.saldo_al as string | null) ?? null,
        dia_cierre: t.dia_cierre === null ? null : Number(t.dia_cierre),
        dia_vencimiento: t.dia_vencimiento === null ? null : Number(t.dia_vencimiento),
        pago_minimo: t.pago_minimo === null ? null : num(t.pago_minimo),
        pago_total: t.pago_total === null ? null : num(t.pago_total),
        resumen_al: (t.resumen_al as string | null) ?? null,
      } satisfies Tarjeta,
      compras,
      opciones.desde,
    ),
  );

  return {
    tarjetas: estados,
    obligaciones: obligacionesDe(estados, opciones),
  };
}

function num(valor: unknown): number {
  const n = typeof valor === "string" ? Number(valor) : Number(valor ?? 0);
  return Number.isFinite(n) ? n : 0;
}
