import type { ClienteSinTipos } from "../supabase/sin-tipos.ts";
import { sumarDias } from "../fecha.ts";
import { formatearMonto } from "../finanzas/formato.ts";
import { monedaConocida } from "../finanzas/monedas.ts";

/**
 * "¿Qué sabés de mi negocio?" (fila D5 de docs/estrategia/plan-diferenciacion-2026-09-27.md).
 *
 * Lo que vuelve difícil dejar a EOS es lo que EOS ya sabe del negocio: los
 * productos con su costo, los clientes, lo que le deben, cómo vende. Pero si
 * ese valor acumulado no se ve, no retiene. Esta respuesta lo muestra.
 *
 * Se contesta DIRECTO DESDE LA BASE, sin el modelo, y a propósito:
 *
 *  - Son números exactos. Un modelo que resume "tenés unos 40 productos"
 *    cuando son 43 es justo el tipo de error que esta respuesta no puede
 *    tener: está para demostrar que EOS sabe.
 *  - Sale en menos de un segundo y no cuesta IA.
 *  - No hace falta darla de alta en n8n ni en el worker (cuatro lugares, ver
 *    la memoria del gateway): entra en `procesar-mensaje.ts` por el mismo
 *    lugar que la respuesta del gateway en TypeScript, así que la
 *    verificación, la limpieza, el historial, el cupo y WhatsApp funcionan
 *    igual que siempre.
 *
 * La pregunta se reconoce con un patrón ANGOSTO. Un falso positivo le robaría
 * al modelo un mensaje que era otra cosa ("¿qué sabés de mi negocio de
 * tortas para Instagram?" sigue yendo al modelo por largo). Ante la duda, va
 * al modelo, que es el camino de siempre.
 */

const PATRON =
  /^(?:eos[, ]+)?(?:y\s+)?(?:que|qué)\s+(?:sabes|sabés|conoces|conocés|tenes|tenés)\s+(?:vos\s+)?(?:de|sobre)\s+(?:mi|mí)\s+(?:negocio|empresa|emprendimiento|comercio|local)(?:\s+(?:hasta\s+ahora|ya))?\s*\??$/;

const LARGO_MAXIMO = 70;

