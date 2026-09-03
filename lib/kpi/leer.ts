import { esEtapa } from "../crm/embudo.ts";
import { tasaValida } from "../erp/impuestos.ts";
import type { ClienteSinTipos } from "../supabase/sin-tipos.ts";
import { empresaDe, filtroDeEmpresa } from "../empresa/acceso.ts";
import type { EstadoCompra, EstadoVenta, Hechos, Periodo } from "./tipos.ts";

/**
 * Traer de la base todo lo que el motor necesita, UNA sola vez.
 *
 * ============================================================
 * POR QUÉ ESTO NO VIVE EN LA RUTA
 * ============================================================
 *
 * Lo leen dos lugares: `GET /api/kpi`, que responde a la pantalla, y la
 * captura diaria que guarda la historia (`lib/kpi/capturar.ts`). Si cada uno
 * arma su propio `Hechos`, alcanza con que uno agregue un filtro para que la
 * historia guarde números que la pantalla nunca mostró — y entonces "cómo
 * venías" y "cómo estás" dejan de ser comparables sin que nada falle.
 *
 * ============================================================
 * QUÉ SE FILTRA POR FECHA Y QUÉ NO
 * ============================================================
 *
 * Los movimientos SÍ: solo importan los del período y el anterior.
 *
 * Las ventas y las compras NO. Una factura de hace cuatro meses sin cobrar
 * tiene que seguir contando para `cuentas_por_cobrar`, que es una foto de hoy
 * y no una suma del período. Cada definición filtra por fecha adentro cuando
 * el indicador es de período (`dentroDe`) y no filtra cuando es instantáneo.
 *
 * Las oportunidades tampoco: "sin actividad hace más de 14 días" necesita ver
 * las viejas, que son justamente las que importan.
 */

/**
 * El cliente admin, con el tipo que ya declara `lib/supabase/sin-tipos.ts`.
 *
 * Se importa en vez de redeclararlo para que ese archivo siga siendo el único
 * lugar del proyecto con la excepción de `no-explicit-any`, que es lo que hace
 * que `grep adminSinTipos` devuelva la lista completa de dónde se saltea la
 * verificación de tipos. Es `import type`, así que no arrastra nada en runtime.
 */
type ClienteAdmin = ClienteSinTipos;

/**
 * El techo de filas por consulta.
 *
 * Es el mismo que ya usa `app/api/erp/rentabilidad/route.ts`. Un negocio con
 * más de 500 ventas o compras vivas puede subcontar sus cuentas por cobrar
 * —está aceptado para esta etapa y anotado como deuda—, pero el orden por
 * fecha descendente garantiza que lo que entra es lo más reciente.
 */
const TECHO = 500;

const ESTADOS_VENTA: EstadoVenta[] = ["borrador", "emitida", "cobrada", "anulada"];
const ESTADOS_COMPRA: EstadoCompra[] = ["registrada", "pagada", "anulada"];

function esEstadoVenta(valor: unknown): valor is EstadoVenta {
  return typeof valor === "string" && (ESTADOS_VENTA as string[]).includes(valor);
}

function esEstadoCompra(valor: unknown): valor is EstadoCompra {
  return typeof valor === "string" && (ESTADOS_COMPRA as string[]).includes(valor);
}

export type Modulos = { erp: boolean; crm: boolean };

/**
 * `rango` cubre el período pedido Y el anterior de igual largo: el motor le va
 * a pedir el cálculo a cada definición para los dos, sobre estos mismos datos.
 *
 * Una fuente que falla se registra y se omite: `hechos.ventas` ausente hace
 * que el motor no calcule los indicadores que la necesitan y los informe en
 * `insumosFaltantes`. Eso es mejor que devolver un error entero, porque los
 * indicadores de finanzas de esa persona sí se podían calcular.
 */
