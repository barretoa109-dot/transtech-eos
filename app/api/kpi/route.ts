import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { adminSinTipos } from "@/lib/supabase/sin-tipos";
import { verificarModulo } from "@/lib/modulos/acceso";
import { calcular, insumosFaltantes } from "@/lib/kpi/motor";
import { periodoAnterior } from "@/lib/kpi/periodo";
import { CATALOGO, definicionesDe, resolver } from "@/lib/kpi/registro";
import { hoyEnParaguay } from "@/lib/fecha";
import { tasaValida } from "@/lib/erp/impuestos";
import { esEtapa } from "@/lib/crm/embudo";
import type { DefinicionKPI, EstadoCompra, EstadoVenta, Familia, Hechos } from "@/lib/kpi/tipos";

export const dynamic = "force-dynamic";

/**
 * Una ruta, no cuatro cáscaras.
 *
 * `eos-kpis`, `eos-tendencias`, `eos-recomendaciones` y `eos-seguimientos`
 * son cuatro `select * … limit N` sobre tablas que llenaba n8n, sin ninguna
 * lógica. Acá el cálculo lo hace el motor (`lib/kpi/motor.ts`) sobre datos
 * leídos una sola vez por pedido; agregar un indicador nuevo es agregar una
 * definición al registro (`lib/kpi/registro.ts`), no una ruta.
 *
 * `?id=roi,margen_bruto` pide indicadores puntuales; `?familia=ventas` pide
 * una familia entera; sin ninguno de los dos, el catálogo completo.
 *
 * Erp y CRM son módulos contratables — quien no los tiene igual ve sus
 * indicadores de finanzas (que no son un anexo), y el motor no rompe con lo
 * que falta: `insumosFaltantes` dice cuáles quedaron afuera y por qué, para
 * que la pantalla pueda ofrecer el módulo en vez de mostrar un error.
 */

const FAMILIAS: Familia[] = ["finanzas", "ventas", "crm", "cartera", "inventario", "compras"];

function esFamilia(valor: string | null): valor is Familia {
  return valor !== null && (FAMILIAS as string[]).includes(valor);
}

const ESTADOS_VENTA: EstadoVenta[] = ["borrador", "emitida", "cobrada", "anulada"];
const ESTADOS_COMPRA: EstadoCompra[] = ["registrada", "pagada", "anulada"];

function esEstadoVenta(valor: unknown): valor is EstadoVenta {
  return typeof valor === "string" && (ESTADOS_VENTA as string[]).includes(valor);
}

