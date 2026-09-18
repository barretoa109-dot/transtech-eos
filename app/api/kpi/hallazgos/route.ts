import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { adminSinTipos } from "@/lib/supabase/sin-tipos";
import { verificarModulo } from "@/lib/modulos/acceso";
import { calcular } from "@/lib/kpi/motor";
import { periodoAnterior } from "@/lib/kpi/periodo";
import { CATALOGO, CON_UMBRALES } from "@/lib/kpi/registro";
import { leerHechos } from "@/lib/kpi/leer";
import { detectarAnomalias, type EntradaAnomalias } from "@/lib/kpi/anomalias";
import { descomponerVentas, redactar } from "@/lib/kpi/causa";
import { scorePrincipal } from "@/lib/kpi/twin";
import { avisoDeCobertura } from "@/lib/kpi/score";
import { formatearMonto } from "@/lib/finanzas/formato";
import { hoyEnParaguay } from "@/lib/fecha";
import type { PuntoHistoria } from "@/lib/kpi/historia";
import {
  detectarRiesgosNegocio,
  redactarRiesgoNegocio,
  type FijoDeclarado,
  type GastoHistorico,
  type ProductoStock,
  type SalidaDeStock,
  type VentaACobrar,
} from "@/lib/erp/riesgos-negocio";

export const dynamic = "force-dynamic";

/**
 * Qué debería preocuparte hoy.
 *
 * Junta las tres piezas: los indicadores del día (`lib/kpi/motor`), su historia
 * (`v105`) y el detector (`lib/kpi/anomalias`). Y para las ventas agrega la
 * descomposición: no solo "cayeron", sino qué productos y qué clientes explican
 * la caída.
 *
 * Todo lo que devuelve viene rotulado con su `clase` —hecho, hipótesis o
 * estimación— y hoy son todos hechos: la aritmética se puede comprobar. EOS no
 * inventa causas.
 */

