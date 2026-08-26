import { createClient } from "@/lib/supabase/server";
import { desglosarGastos, type MovimientoGasto } from "@/lib/finanzas/destinos";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** Cuántos meses de historia se grafican. Un año no entra en un teléfono. */
const MESES_HISTORIA = 6;

type Fila = {
  tipo: "ingreso" | "gasto" | "compromiso";
  monto: number | string | null;
  fecha: string;
  descripcion: string | null;
  categoria: string | null;
};

/**
 * En qué se fue la plata.
 *
 * Complemento de `/api/finanzas/estado`, que contesta "¿estoy bien?". Este
 * contesta "¿y en qué se me fue?", que es la pregunta que hoy queda sin
 * responder y la que convierte el disponible real en algo sobre lo que se
 * puede actuar.
 *
 * Va en un endpoint aparte a propósito: el panel de estado tiene que pintar
 * apenas carga la pantalla, y esto es detalle que se mira después. Comparten
 * la tabla pero no el camino crítico.
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
      .select("tipo,monto,fecha,descripcion,categoria")
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

  const filas = ((movimientosRes.data ?? []) as Fila[]).map((m) => ({
    tipo: m.tipo,
    monto: num(m.monto),
    fecha: m.fecha.slice(0, 10),
    descripcion: m.descripcion,
    categoria: m.categoria,
  }));

  const mesPrevio = meses[meses.length - 2] ?? null;

  const gastosDe = (mes: string): MovimientoGasto[] =>
    filas.filter((m) => m.tipo === "gasto" && m.fecha.startsWith(mes));

  const desglose = desglosarGastos(gastosDe(mesActual), mesPrevio ? gastosDe(mesPrevio) : []);

  // Los compromisos NO se suman a los gastos del mes: todavía no salieron de
  // la cuenta. Contarlos acá inflaría el "en qué se fue" con plata que sigue
  // estando, que es justo el error que el disponible real evita.
  const historia = meses.map((mes) => {
    const delMes = filas.filter((m) => m.fecha.startsWith(mes));
    return {
      mes,
      ingresos: redondear(sumar(delMes.filter((m) => m.tipo === "ingreso"))),
      gastos: redondear(sumar(delMes.filter((m) => m.tipo === "gasto"))),
    };
  });

  return NextResponse.json(
    {
      configurado: true,
      moneda: politicaRes.data.moneda ?? "PYG",
      mes: mesActual,
      mes_previo: mesPrevio,
      desglose,
      historia,
    },
    { headers: noStore() },
  );
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