export async function leerHechos(
  admin: ClienteAdmin,
  usuarioId: string,
  rango: Periodo,
  modulos: Modulos,
): Promise<Hechos> {
  const [movimientosRes, fijosRes] = await Promise.all([
    admin
      .from("eos_movimientos_financieros")
      .select("tipo,monto,moneda,fecha")
      .eq("usuario_id", usuarioId)
      .gte("fecha", rango.desde)
      .lte("fecha", rango.hasta),
    admin
      .from("eos_finanzas_fijos")
      .select("tipo,monto,moneda")
      .eq("usuario_id", usuarioId)
      .eq("activo", true),
  ]);

  /*
   * La empresa, resuelta una sola vez para toda la lectura.
   *
   * Va con las tablas del NEGOCIO y no con las de finanzas personales: los
   * movimientos financieros y los gastos fijos son de la persona, no de una
   * sociedad. Ver la v110 y `lib/empresa/acceso.ts`.
   */
  const empresaId = await empresaDe(admin, usuarioId);

  const hechos: Hechos = {};

  if (movimientosRes.error) {
    console.error("KPI: no se pudieron leer los movimientos financieros:", movimientosRes.error);
  } else {
    hechos.movimientos = (movimientosRes.data ?? []).map((m: Record<string, unknown>) => ({
      fecha: String(m.fecha),
      moneda: (m.moneda as string | null) ?? null,
      monto: Number(m.monto ?? 0),
      tipo: m.tipo === "ingreso" ? "ingreso" : "gasto",
    }));
  }

  if (fijosRes.error) {
    console.error("KPI: no se pudieron leer los gastos fijos:", fijosRes.error);
  } else {
    hechos.fijos = (fijosRes.data ?? []).map((f: Record<string, unknown>) => ({
      moneda: (f.moneda as string | null) ?? null,
      monto: Number(f.monto ?? 0),
      tipo: f.tipo === "ingreso" ? "ingreso" : "gasto",
    }));
  }

  if (modulos.erp) {
    const [ventasRes, comprasRes, productosRes, cobranzasRes, kardexRes] = await Promise.all([
      admin
        .from("eos_erp_ventas")
        .select(
          "id,fecha,moneda,estado,total,vence_el,contacto:eos_crm_contactos(id,nombre)," +
            "items:eos_erp_venta_items(producto_id,descripcion,cantidad,total,iva,costo_unitario)",
        )
        .or(filtroDeEmpresa(usuarioId, empresaId))
        .neq("estado", "anulada")
        .order("fecha", { ascending: false })
        .limit(TECHO),
      admin
        .from("eos_erp_compras")
        .select("id,fecha,moneda,estado,total,vence_el,contacto:eos_crm_contactos(id,nombre)")
        .or(filtroDeEmpresa(usuarioId, empresaId))
        .neq("estado", "anulada")
        .order("fecha", { ascending: false })
        .limit(TECHO),
      admin
        .from("eos_erp_productos")
        .select("id,nombre,moneda,activo,controla_stock,stock_actual,stock_minimo,costo,costo_promedio,iva")
        .or(filtroDeEmpresa(usuarioId, empresaId))
        .limit(TECHO),
      // Los cobros parciales (v107). Sin esto, el saldo de un documento sería
      // su total y la cartera saldría inflada: una venta con la mitad abonada
      // sigue en estado 'emitida'.
      admin
        .from("eos_erp_cuenta_movimientos_v107")
        .select("venta_id,compra_id,monto")
        .or(filtroDeEmpresa(usuarioId, empresaId))
        .limit(5000),
      /*
       * El kardex (v108). Sin filtro por `rango` a propósito: la rotación
       * necesita el valor del inventario ANTERIOR al período, y ese dato está
       * en el último movimiento previo. Recortando por rango se perdería
       * justamente el extremo que hace falta.
       */
      admin
        .from("eos_erp_movimientos_stock")
        .select("fecha,tipo,cantidad,costo_unitario,valor_resultante,producto_id")
        .or(filtroDeEmpresa(usuarioId, empresaId))
        .order("fecha", { ascending: false })
        .limit(5000),
    ]);

    const cobradoPorVenta = new Map<string, number>();
    const cobradoPorCompra = new Map<string, number>();

    if (cobranzasRes.error) {
      console.error("KPI: no se pudieron leer las cobranzas:", cobranzasRes.error);
    } else {
      for (const c of (cobranzasRes.data ?? []) as Record<string, unknown>[]) {
        const monto = Number(c.monto ?? 0);
        if (typeof c.venta_id === "string") {
          cobradoPorVenta.set(c.venta_id, (cobradoPorVenta.get(c.venta_id) ?? 0) + monto);
        } else if (typeof c.compra_id === "string") {
          cobradoPorCompra.set(c.compra_id, (cobradoPorCompra.get(c.compra_id) ?? 0) + monto);
        }
      }
    }

    if (ventasRes.error) {
      console.error("KPI: no se pudieron leer las ventas:", ventasRes.error);
    } else {
      hechos.ventas = (ventasRes.data ?? []).map((venta: Record<string, unknown>) => ({
        id: String(venta.id ?? ""),
        fecha: String(venta.fecha ?? ""),
        moneda: (venta.moneda as string | null) ?? null,
        estado: esEstadoVenta(venta.estado) ? venta.estado : "emitida",
        contacto_id: (venta.contacto as { id?: string } | null)?.id ?? null,
        contacto_nombre: (venta.contacto as { nombre?: string } | null)?.nombre ?? null,
        total: Number(venta.total ?? 0),
        vence_el: (venta.vence_el as string | null) ?? null,
        cobrado: cobradoPorVenta.get(String(venta.id ?? "")) ?? 0,
        items: (Array.isArray(venta.items) ? venta.items : []).map((item: Record<string, unknown>) => ({
          total: Number(item.total ?? 0),
          iva: tasaValida(item.iva),
          cantidad: Number(item.cantidad ?? 0),
          costo_unitario:
            item.costo_unitario === null || item.costo_unitario === undefined
              ? null
              : Number(item.costo_unitario),
          producto_id: typeof item.producto_id === "string" ? item.producto_id : null,
        })),
      }));
    }

    if (comprasRes.error) {
      console.error("KPI: no se pudieron leer las compras:", comprasRes.error);
    } else {
      hechos.compras = (comprasRes.data ?? []).map((compra: Record<string, unknown>) => ({
        id: String(compra.id ?? ""),
        fecha: String(compra.fecha ?? ""),
        moneda: (compra.moneda as string | null) ?? null,
        estado: esEstadoCompra(compra.estado) ? compra.estado : "registrada",
        proveedor_id: (compra.contacto as { id?: string } | null)?.id ?? null,
        proveedor_nombre: (compra.contacto as { nombre?: string } | null)?.nombre ?? null,
        total: Number(compra.total ?? 0),
        vence_el: (compra.vence_el as string | null) ?? null,
        cobrado: cobradoPorCompra.get(String(compra.id ?? "")) ?? 0,
      }));
    }

    if (productosRes.error) {
      console.error("KPI: no se pudieron leer los productos:", productosRes.error);
    } else {
      hechos.productos = (productosRes.data ?? []).map((p: Record<string, unknown>) => ({
        id: String(p.id ?? ""),
        nombre: String(p.nombre ?? "Producto"),
        moneda: (p.moneda as string | null) ?? null,
        activo: p.activo !== false,
        controla_stock: p.controla_stock === true,
        stock_actual: Number(p.stock_actual ?? 0),
        stock_minimo: Number(p.stock_minimo ?? 0),
        costo: p.costo === null || p.costo === undefined ? null : Number(p.costo),
        costo_promedio:
          p.costo_promedio === null || p.costo_promedio === undefined
            ? null
            : Number(p.costo_promedio),
        iva: tasaValida(p.iva),
      }));
    }

    if (kardexRes.error) {
      console.error("KPI: no se pudo leer el kardex:", kardexRes.error);
    } else {
      // La moneda del movimiento sale de su producto: el kardex no la guarda,
      // y duplicarla ahí sería otra copia que se puede desincronizar.
      const monedaDeProducto = new Map(
        (hechos.productos ?? []).map((p) => [p.id, p.moneda ?? "PYG"]),
      );

      hechos.movimientos_stock = (kardexRes.data ?? []).map((m: Record<string, unknown>) => ({
        fecha: String(m.fecha ?? ""),
        tipo: m.tipo === "entrada" ? "entrada" : m.tipo === "salida" ? "salida" : "ajuste",
        cantidad: Number(m.cantidad ?? 0),
        costo_unitario:
          m.costo_unitario === null || m.costo_unitario === undefined ? null : Number(m.costo_unitario),
        valor_resultante:
          m.valor_resultante === null || m.valor_resultante === undefined
            ? null
            : Number(m.valor_resultante),
        producto_id: String(m.producto_id ?? ""),
        moneda: monedaDeProducto.get(String(m.producto_id ?? "")) ?? "PYG",
      }));
    }
  }

  if (modulos.crm) {
    const [oportunidadesRes, actividadesRes] = await Promise.all([
      admin
        .from("eos_crm_oportunidades")
        .select("id,monto,moneda,etapa,creado_en,cerrada_en")
        .or(filtroDeEmpresa(usuarioId, empresaId))
        .limit(1000),
      admin
        .from("eos_crm_actividades")
        .select("oportunidad_id,fecha,hecha")
        .or(filtroDeEmpresa(usuarioId, empresaId))
        .order("fecha", { ascending: false })
        .limit(2000),
    ]);

    if (oportunidadesRes.error) {
      console.error("KPI: no se pudieron leer las oportunidades:", oportunidadesRes.error);
    } else {
      hechos.oportunidades = (oportunidadesRes.data ?? []).map((o: Record<string, unknown>) => ({
        id: String(o.id ?? ""),
        etapa: esEtapa(o.etapa) ? o.etapa : "nueva",
        monto: Number(o.monto ?? 0),
        moneda: (o.moneda as string | null) ?? null,
        creado_en: String(o.creado_en ?? rango.desde),
        cerrada_en: (o.cerrada_en as string | null) ?? null,
      }));
    }

    if (actividadesRes.error) {
      console.error("KPI: no se pudieron leer las actividades:", actividadesRes.error);
    } else {
      hechos.actividades = (actividadesRes.data ?? []).map((a: Record<string, unknown>) => ({
        oportunidad_id: (a.oportunidad_id as string | null) ?? null,
        fecha: String(a.fecha ?? ""),
        hecha: a.hecha === true,
      }));
    }
  }

  return hechos;
}
