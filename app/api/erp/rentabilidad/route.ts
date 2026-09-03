import { NextResponse } from "next/server";
import { exigirModulo } from "@/lib/modulos/acceso";
import { empresaDe, filtroDeEmpresa } from "@/lib/empresa/acceso";
import { adminSinTipos } from "@/lib/supabase/sin-tipos";
import { calcularRentabilidad, type LineaRentabilidad } from "@/lib/erp/rentabilidad";
import { calcularIndicadores, loQueFalta, periodoAnterior } from "@/lib/erp/indicadores";
import { tasaValida } from "@/lib/erp/impuestos";
import { hoyEnParaguay, sumarDias } from "@/lib/fecha";

export const dynamic = "force-dynamic";

/*
 * Las tres ventanas que pidió el usuario: diaria, semanal y mensual.
 *
 * Son ventanas móviles y no el mes calendario, y ésa es la diferencia que
 * importa. La primera versión anclaba al mes en curso, y el día que se
 * estrenó era 1 de septiembre: "el mes en curso" eran veinticuatro horas y
 * la pantalla salía vacía para todo el mundo. Un tablero que no sirve el
 * primero de cada mes no sirve.
 *
 * Con ventana móvil el período anterior es siempre del mismo largo y está
 * pegado al actual, así que la comparación es pareja cualquier día del año.
 */
const VENTANAS: Record<string, number> = { dia: 1, semana: 7, mes: 30 };

export async function GET(request: Request) {
  const puerta = await exigirModulo("erp");
  if (puerta.respuesta) return puerta.respuesta;

  // Las dos fronteras mientras dure la transición de la v109/v110.
  const empresaId = await empresaDe(adminSinTipos(), puerta.usuarioId);

  const admin = adminSinTipos();

  const { data, error } = await admin
    .from("eos_erp_ventas")
    .select(
      "id,fecha,moneda,estado,contacto:eos_crm_contactos(id,nombre)," +
        "items:eos_erp_venta_items(" +
        "producto_id,descripcion,cantidad,total,iva,costo_unitario,costo_estimado)",
    )
    .or(filtroDeEmpresa(puerta.usuarioId, empresaId))
    .neq("estado", "anulada")
    .order("fecha", { ascending: false })
    .limit(500);

  if (error) {
    console.error("ERP: no se pudo calcular la rentabilidad:", error);
    return NextResponse.json(
      { error: "No pudimos calcular la rentabilidad." },
      { status: 503, headers: noStore() },
    );
  }

  const lineas: LineaRentabilidad[] = (data ?? []).flatMap((venta: Record<string, unknown>) => {
    const items = Array.isArray(venta.items) ? venta.items : [];
    return items.map((item: Record<string, unknown>) => ({
      producto_id: typeof item.producto_id === "string" ? item.producto_id : null,
      descripcion: String(item.descripcion ?? "Producto"),
      cantidad: Number(item.cantidad ?? 0),
      venta: Number(item.total ?? 0),
      iva: tasaValida(item.iva),
      costo_unitario: item.costo_unitario === null || item.costo_unitario === undefined
        ? null
        : Number(item.costo_unitario),
      estimado: item.costo_estimado === true,
      moneda: String(venta.moneda ?? "PYG"),
    }));
  });

  /*
   * Y los indicadores del período, en la misma respuesta.
   *
   * En la misma llamada y no en otra ruta a propósito: el margen de arriba y
   * la ganancia de acá salen de las mismas ventas, y si se pidieran por
   * separado podrían leerse en dos momentos distintos y mostrar dos números
   * para la misma plata. Es la misma razón por la que la traza del panel
   * financiero viaja pegada a las cifras que explica.
   *
   * El período es una ventana móvil que termina hoy en Paraguay: un día, una
   * semana o treinta días, según lo que pida la pantalla.
   */
  const pedida = new URL(request.url).searchParams.get("ventana") ?? "mes";
  const dias = VENTANAS[pedida] ?? VENTANAS.mes;
  const ventana = dias === VENTANAS[pedida] ? pedida : "mes";

  const hoy = hoyEnParaguay();
  // Inclusiva de los dos extremos: "7 días" son hoy y los seis anteriores.
  const periodo = { desde: sumarDias(hoy, -(dias - 1)), hasta: hoy };
  const anterior = periodoAnterior(periodo);

  const [movimientos, fijos] = await Promise.all([
    admin
      .from("eos_movimientos_financieros")
      .select("tipo,monto,moneda,fecha")
      .eq("usuario_id", puerta.usuarioId)
      .gte("fecha", anterior.desde)
      .lte("fecha", periodo.hasta),
    admin
      .from("eos_finanzas_fijos")
      .select("tipo,monto,moneda")
      .eq("usuario_id", puerta.usuarioId)
      .eq("activo", true),
  ]);

  const filas = (movimientos.data ?? []) as Record<string, unknown>[];
  const deTipo = (tipo: string) =>
    filas
      .filter((m) => m.tipo === tipo)
      .map((m) => ({
        fecha: String(m.fecha),
        moneda: (m.moneda as string) ?? null,
        monto: Number(m.monto ?? 0),
      }));

  const indicadores = calcularIndicadores({
    periodo,
    ventas: (data ?? []).map((venta: Record<string, unknown>) => ({
      fecha: String(venta.fecha ?? ""),
      moneda: (venta.moneda as string) ?? null,
      contacto_id: (venta.contacto as { id?: string } | null)?.id ?? null,
      contacto_nombre: (venta.contacto as { nombre?: string } | null)?.nombre ?? null,
      items: (Array.isArray(venta.items) ? venta.items : []).map(
        (item: Record<string, unknown>) => ({
          total: Number(item.total ?? 0),
          iva: tasaValida(item.iva),
          cantidad: Number(item.cantidad ?? 0),
          costo_unitario:
            item.costo_unitario === null || item.costo_unitario === undefined
              ? null
              : Number(item.costo_unitario),
        }),
      ),
    })),
    ingresos: deTipo("ingreso"),
    gastos: deTipo("gasto"),
    /*
     * Los fijos, prorrateados a la ventana que se está mirando.
     *
     * Están declarados por mes. Compararlos enteros contra un día diría que
     * hay que vender el alquiler completo antes del mediodía, y contra una
     * semana diría algo cuatro veces peor de lo que es. El punto de equilibrio
     * sólo significa algo si los dos lados hablan del mismo lapso.
     */
    fijosMensuales: ((fijos.data ?? []) as Record<string, unknown>[])
      .filter((f) => f.tipo === "gasto")
      .map((f) => ({
        fecha: periodo.desde,
        moneda: (f.moneda as string) ?? null,
        monto: (Number(f.monto ?? 0) * dias) / 30,
      })),
  });

  return NextResponse.json(
    {
      resumen: calcularRentabilidad(lineas),
      indicadores,
      periodo,
      ventana,
      // Lo que todavía no se puede calcular, dicho. Un tablero que admite lo
      // que no sabe vale más que uno que llena todos los casilleros.
      falta: loQueFalta(),
    },
    { headers: noStore() },
  );
}

function noStore() {
  return { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" };
}
