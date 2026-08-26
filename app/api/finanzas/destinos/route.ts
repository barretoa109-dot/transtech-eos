import { createClient } from "@/lib/supabase/server";
import { desglosarGastos, desglosarIngresos, type MovimientoGasto } from "@/lib/finanzas/destinos";
import { agruparPorMoneda, codigoMoneda, ordenarMonedas, volumenPorMoneda } from "@/lib/finanzas/monedas";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Cuántos meses de historia se devuelven.
 *
 * Doce y no seis: el gráfico del panel compara un mes contra el mismo mes del
 * año pasado, y con seis meses esa comparación no existe. En un negocio con
 * estacionalidad —y en Paraguay casi todos la tienen— comparar agosto contra
 * julio dice bastante menos que agosto contra agosto.
 */
const MESES_HISTORIA = 12;

type Fila = {
  tipo: "ingreso" | "gasto" | "compromiso";
  monto: number | string | null;
  moneda: string | null;
  fecha: string;
  descripcion: string | null;
  categoria: string | null;
};

/**
 * A dónde va la plata y de dónde vino.
 *
 * Complemento de `/api/finanzas/estado`, que contesta "¿estoy bien?". Este
 * contesta "¿y en qué se me fue?" y "¿de dónde me entró?", que son las
 * preguntas que convierten el disponible real en algo sobre lo que se puede
 * actuar.
 *
 * Va en un endpoint aparte a propósito: el panel de estado tiene que pintar
 * apenas carga la pantalla, y esto es detalle que se mira después. Comparten
 * la tabla pero no el camino crítico.
 *
 * Todo se calcula POR MONEDA. Mezclar dólares y guaraníes en un desglose de
 * rubros dice que el rubro más caro del mes es aquel en el que se pagó en la
 * moneda de número más grande, que no significa nada.
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Sesión no válida." }, { status: 401, headers: noStore() });
  }

  // El mes del usuario, no el del servidor: a las 23:00 en Paraguay el 31 de
  // agosto, `toISOString()` ya diría septiembre y el desglose del mes se
  // vaciaría de golpe delante de alguien que todavía está en agosto.
  const hoyISO = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Asuncion",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

  const mesActual = hoyISO.slice(0, 7);
  const meses = ultimosMeses(mesActual, MESES_HISTORIA);
  const desde = `${meses[0]}-01`;

  const [politicaRes, movimientosRes] = await Promise.all([
    supabase
      .from("eos_finanzas_politica")
      .select("moneda")
      .eq("usuario_id", user.id)
      .maybeSingle(),
    supabase
      .from("eos_movimientos_financieros")
      .select("tipo,monto,moneda,fecha,descripcion,categoria")
      .eq("usuario_id", user.id)
      .gte("fecha", desde)
      .lte("fecha", hoyISO)
      .order("fecha", { ascending: true }),
  ]);

  // Sin Constitución Financiera no hay nada que desglosar: el panel de estado
  // ya se encarga de invitar a configurarla, y repetir el pedido acá sería
  // pedir dos veces lo mismo en la misma pantalla.
  if (!politicaRes.data) {
    return NextResponse.json({ configurado: false }, { headers: noStore() });
  }

  if (movimientosRes.error) {
    console.error("No se pudieron leer los movimientos para el desglose:", movimientosRes.error);
    return NextResponse.json({ error: "No disponible." }, { status: 503, headers: noStore() });
  }

  const principal = codigoMoneda((politicaRes.data as { moneda: string | null }).moneda, "PYG");

  const filas = ((movimientosRes.data ?? []) as Fila[]).map((m) => ({
    tipo: m.tipo,
    monto: num(m.monto),
    moneda: codigoMoneda(m.moneda, principal),
    fecha: m.fecha.slice(0, 10),
    descripcion: m.descripcion,
    categoria: m.categoria,
  }));

  const mesPrevio = meses[meses.length - 2] ?? null;
  const porMoneda = agruparPorMoneda(filas, principal);
  const monedas = ordenarMonedas(volumenPorMoneda(filas, principal), principal);

  const bloques = monedas.map((moneda) => {
    const suyas = porMoneda.get(moneda) ?? [];

    const de = (mes: string, tipo: "gasto" | "ingreso"): MovimientoGasto[] =>
      suyas.filter((m) => m.tipo === tipo && m.fecha.startsWith(mes));

    // Los compromisos NO se suman a los gastos del mes: todavía no salieron de
    // la cuenta. Contarlos acá inflaría el "en qué se fue" con plata que sigue
    // estando, que es justo el error que el disponible real evita.
    const historia = meses.map((mes) => {
      const delMes = suyas.filter((m) => m.fecha.startsWith(mes));
      const ingresos = redondear(sumar(delMes.filter((m) => m.tipo === "ingreso")));
      const gastos = redondear(sumar(delMes.filter((m) => m.tipo === "gasto")));

      return { mes, ingresos, gastos, neto: redondear(ingresos - gastos) };
    });

    return {
      moneda,
      principal: moneda === principal,
      desglose: desglosarGastos(de(mesActual, "gasto"), mesPrevio ? de(mesPrevio, "gasto") : []),
      ingresos: desglosarIngresos(
        de(mesActual, "ingreso"),
        mesPrevio ? de(mesPrevio, "ingreso") : [],
      ),
      historia,
      /*
       * El mismo mes del año pasado, cuando existe.
       *
       * Se manda calculado y no crudo porque la comparación interanual es la
       * que responde "¿este mes fue malo o es que agosto siempre es así?", y
       * dejar que cada pantalla la recalcule es garantizar que dos pantallas
       * la calculen distinto.
       */
      mismo_mes_anio_pasado: comparacionInteranual(historia, mesActual),
    };
  });

  const bloquePrincipal = bloques.find((b) => b.principal) ?? bloques[0] ?? null;

  return NextResponse.json(
    {
      configurado: true,
      // La moneda principal queda en la raíz, como estaba: el desglose viejo
      // la lee de ahí.
      moneda: principal,
      mes: mesActual,
      mes_previo: mesPrevio,
      desglose: bloquePrincipal?.desglose ?? { total: 0, cantidad: 0, sin_reconocer: 0, destinos: [] },
      historia: bloquePrincipal?.historia ?? [],
      monedas: bloques,
    },
    { headers: noStore() },
  );
}

/** El mismo mes del año anterior, si está dentro de la historia devuelta. */
function comparacionInteranual(
  historia: { mes: string; ingresos: number; gastos: number }[],
  mesActual: string,
): { mes: string; ingresos: number; gastos: number } | null {
  const [anio, mes] = mesActual.split("-");
  const anterior = `${Number(anio) - 1}-${mes}`;

  return historia.find((h) => h.mes === anterior) ?? null;
}

/** Los últimos `cantidad` meses en formato `YYYY-MM`, del más viejo al actual. */
function ultimosMeses(mesActual: string, cantidad: number): string[] {
  const [anio, mes] = mesActual.split("-").map(Number);
  const salida: string[] = [];

  for (let i = cantidad - 1; i >= 0; i -= 1) {
    // Día 1 y UTC: sirve solo para restar meses, nunca se formatea como fecha.
    const d = new Date(Date.UTC(anio, mes - 1 - i, 1));
    salida.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }

  return salida;
}

function num(value: number | string | null | undefined) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function sumar(items: { monto: number }[]) {
  return items.reduce((total, item) => total + item.monto, 0);
}

function redondear(value: number) {
  return Math.round(value * 100) / 100;
}

function noStore() {
  return { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" };
}
