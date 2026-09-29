import type { ClienteSinTipos } from "../supabase/sin-tipos.ts";
import { empresaDe, filtroDeEmpresa } from "../empresa/acceso.ts";
import { formatearMonto } from "../finanzas/formato.ts";
import { sumarDias } from "../fecha.ts";

/**
 * "¿Cuánto vendí hoy?", contestado directo desde la base.
 *
 * Es la pregunta más común de un dueño al cerrar el día, y hasta el 29/09/2026
 * iba al modelo: tardaba segundos y el número salía del resumen que el modelo
 * recibe, no de las ventas mismas. Acá sale de `eos_erp_ventas`, con la misma
 * regla que la pantalla (lo anulado no cuenta), en menos de un segundo y sin
 * costo de IA.
 *
 *     Hoy vendiste ₲ 1.240.000 en 9 ventas.
 *     ₲ 980.000 al contado y ₲ 260.000 fiado.
 *     Lo que más salió: Lomito árabe (14), Gaseosa 2 L (9), Empanada de carne (24).
 *
 * El patrón es ANGOSTO: "¿cuánto vendí hoy / ayer / esta semana / este mes /
 * la semana pasada / el mes pasado?" y sus variantes ("cuánto facturé", "cómo
 * me fue hoy", "cuánto hice hoy"). Cualquier otra cosa ("¿cuánto vendí de
 * lomitos?", "¿cuánto gané?") va al modelo, que es el camino de siempre.
 */

export type Periodo = "hoy" | "ayer" | "semana" | "semana_pasada" | "mes" | "mes_pasado";

const PERIODOS: [RegExp, Periodo][] = [
  [/^(?:hoy|en el dia de hoy|en el día de hoy)$/, "hoy"],
  [/^ayer$/, "ayer"],
  [/^(?:esta semana|en la semana|la semana)$/, "semana"],
  [/^(?:la semana pasada)$/, "semana_pasada"],
  [/^(?:este mes|en el mes|el mes)$/, "mes"],
  [/^(?:el mes pasado)$/, "mes_pasado"],
];

const VERBO =
  /^(?:eos[, ]+)?(?:y\s+)?(?:(?:cuanto|cuánto)\s+(?:vendi|vendí|vendimos|facture|facturé|facturamos|hice|hicimos)|(?:como|cómo)\s+me\s+fue|(?:como|cómo)\s+(?:nos\s+)?fue|(?:como|cómo)\s+(?:vengo|venimos|voy|vamos)(?:\s+con\s+las\s+ventas)?|(?:las\s+)?ventas\s+de)\s+(.+?)\s*\??$/;