function esEstadoCompra(valor: unknown): valor is EstadoCompra {
  return typeof valor === "string" && (ESTADOS_COMPRA as string[]).includes(valor);
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401, headers: noStore() });
  }

  const { searchParams } = new URL(request.url);
  const idsPedidos = (searchParams.get("id") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const familiaPedida = searchParams.get("familia");

  const definiciones: DefinicionKPI[] = idsPedidos.length > 0
    ? resolver(idsPedidos)
    : esFamilia(familiaPedida)
      ? definicionesDe(familiaPedida)
      : CATALOGO;

  const [erp, crm] = await Promise.all([verificarModulo("erp"), verificarModulo("crm")]);

  const admin = adminSinTipos();
  const hoy = hoyEnParaguay();
  const periodo = { desde: `${hoy.slice(0, 7)}-01`, hasta: hoy };
  // El rango de consulta cubre el período pedido Y el anterior de igual
  // largo, en una sola vuelta a la base: el motor va a pedirle el cálculo a
  // cada definición para los dos períodos, sobre los mismos datos.
  const rango = { desde: periodoAnterior(periodo).desde, hasta: periodo.hasta };

  const [movimientosRes, fijosRes] = await Promise.all([
    admin
      .from("eos_movimientos_financieros")
      .select("tipo,monto,moneda,fecha")
      .eq("usuario_id", user.id)
      .gte("fecha", rango.desde)
      .lte("fecha", rango.hasta),
    admin.from("eos_finanzas_fijos").select("tipo,monto,moneda").eq("usuario_id", user.id).eq("activo", true),
  ]);

  if (movimientosRes.error) {
    console.error("KPI: no se pudieron leer los movimientos financieros:", movimientosRes.error);
    return NextResponse.json({ error: "No pudimos calcular los indicadores." }, { status: 503, headers: noStore() });
  }

  const hechos: Hechos = {
    movimientos: (movimientosRes.data ?? []).map((m: Record<string, unknown>) => ({
      fecha: String(m.fecha),
      moneda: (m.moneda as string | null) ?? null,
      monto: Number(m.monto ?? 0),
      tipo: m.tipo === "ingreso" ? "ingreso" : "gasto",
    })),
    fijos: (fijosRes.data ?? []).map((f: Record<string, unknown>) => ({
      moneda: (f.moneda as string | null) ?? null,
      monto: Number(f.monto ?? 0),
      tipo: f.tipo === "ingreso" ? "ingreso" : "gasto",
    })),
  };

  // Ventas, compras y productos: solo si el módulo ERP está vigente. Sin él,
  // las definiciones que los `necesita` simplemente no se calculan — no es
  // un error, es lo que corresponde cuando el usuario no contrató ese anexo.
  //
  // Ventas y compras NO se filtran por `rango` a propósito: una factura de
  // hace cuatro meses que todavía no se cobró tiene que seguir contando para
  // `cuentas_por_cobrar`, aunque quede fuera del período o del anterior. Cada
  // definición filtra por fecha adentro cuando el indicador es de período
  // (`dentroDe`) y no filtra cuando es una foto de hoy (`instantanea`).
  // `limit(500)` ordenado por fecha es el mismo límite que ya usa
  // `app/api/erp/rentabilidad/route.ts`: un negocio con más de 500 ventas o
  // compras sin cobrar/pagar puede subcontar acá — aceptable para esta
  // primera versión, no para siempre.
  if (erp.permitido) {
    const [ventasRes, comprasRes, productosRes] = await Promise.all([
      admin
        .from("eos_erp_ventas")
        .select(
          "id,fecha,moneda,estado,total,contacto:eos_crm_contactos(id,nombre)," +
            "items:eos_erp_venta_items(producto_id,descripcion,cantidad,total,iva,costo_unitario)",
        )
        .eq("usuario_id", user.id)
        .neq("estado", "anulada")
        .order("fecha", { ascending: false })
        .limit(500),
      admin
        .from("eos_erp_compras")
        .select("id,fecha,moneda,estado,total,contacto:eos_crm_contactos(id,nombre)")
        .eq("usuario_id", user.id)
        .neq("estado", "anulada")
        .order("fecha", { ascending: false })
        .limit(500),
      admin
        .from("eos_erp_productos")
        .select("id,nombre,moneda,activo,controla_stock,stock_actual,stock_minimo,costo,iva")
        .eq("usuario_id", user.id)
        .limit(500),
    ]);

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
        iva: tasaValida(p.iva),
      }));
    }
  }

  // Oportunidades y actividades: solo si el módulo CRM está vigente.
  //
  // Sin filtro de fecha a propósito: "sin actividad hace más de 14 días" y
  // "pipeline abierto ahora" necesitan ver oportunidades viejas, no solo las
  // del rango del período pedido.
  if (crm.permitido) {
    const [oportunidadesRes, actividadesRes] = await Promise.all([
      admin
        .from("eos_crm_oportunidades")
        .select("id,monto,moneda,etapa,creado_en,cerrada_en")
        .eq("usuario_id", user.id)
        .limit(1000),
      admin
        .from("eos_crm_actividades")
        .select("oportunidad_id,fecha,hecha")
        .eq("usuario_id", user.id)
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

  const resultados = calcular(definiciones, hechos, periodo);
  const faltan = insumosFaltantes(definiciones, hechos);

  return NextResponse.json({ resultados, periodo, faltan }, { headers: noStore() });
}

function noStore() {
  return { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" };
}
