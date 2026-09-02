import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { adminSinTipos } from "@/lib/supabase/sin-tipos";
import { verificarModulo } from "@/lib/modulos/acceso";
import { calcular } from "@/lib/kpi/motor";
import { periodoAnterior } from "@/lib/kpi/periodo";
import { CATALOGO } from "@/lib/kpi/registro";
import { leerHechos } from "@/lib/kpi/leer";
import { detectarAnomalias, type EntradaAnomalias } from "@/lib/kpi/anomalias";
import { descomponerVentas, redactar } from "@/lib/kpi/causa";
import { formatearMonto } from "@/lib/finanzas/formato";
import { hoyEnParaguay } from "@/lib/fecha";
import type { PuntoHistoria } from "@/lib/kpi/historia";

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

  return NextResponse.json(
    { hallazgos: anomalias, causas, periodo, con_historia: series.size > 0 },
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