function normalizar(texto: string): string {
  return texto
    .toLowerCase()
    .replace(/[¿¡!.]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** El período que pregunta, o null si no es esta pregunta. */
export function periodoDeLaPregunta(mensaje: string): Periodo | null {
  const limpio = normalizar(String(mensaje ?? ""));
  if (!limpio || limpio.length > 50) return null;
  const m = limpio.match(VERBO);
  if (!m) return null;
  const resto = m[1].replace(/^(?:en\s+)?/, (x) => (m[1].startsWith("en el") ? x : "")).trim();
  for (const [patron, periodo] of PERIODOS) if (patron.test(resto)) return periodo;
  return null;
}

export function esPreguntaCuantoVendi(mensaje: string): boolean {
  return periodoDeLaPregunta(mensaje) !== null;
}

/** Desde y hasta (inclusive), en fechas de Paraguay. La semana arranca el lunes. */
export function rangoDe(periodo: Periodo, hoy: string): { desde: string; hasta: string; nombre: string } {
  const [a, m, d] = hoy.split("-").map(Number);
  const diaSemana = (new Date(Date.UTC(a, m - 1, d)).getUTCDay() + 6) % 7; // lunes = 0
  const lunes = sumarDias(hoy, -diaSemana);
  const primero = `${hoy.slice(0, 7)}-01`;
  const finMesPasado = sumarDias(primero, -1);
  switch (periodo) {
    case "hoy":
      return { desde: hoy, hasta: hoy, nombre: "Hoy" };
    case "ayer": {
      const ayer = sumarDias(hoy, -1);
      return { desde: ayer, hasta: ayer, nombre: "Ayer" };
    }
    case "semana":
      return { desde: lunes, hasta: hoy, nombre: "Esta semana" };
    case "semana_pasada":
      return { desde: sumarDias(lunes, -7), hasta: sumarDias(lunes, -1), nombre: "La semana pasada" };
    case "mes":
      return { desde: primero, hasta: hoy, nombre: "Este mes" };
    case "mes_pasado":
      return { desde: `${finMesPasado.slice(0, 7)}-01`, hasta: finMesPasado, nombre: "El mes pasado" };
  }
}

export type VentaLeida = {
  total: number | string | null;
  moneda: string | null;
  condicion: string | null;
  items?: { descripcion: string | null; cantidad: number | string | null }[] | null;
};

const num = (v: unknown) => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};

function cantidad(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toLocaleString("es-PY", { maximumFractionDigits: 2 });
}

export function redactarCuantoVendi(nombre: string, ventas: VentaLeida[]): string {
  if (ventas.length === 0) {
    return (
      `${nombre} no tengo ninguna venta anotada. ` +
      'Si vendiste algo, contámelo como te salga —"vendí 3 bolsas a 180 mil"— y lo anoto.'
    );
  }

  // Por moneda: guaraníes y dólares no se suman.
  const porMoneda = new Map<string, { total: number; contado: number; credito: number }>();
  for (const v of ventas) {
    const moneda = (v.moneda || "PYG").toUpperCase();
    const g = porMoneda.get(moneda) ?? { total: 0, contado: 0, credito: 0 };
    const t = num(v.total);
    g.total += t;
    if ((v.condicion ?? "").toLowerCase() === "credito") g.credito += t;
    else g.contado += t;
    porMoneda.set(moneda, g);
  }

  const cuantas = ventas.length === 1 ? "1 venta" : `${ventas.length} ventas`;
  const totales = [...porMoneda.entries()].map(([m, g]) => formatearMonto(g.total, m)).join(" y ");
  const lineas = [`${nombre} vendiste ${totales} en ${cuantas}.`];

  const conFiado = [...porMoneda.entries()].filter(([, g]) => g.credito > 0);
  if (conFiado.length > 0) {
    lineas.push(
      conFiado
        .map(([m, g]) => `${formatearMonto(g.contado, m)} al contado y ${formatearMonto(g.credito, m)} fiado`)
        .join("; ") + ".",
    );
  }

  const porProducto = new Map<string, number>();
  for (const v of ventas) {
    for (const it of v.items ?? []) {
      const d = (it.descripcion ?? "").trim();
      if (d) porProducto.set(d, (porProducto.get(d) ?? 0) + num(it.cantidad));
    }
  }
  const top = [...porProducto.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  if (top.length > 0) {
    lineas.push(`Lo que más salió: ${top.map(([d, c]) => `${d} (${cantidad(c)})`).join(", ")}.`);
  }

  return lineas.join("\n");
}

export async function responderCuantoVendi(
  admin: ClienteSinTipos,
  usuarioId: string,
  hoy: string,
  mensaje: string,
): Promise<string> {
  const periodo = periodoDeLaPregunta(mensaje) ?? "hoy";
  const rango = rangoDe(periodo, hoy);
  const empresaId = await empresaDe(admin, usuarioId);

  const { data, error } = await admin
    .from("eos_erp_ventas")
    .select("total,moneda,condicion,items:eos_erp_venta_items(descripcion,cantidad)")
    .or(filtroDeEmpresa(usuarioId, empresaId))
    .neq("estado", "anulada")
    .gte("fecha", rango.desde)
    .lte("fecha", rango.hasta)
    .limit(5000);

  // Lanza: quien llama sigue al modelo. Un "no vendiste nada" por un error de
  // lectura sería peor que tardar unos segundos más.
  if (error) throw new Error(`no se pudieron leer las ventas: ${error.message ?? "desconocido"}`);

  return redactarCuantoVendi(rango.nombre, (data ?? []) as VentaLeida[]);
}
