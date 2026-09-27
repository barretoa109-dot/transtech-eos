import { formatearMonto } from "../finanzas/formato.ts";
import { envolverEmailDeMarca, escaparHtml, primerNombre } from "../email/marca.ts";
import type { Deudor } from "../eos/quien-me-debe.ts";

/**
 * El resumen de los lunes (fila D8 de docs/estrategia/plan-diferenciacion-2026-09-27.md).
 *
 * Un producto que solo existe cuando lo abrís no crea hábito. Este correo llega
 * todos los lunes a las 8 con cuatro renglones que el dueño no tenía:
 *
 *     Vendiste ₲ 7.187.500 en 25 ventas (la semana anterior, ₲ 5.900.000).
 *     Te deben ₲ 1.500.000 entre 2 clientes; lo más atrasado es Juan (vencido hace 12 días).
 *     Se te está por acabar: Balanceado (unos 4 días).
 *     Para hoy: cobrale a Juan. ...
 *
 * Reglas:
 *
 *  - UNA SOLA COSA PARA HACER. No una lista de pendientes: la más importante,
 *    elegida por plata en juego (cobrar lo vencido, reponer lo que se acaba,
 *    completar costos, anotar ventas). Una lista de diez tareas el lunes a la
 *    mañana es ansiedad, no ayuda.
 *  - UNA LÍNEA SIN DATO NO SE INVENTA. Si no lleva stock, no hay renglón de
 *    stock. Si nadie le debe, se dice (también es una buena noticia).
 *  - LOS MISMOS NÚMEROS QUE LA PANTALLA. Lo que le deben sale de la cartera
 *    (`lib/erp/cartera-leer.ts`) y los deudores de `quien-me-debe.ts`.
 *
 * Todo lo de este archivo es puro. La lectura y el envío están en `enviar.ts`.
 */

export type Semana = {
  /** El lunes de ESTA semana (YYYY-MM-DD): la clave del resumen. */
  lunes: string;
  /** La semana que se resume: lunes a domingo pasados. */
  desde: string;
  hasta: string;
  /** La semana anterior a esa, para comparar. */
  desdeAnterior: string;
  hastaAnterior: string;
};

