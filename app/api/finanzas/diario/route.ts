import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { clasificar, etiquetaDe } from "@/lib/finanzas/destinos";
import { hoyEnParaguay, sumarDias } from "@/lib/fecha";

export const dynamic = "force-dynamic";

/**
 * El diario de gastos e ingresos de una persona.
 *
 * ============================================================
 * POR QUÉ HACE FALTA
 * ============================================================
 *
 * EOS no es solo para quien tiene un negocio. Alguien que trabaja en relación
 * de dependencia no tiene ventas, ni stock, ni proveedores — tiene el
 * combustible, el almuerzo, el alquiler y el sueldo. Todo el motor para eso ya
 * existía: el clasificador de destinos, el desglose, el panel. Lo que no había
 * era dónde anotar: `/api/finanzas/rapido` interpreta "gasté 50 mil en nafta"
 * desde hace tiempo y no estaba conectado a ninguna pantalla.
 *
 * Esta ruta es la lista que esa pantalla necesita.
 *
 * ============================================================
 * LO QUE SE PUEDE TOCAR Y LO QUE NO
 * ============================================================
 *
 * Cada movimiento dice de dónde vino. Los que cargó una persona a mano se
 * pueden corregir y borrar. Los que nacieron de una venta o una compra NO: ese
 * gasto es el reflejo de un documento, y borrarlo acá dejaría la compra
 * apuntando a una plata que no existe. Se marcan como bloqueados y se explica
 * dónde se corrigen.
 *
 * Es la misma regla que en el ERP: no se abre una puerta trasera a lo que ya
 * se contó en otro lado.
 */

const VENTANAS: Record<string, number> = { semana: 7, mes: 30, trimestre: 90 };

/** De dónde puede venir un movimiento que una persona escribió ella misma. */
const A_MANO = new Set(["manual", "chat"]);

/**
 * Las categorías que el propio sistema escribe, con su nombre en la pantalla.
 *
 * No pasan por el clasificador de destinos porque ése infiere de la
 * descripción y está hecho para gastos de una persona —nafta, almuerzo,
 * alquiler—. Un movimiento que nació de una venta ya sabe lo que es.
 */
const ETIQUETAS_PROPIAS: Record<string, string> = {
  ventas: "Ventas",
  compras: "Compras y mercadería",
};

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Sesión no válida." }, { status: 401, headers: noStore() });
  }

  const pedida = new URL(request.url).searchParams.get("ventana") ?? "mes";
  const dias = VENTANAS[pedida] ?? VENTANAS.mes;
  const ventana = dias === VENTANAS[pedida] ? pedida : "mes";

  const hasta = hoyEnParaguay();
  const desde = sumarDias(hasta, -(dias - 1));

  const { data, error } = await supabase
    .from("eos_movimientos_financieros")
    .select("id,tipo,monto,moneda,descripcion,categoria,fecha,origen")
    .eq("usuario_id", user.id)
    .gte("fecha", desde)
    .lte("fecha", hasta)
    .order("fecha", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(500);

  if (error) {
    console.error("Finanzas: no se pudo leer el diario:", error);
    return NextResponse.json(
      { error: "No pudimos cargar tus movimientos." },
      { status: 503, headers: noStore() },
    );
  }

  const movimientos = (data ?? []).map((m) => {
    /*
     * Lo que ya viene con destino conocido no pasa por el clasificador.
     *
     * Los movimientos del ERP traen su categoría escrita —"ventas",
     * "compras"— y sus descripciones son genéricas: "Venta", "Compra". Si se
     * los manda al clasificador personal, que busca nafta y almuerzos, caen
     * todos en "Sin reconocer" y la pantalla queda con veinte filas iguales
     * que no dicen nada. Peor: parece rota cuando en realidad sabe
     * perfectamente qué es cada una.
     */
    const propia = String(m.categoria ?? "").trim().toLowerCase();
    const conocida = ETIQUETAS_PROPIAS[propia];

    if (conocida) {
      return {
        id: m.id,
        tipo: m.tipo as "ingreso" | "gasto",
        monto: Number(m.monto ?? 0),
        moneda: String(m.moneda ?? "PYG"),
        descripcion: m.descripcion ?? "",
        fecha: String(m.fecha),
        origen: String(m.origen ?? ""),
        categoria: propia,
        etiqueta: conocida,
        editable: A_MANO.has(String(m.origen ?? "")),
      };
    }

    const clave = clasificar(m.descripcion, m.categoria);

    return {
      id: m.id,
      tipo: m.tipo as "ingreso" | "gasto",
      monto: Number(m.monto ?? 0),
      moneda: String(m.moneda ?? "PYG"),
      descripcion: m.descripcion ?? "",
      fecha: String(m.fecha),
      origen: String(m.origen ?? ""),
      categoria: clave,
      etiqueta: etiquetaDe(clave),
      /** Los que nacieron de una venta o una compra no se tocan desde acá. */
      editable: A_MANO.has(String(m.origen ?? "")),
    };
  });

  /*
   * Los totales, por moneda.
   *
   * Nunca uno solo: sumar guaraníes con dólares no da nada. Es la misma regla
   * que gobierna todo el resto del sistema y no se relaja porque acá el
   * usuario sea una persona y no un comercio.
   */
  const porMoneda = new Map<string, { entro: number; salio: number }>();

  for (const m of movimientos) {
    const actual = porMoneda.get(m.moneda) ?? { entro: 0, salio: 0 };
    if (m.tipo === "ingreso") actual.entro += m.monto;
    else actual.salio += m.monto;
    porMoneda.set(m.moneda, actual);
  }

  const totales = [...porMoneda.entries()].map(([moneda, t]) => ({
    moneda,
    entro: t.entro,
    salio: t.salio,
    balance: t.entro - t.salio,
  }));

  return NextResponse.json(
    { movimientos, totales, periodo: { desde, hasta }, ventana },
    { headers: noStore() },
  );
}

function noStore() {
  return { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" };
}