function normalizar(texto: string): string {
  return texto
    .toLowerCase()
    .replace(/[¿¡!.]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function esPreguntaQueSabes(mensaje: string): boolean {
  const limpio = normalizar(String(mensaje ?? ""));
  if (!limpio || limpio.length > LARGO_MAXIMO) return false;
  return PATRON.test(limpio);
}

export type LoQueSe = {
  productos: number;
  productosConCosto: number;
  clientes: number;
  proveedores: number;
  /** Ventas vivas de los últimos 30 días, en PYG. */
  ventas30: { cantidad: number; total: number };
  /** Día de la semana con más ventas en 90 días (0 = domingo), si hay patrón. */
  mejorDia: number | null;
  porCobrar: { clientes: number; total: number };
};

const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

/** Ventas mínimas en 90 días para hablar de "el día que más vendés". */
export const MIN_VENTAS_PARA_PATRON = 10;

/**
 * El día con más ventas, solo si se distingue del resto. Con pocas ventas, o
 * con un empate, no hay patrón y se calla: un "tu mejor día es el martes"
 * sacado de tres ventas es inventar.
 */
export function mejorDiaDeLaSemana(fechas: string[]): number | null {
  if (fechas.length < MIN_VENTAS_PARA_PATRON) return null;

  const conteo = new Array(7).fill(0) as number[];
  for (const f of fechas) {
    const d = new Date(`${String(f).slice(0, 10)}T12:00:00Z`);
    if (!Number.isNaN(d.getTime())) conteo[d.getUTCDay()] += 1;
  }

  const max = Math.max(...conteo);
  const ganadores = conteo.filter((c) => c === max).length;
  return ganadores === 1 ? conteo.indexOf(max) : null;
}

const gs = (n: number) => formatearMonto(n, "PYG");
const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;

export function redactarLoQueSe(d: LoQueSe): string {
  const lineas: string[] = [];

  if (d.productos > 0) {
    const costo =
      d.productosConCosto === d.productos
        ? d.productos === 1
          ? ", con su costo"
          : ", todos con su costo"
        : d.productosConCosto > 0
          ? ` (${d.productosConCosto} con su costo)`
          : "";
    lineas.push(`Tu catálogo: ${plural(d.productos, "producto", "productos")}${costo}.`);
  }

  if (d.clientes > 0 || d.proveedores > 0) {
    const partes = [
      d.clientes > 0 ? plural(d.clientes, "cliente", "clientes") : "",
      d.proveedores > 0 ? plural(d.proveedores, "proveedor", "proveedores") : "",
    ].filter(Boolean);
    lineas.push(`Conozco a ${partes.join(" y ")}.`);
  }

  if (d.ventas30.cantidad > 0) {
    lineas.push(
      `En los últimos 30 días hiciste ${plural(d.ventas30.cantidad, "venta", "ventas")}, por ${gs(d.ventas30.total)}.`,
    );
  }

  if (d.mejorDia !== null) {
    lineas.push(`El día que más vendés es el ${DIAS[d.mejorDia]}.`);
  }

  if (d.porCobrar.total > 0) {
    lineas.push(
      `Te deben ${gs(d.porCobrar.total)} entre ${plural(d.porCobrar.clientes, "cliente", "clientes")}. Si me preguntás "¿quién me debe?", te paso la lista.`,
    );
  }

  if (lineas.length === 0) {
    return [
      "Todavía no sé casi nada de tu negocio, y esa es la parte que más rápido se arregla.",
      "Mandame una foto de tu lista de precios y cargo tu catálogo. Después contame tus ventas como se las contarías a alguien de confianza, por ejemplo: \"vendí 3 bolsas de balanceado a 180 mil\".",
      "Con eso ya puedo decirte cuánto vendés, cuánto ganás y qué se te está por acabar.",
    ].join("\n\n");
  }

  const cierre = d.productosConCosto < d.productos
    ? `Lo que más me ayudaría ahora: el costo de ${plural(d.productos - d.productosConCosto, "producto", "productos")} que todavía no tengo. Con eso te digo cuánto ganás en cada venta.`
    : "Cuanto más me contás, mejor te aviso antes de que algo se complique.";

  return ["Esto es lo que sé de tu negocio:", ...lineas.map((l) => `• ${l}`), cierre].join("\n");
}

function contar(r: { count: number | null; error: { message?: string } | null }, que: string): number {
  if (r.error) throw new Error(`no se pudo contar ${que}: ${r.error.message ?? "desconocido"}`);
  return r.count ?? 0;
}

export async function leerLoQueSe(admin: ClienteSinTipos, usuarioId: string, hoy: string): Promise<LoQueSe> {
  const cuenta = { count: "exact" as const, head: true };

  const [productos, conCosto, clientes, proveedores, ventas, porCobrar] = await Promise.all([
    admin.from("eos_erp_productos").select("id", cuenta).eq("usuario_id", usuarioId).eq("activo", true),
    admin
      .from("eos_erp_productos")
      .select("id", cuenta)
      .eq("usuario_id", usuarioId)
      .eq("activo", true)
      .gt("costo", 0),
    admin.from("eos_crm_contactos").select("id", cuenta).eq("usuario_id", usuarioId).eq("es_cliente", true),
    admin.from("eos_crm_contactos").select("id", cuenta).eq("usuario_id", usuarioId).eq("es_proveedor", true),
    admin
      .from("eos_erp_ventas")
      .select("fecha,total,moneda")
      .eq("usuario_id", usuarioId)
      .in("estado", ["emitida", "cobrada"])
      .gte("fecha", sumarDias(hoy, -90))
      .limit(5000),
    admin
      .from("eos_erp_ventas")
      .select("total,moneda,contacto_id")
      .eq("usuario_id", usuarioId)
      .eq("condicion", "credito")
      .eq("estado", "emitida")
      .limit(5000),
  ]);

  if (ventas.error) throw new Error(`no se pudieron leer las ventas: ${ventas.error.message}`);
  if (porCobrar.error) throw new Error(`no se pudo leer lo que le deben: ${porCobrar.error.message}`);

  type Venta = { fecha: string; total: number | string | null; moneda: string | null };
  // Solo guaraníes: sumar monedas distintas no es el total de nada.
  const pyg = <T extends { moneda: string | null }>(filas: T[]) =>
    filas.filter((v) => monedaConocida(v.moneda ?? "PYG") === "PYG");

  const ventas90 = pyg((ventas.data ?? []) as Venta[]);
  const desde30 = sumarDias(hoy, -30);
  const ultimas30 = ventas90.filter((v) => String(v.fecha).slice(0, 10) >= desde30);

  const deudas = pyg((porCobrar.data ?? []) as (Venta & { contacto_id: string | null })[]);

  return {
    productos: contar(productos, "los productos"),
    productosConCosto: contar(conCosto, "los costos"),
    clientes: contar(clientes, "los clientes"),
    proveedores: contar(proveedores, "los proveedores"),
    ventas30: {
      cantidad: ultimas30.length,
      total: ultimas30.reduce((s, v) => s + Number(v.total ?? 0), 0),
    },
    mejorDia: mejorDiaDeLaSemana(ventas90.map((v) => v.fecha)),
    porCobrar: {
      clientes: new Set(deudas.map((v, i) => v.contacto_id ?? `sin-contacto-${i}`)).size,
      total: deudas.reduce((s, v) => s + Number(v.total ?? 0), 0),
    },
  };
}