function sumar(iso: string, dias: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

/** El lunes de la semana de `hoy`, y las dos semanas anteriores completas. */
export function semanaDe(hoy: string): Semana {
  const dia = new Date(`${hoy}T12:00:00Z`).getUTCDay(); // 0 = domingo
  const lunes = sumar(hoy, -((dia + 6) % 7));
  return {
    lunes,
    desde: sumar(lunes, -7),
    hasta: sumar(lunes, -1),
    desdeAnterior: sumar(lunes, -14),
    hastaAnterior: sumar(lunes, -8),
  };
}

export type ProductoQueSeAcaba = {
  nombre: string;
  /** Días que le quedan al ritmo del mes; null si ya está bajo el mínimo. */
  dias: number | null;
};

export type HechosSemana = {
  ventas: { cantidad: number; total: number };
  ventasAnterior: { cantidad: number; total: number };
  /** Ordenados del más urgente al menos (`deudores()` de quien-me-debe). */
  deudores: Deudor[];
  /** Null cuando la cuenta no lleva stock de ningún producto. */
  seAcaba: ProductoQueSeAcaba[] | null;
  productos: number;
  productosSinCosto: number;
};

const gs = (n: number) => formatearMonto(n, "PYG");
const veces = (n: number) => (n === 1 ? "1 venta" : `${n} ventas`);

function lineaVentas(h: HechosSemana): string {
  if (h.ventas.cantidad === 0) {
    return h.ventasAnterior.cantidad > 0
      ? `La semana pasada no anotaste ventas (la anterior, ${gs(h.ventasAnterior.total)}).`
      : "La semana pasada no anotaste ventas.";
  }
  const comparacion = h.ventasAnterior.cantidad > 0 ? ` (la semana anterior, ${gs(h.ventasAnterior.total)})` : "";
  return `Vendiste ${gs(h.ventas.total)} en ${veces(h.ventas.cantidad)}${comparacion}.`;
}

function estadoDeudor(d: Deudor): string {
  if (d.vencidoHace !== null) return d.vencidoHace === 1 ? "vencido desde ayer" : `vencido hace ${d.vencidoHace} días`;
  return "sin vencer";
}

function lineaDeudas(h: HechosSemana): string {
  const pyg = h.deudores.filter((d) => d.moneda === "PYG");
  if (pyg.length === 0) return "Nadie te debe nada.";
  const total = pyg.reduce((s, d) => s + d.saldo, 0);
  const quienes = pyg.length === 1 ? "1 cliente" : `${pyg.length} clientes`;
  const primero = pyg[0];
  const atrasado =
    primero.vencidoHace !== null && primero.nombre
      ? `; lo más atrasado es ${primero.nombre} (${estadoDeudor(primero)})`
      : "";
  return `Te deben ${gs(total)} entre ${quienes}${atrasado}.`;
}

function lineaStock(h: HechosSemana): string | null {
  if (h.seAcaba === null) return null;
  if (h.seAcaba.length === 0) return "Nada se te está por acabar.";
  const lista = h.seAcaba
    .slice(0, 3)
    .map((p) => `${p.nombre} (${p.dias === null ? "bajo tu mínimo" : p.dias === 1 ? "1 día" : `unos ${p.dias} días`})`)
    .join(", ");
  const mas = h.seAcaba.length > 3 ? ` y ${h.seAcaba.length - 3} más` : "";
  return `Se te está por acabar: ${lista}${mas}.`;
}

/** La única cosa para hacer hoy, por plata en juego. */
export function unaCosaParaHoy(h: HechosSemana): string {
  const vencido = h.deudores.find((d) => d.moneda === "PYG" && d.vencidoHace !== null);
  if (vencido) {
    const quien = vencido.nombre ?? "tu cliente más atrasado";
    return `Cobrale a ${quien}: te debe ${gs(vencido.saldo)}. Preguntame "¿quién me debe?" y te dejo el mensaje listo para reenviar.`;
  }

  const primero = h.seAcaba?.[0];
  if (primero) {
    return `Reponé ${primero.nombre}${primero.dias === null ? ", que ya está bajo tu mínimo" : `: te dura unos ${primero.dias} días`}.`;
  }

  if (h.productosSinCosto > 0) {
    const cuantos = h.productosSinCosto === 1 ? "1 producto" : `${h.productosSinCosto} productos`;
    return `Pasame el costo de ${cuantos} que todavía no tengo. Con eso te digo cuánto ganás en cada venta.`;
  }

  if (h.ventas.cantidad === 0) {
    return 'Contame la primera venta de hoy, como se la dirías a alguien de confianza: "vendí 3 bolsas a 180 mil".';
  }

  return "Seguí contándome las ventas: el lunes que viene te digo cómo te fue.";
}

export function lineasDelResumen(h: HechosSemana): string[] {
  const cosa = unaCosaParaHoy(h);
  // Después de los dos puntos va minúscula: "Para hoy: cobrale a Juan".
  const paraHoy = `Para hoy: ${cosa.charAt(0).toLowerCase()}${cosa.slice(1)}`;
  return [lineaVentas(h), lineaDeudas(h), lineaStock(h), paraHoy].filter(
    (l): l is string => Boolean(l),
  );
}

export function redactarResumen(params: {
  hechos: HechosSemana;
  nombre: string | null | undefined;
  appUrl: string;
  urlBaja: string;
}): { asunto: string; html: string; texto: string } {
  const { hechos, appUrl, urlBaja } = params;
  const nombre = primerNombre(params.nombre);
  const saludo = nombre ? `Buen lunes, ${nombre}.` : "Buen lunes.";
  const lineas = lineasDelResumen(hechos);
  const urlChat = `${appUrl}/eos/chat`;

  const asunto =
    hechos.ventas.cantidad > 0
      ? `Tu semana: ${gs(hechos.ventas.total)} vendidos`
      : "Tu semana con EOS, en cuatro renglones";

  const html = envolverEmailDeMarca({
    eyebrow: "TU LUNES CON EOS",
    titulo: "Tu semana en cuatro renglones",
    parrafos: [saludo, ...lineas.map((l) => `• ${l}`)].map(escaparHtml),
    ctaTexto: "Hablar con EOS",
    ctaUrl: urlChat,
    pieHtml: `<p style="margin:24px 0 0;color:#94a3b8;line-height:1.6;font-size:12px;">Te mandamos este resumen los lunes porque tenés tu negocio en EOS. Si no lo querés recibir, <a href="${urlBaja}" style="color:#94a3b8;">darte de baja</a> lleva un clic.</p>`,
  });

  const texto = [
    saludo,
    "",
    ...lineas.map((l) => `- ${l}`),
    "",
    `Hablar con EOS: ${urlChat}`,
    "",
    `Si no querés recibir este resumen, date de baja acá: ${urlBaja}`,
  ].join("\n");

  return { asunto, html, texto };
}