/** Cuántos hallazgos vuelven. Una lista larga es una lista que no se lee. */
const TECHO = 8;

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401, headers: noStore() });
  }

  const [erp, crm] = await Promise.all([verificarModulo("erp"), verificarModulo("crm")]);

  const admin = adminSinTipos();
  const hoy = hoyEnParaguay();
  const periodo = { desde: `${hoy.slice(0, 7)}-01`, hasta: hoy };
  const anterior = periodoAnterior(periodo);
  const rango = { desde: anterior.desde, hasta: periodo.hasta };

  const hechos = await leerHechos(admin, user.id, rango, {
    erp: erp.permitido,
    crm: crm.permitido,
  });
  const resultados = calcular(CATALOGO, hechos, periodo);

  /*
   * La historia de TODOS los indicadores en una sola consulta.
   *
   * Una por indicador serían 24 viajes a la base para pintar un panel. Se
   * traen los últimos 60 días de todo y se agrupa acá, que es trabajo de
   * memoria y no de red.
   */
  const desdeHistoria = restarDias(hoy, 60);
  const { data: filas, error } = await admin
    .from("eos_kpi_historia_v105")
    .select("indicador,moneda,fecha,valor,confianza,motivo")
    .eq("usuario_id", user.id)
    .gte("fecha", desdeHistoria)
    .order("fecha", { ascending: true });

  if (error) {
    // La historia es un extra: sin ella el detector sigue evaluando los
    // umbrales del día. Se registra y se sigue, no se devuelve un error.
    console.error("KPI: no se pudo leer la historia para los hallazgos:", error);
  }

  const series = new Map<string, PuntoHistoria[]>();
  for (const f of (filas ?? []) as Record<string, unknown>[]) {
    const clave = `${String(f.indicador)}:${String(f.moneda)}`;
    const lista = series.get(clave) ?? [];
    lista.push({
      fecha: String(f.fecha),
      valor: f.valor === null || f.valor === undefined ? null : Number(f.valor),
      confianza: Number(f.confianza ?? 1),
      motivo: (f.motivo as string | null) ?? null,
    });
    series.set(clave, lista);
  }

  const entradas: EntradaAnomalias[] = resultados.map((r) => ({
    resultado: r,
    puntos: series.get(`${r.id}:${r.moneda}`),
  }));

  const anomalias = detectarAnomalias(entradas).slice(0, TECHO);

  /*
   * La causa se calcula SOLO para las ventas y solo si se movieron.
   *
   * Descomponer los 24 indicadores por dos dimensiones cada uno sería mucho
   * trabajo para responder preguntas que nadie hizo. Las ventas son el número
   * del que todo lo demás cuelga, así que es el que vale la pena abrir.
   */
  const monedas = [...new Set(resultados.filter((r) => r.id === "ventas_netas").map((r) => r.moneda))];

  const causas = monedas
    .map((moneda) => {
      const porProducto = descomponerVentas(hechos, periodo, anterior, "producto", moneda);
      const porCliente = descomponerVentas(hechos, periodo, anterior, "cliente", moneda);
      const fmt = (n: number) => formatearMonto(n, moneda);

      return {
        moneda,
        cambio: porProducto.cambio,
        producto: redactar(porProducto, fmt),
        cliente: redactar(porCliente, fmt),
      };
    })
    .filter((c) => c.producto !== null || c.cliente !== null);

  /*
   * El score se calcula acá y no se lee del gemelo a propósito.
   *
   * El gemelo lo escribe el cron una vez por día; esta pantalla se abre en
   * cualquier momento. Mostrar el score de ayer al lado de los indicadores de
   * hoy sería mostrar dos fotos distintas como si fueran una. El gemelo queda
   * como la versión guardada —para comparar contra el pasado—, y lo que se ve
   * en pantalla sale de los mismos números que están debajo.
   */
  const score = scorePrincipal(resultados, CON_UMBRALES);

  /*
   * Los riesgos operativos (stock bajo, cobros demorados, gasto anormal).
   *
   * Hasta acá `lib/erp/riesgos-negocio.ts` solo alimentaba el aviso por
   * correo de `lib/erp/avisar-negocio.ts` — nunca aparecía en el Dashboard,
   * que es donde alguien realmente entra a mirar "cómo viene el negocio".
   *
   * Se reutiliza la función pura tal cual (no se reimplementa la regla), con
   * las MISMAS consultas que ya usa el cron: no se puede armar esto desde
   * `hechos` porque el gasto anormal necesita 400 días de historial y
   * `hechos` solo trae el período actual y el anterior.
   */
  let riesgosNegocio: { tipo: string; texto: string }[] = [];

  if (erp.permitido) {
    const [productosRiesgo, ventasRiesgo, gastosRiesgo, fijosRiesgo] = await Promise.all([
      admin
        .from("eos_erp_productos")
        .select("id,nombre,stock_actual,stock_minimo,controla_stock,activo")
        .eq("usuario_id", user.id)
        .eq("activo", true)
        .eq("controla_stock", true),
      admin
        .from("eos_erp_ventas")
        .select("id,fecha,total,moneda,vence_el")
        .eq("usuario_id", user.id)
        .is("movimiento_id", null)
        .not("estado", "in", '("anulada","cobrada")'),
      admin
        .from("eos_movimientos_financieros")
        .select("id,fecha,monto,moneda,categoria,descripcion,recurrente")
        .eq("usuario_id", user.id)
        .eq("ambito", "negocio")
        .eq("tipo", "gasto")
        .gte("fecha", restarDias(hoy, 400))
        .order("fecha", { ascending: true }),
      admin
        .from("eos_finanzas_fijos")
        .select("descripcion")
        .eq("usuario_id", user.id)
        .eq("ambito", "negocio")
        .eq("activo", true),
    ]);

    // Las salidas del último mes: de ahí sale el ritmo con que se proyecta
    // cuándo se agota cada producto (`lib/erp/agotamiento.ts`).
    const salidasRiesgo = await admin
      .from("eos_erp_movimientos_stock")
      .select("producto_id,fecha,cantidad")
      .eq("usuario_id", user.id)
      .eq("tipo", "salida")
      .gte("fecha", restarDias(hoy, 30))
      .limit(5000);

    const riesgos = detectarRiesgosNegocio({
      hoy,
      salidasStock: ((salidasRiesgo.data ?? []) as SalidaDeStock[]).map((s) => ({
        producto_id: s.producto_id,
        fecha: s.fecha,
        cantidad: Number(s.cantidad ?? 0),
      })),
      productos: ((productosRiesgo.data ?? []) as ProductoStock[]).map((p) => ({
        ...p,
        stock_actual: Number(p.stock_actual ?? 0),
        stock_minimo: Number(p.stock_minimo ?? 0),
      })),
      ventasACobrar: ((ventasRiesgo.data ?? []) as VentaACobrar[]).map((v) => ({
        ...v,
        total: Number(v.total ?? 0),
      })),
      gastos: ((gastosRiesgo.data ?? []) as GastoHistorico[]).map((g) => ({
        ...g,
        monto: Number(g.monto ?? 0),
      })),
      fijos: ((fijosRiesgo.data ?? []) as FijoDeclarado[]).map((f) => ({
        categoria: null,
        descripcion: f.descripcion ?? null,
      })),
    });

    riesgosNegocio = riesgos.map((r) => ({
      tipo: r.tipo,
      texto: redactarRiesgoNegocio(r, formatearMonto),
    }));
  }

  return NextResponse.json(
    {
      hallazgos: anomalias,
      causas,
      periodo,
      con_historia: series.size > 0,
      score,
      aviso_score: score ? avisoDeCobertura(score) : null,
      riesgos_negocio: riesgosNegocio,
    },
    { headers: noStore() },
  );
}

/** Sin `new Date` sobre el ISO: correría el día por zona horaria. */
function restarDias(iso: string, dias: number): string {
  const t = Date.parse(`${iso}T00:00:00Z`) - dias * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

function noStore() {
  return { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" };
}
