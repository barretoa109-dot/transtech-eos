/**
 * El catálogo se cambia cuando la persona lo pide, no como efecto de otra cosa.
 *
 * ============================================================
 * EL CASO (01/10/2026, WhatsApp)
 * ============================================================
 *
 * EOS le preguntó a Sofía "Me falta el monto de venta del chaleco de encaje.
 * ¿A cuánto lo cobraste?". Ella contestó "155.000gs". EOS mandó
 * ACTUALIZAR_PRODUCTO sobre la Gorra Lacoste con costo 155.000 + 41.241 de
 * envío y contestó "La acción quedó completada": el costo de la gorra quedó
 * pisado, y seis horas después una venta de la gorra se registró con ese
 * costo. Nadie había pedido tocar la gorra, ni el catálogo.
 *
 * El modelo no veía la conversación (ver `lib/whatsapp/turno.ts`), pero el
 * defecto de fondo es otro: un monto suelto, o un pedido de registrar una
 * venta, alcanzaba para que se reescriba un producto. El prompt ya dice que
 * ACTUALIZAR_PRODUCTO es para "el azul me sale 122.414", "subí el amarillo a
 * 200.000"; una regla de prompt no alcanza como única barrera.
 *
 * ============================================================
 * LA REGLA
 * ============================================================
 *
 * Un ACTUALIZAR_PRODUCTO va solo si en ESTE turno hay un pedido de cambiar un
 * producto, en uno de dos lugares:
 *
 *   · lo que escribió la persona (sin el mensaje que citó: citar "Costo final
 *     del zapato…" para decir "registrá la venta de esto" no es pedir que se
 *     cambie el costo), o
 *   · la última pregunta de EOS, si es de esta sesión: "¿cuánto te costó?" y
 *     "101.200" es un costo; "¿a cuánto lo cobraste?" y "155.000" es una venta.
 *     Salvo que la persona esté corrigiendo ese mensaje ("no es la gorra"):
 *     lo que se corrige no autoriza nada.
 *
 * Calibrado con los 20 ACTUALIZAR_PRODUCTO reales al 05/10/2026: los montos
 * sueltos legítimos ("384.657gs", "101.200") contestaban un mensaje de EOS que
 * hablaba de costo; el del 01/10 contestaba "¿a cuánto lo cobraste?".
 *
 * Si no va, no es silencio: se dice que el catálogo no se tocó y cómo pedirlo.
 */

import type { HistorialItem } from "./entrada.ts";

function plano(texto: string): string {
  return String(texto ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

/**
 * Lo que la persona escribió en este turno: sin las líneas citadas ("> …"),
 * sin el encabezado de la cita y sin la nota de cita no encontrada, que son
 * de EOS y no de ella (ver `lib/whatsapp/cita.ts`).
 */
export function loQueEscribio(mensaje: string): string {
  return String(mensaje ?? "")
    .replace(/^\(Responde a un mensaje anterior[^)]*\)\s*/, "")
    .split("\n")
    .filter((linea) => !/^\s*>/.test(linea))
    .filter((linea) => !/^En respuesta a (este mensaje de EOS|su propio mensaje anterior):\s*$/.test(linea.trim()))
    .join("\n")
    .trim();
}

/** Palabras con las que una persona pide cambiar un producto. */
const PIDE_LA_PERSONA =
  /(cost|cuest|\bsale\b|salio|precio|catalog|envio|flete|\bsum|agreg|actualiz|cambi|corrig|correg|\bsub|\bbaj|\biva\b|exent|stock|recargo|impuesto|comision|\bvendo\b|\bvender\b|\bpone|\bpo?nele)/;

/**
 * Una pregunta de EOS cuya respuesta es un dato del producto: su costo o el
 * precio al que se vende ("¿a cuánto lo vendés?"). "¿A cuánto lo cobraste?" o
 * "¿a cuánto lo vendiste?" son de una venta: no están.
 */
const PREGUNTA_DE_PRODUCTO = /(cost|cuest|precio|catalog|envio|flete|\bvendes\b|\bvender\b)/;

/** La marca que pone `marcaDeAntiguedad` a lo que no es de esta sesión. */
const DE_OTRA_SESION = /^\[de hace \d+ (horas|dia|dias)\]/;

/** El último mensaje de EOS, si es de esta sesión de trabajo. */
export function ultimaPreguntaDeEos(historial: HistorialItem[] | unknown[] | undefined): string {
  const lista = Array.isArray(historial) ? (historial as HistorialItem[]) : [];
  for (let i = lista.length - 1; i >= 0; i -= 1) {
    const h = lista[i] ?? {};
    if (String(h.rol ?? h.role ?? "").toLowerCase() !== "eos") continue;
    const texto = String(h.texto ?? h.mensaje ?? h.content ?? "").trim();
    // Una pregunta de hace días no es la que la persona está contestando.
    return DE_OTRA_SESION.test(plano(texto)) ? "" : texto;
  }
  return "";
}

/**
 * "No es la gorra, es el chaleco", "no era ese", "te equivocaste": la persona
 * corrige lo último que dijo EOS. Ese mensaje de EOS es justo el que está mal,
 * así que no puede contar como pedido. Medido con el modelo el 05/10/2026:
 * ante "No es la gorra, es el chaleco de encaje", le pasó el envío de la gorra
 * al chaleco y pidió cambiar los costos de los dos.
 */
const CORRIGE = /^\s*(no[\s,.!]+(es|era|eran|son|fue|fueron|ese|esa|eso)\b|no[,.!]+\s|te equivocaste|estas? mal|eso no\b|ese no\b|esa no\b)/;

/** ¿Este turno pide cambiar un producto del catálogo? */
export function pideCambiarProducto(mensaje: string, historial: HistorialItem[] | unknown[] | undefined): boolean {
  const escrito = plano(loQueEscribio(mensaje));
  if (PIDE_LA_PERSONA.test(escrito)) return true;
  if (CORRIGE.test(escrito)) return false;
  return PREGUNTA_DE_PRODUCTO.test(plano(ultimaPreguntaDeEos(historial)));
}

/** Lo que se le dice cuando el cambio no va. */
export function avisoDeCatalogoSinPedido(nombres: string[]): string {
  const cuales = nombres.filter(Boolean);
  const de = cuales.length === 1 ? ` de "${cuales[0]}"` : cuales.length > 1 ? ` de ${cuales.map((n) => `"${n}"`).join(", ")}` : "";
  return (
    `No cambié nada del catálogo${de}: no me pediste modificar ese producto. ` +
    "Si querés cambiarle el costo o el precio, decímelo así y lo actualizo."
  );
}

/** Los nombres de los productos de un ACTUALIZAR_PRODUCTO, para el aviso. */
export function nombresDeProductos(datos: unknown): string[] {
  const productos = (datos && typeof datos === "object" ? (datos as Record<string, unknown>).productos : null) ?? [];
  return Array.isArray(productos)
    ? productos.map((p) => String((p as Record<string, unknown>)?.nombre ?? "").trim()).filter(Boolean)
    : [];
}
