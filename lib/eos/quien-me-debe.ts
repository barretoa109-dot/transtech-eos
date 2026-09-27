import type { ClienteSinTipos } from "../supabase/sin-tipos.ts";
import { estaPendiente, saldoDe, type DocumentoCartera } from "../erp/cartera.ts";
import { leerCartera } from "../erp/cartera-leer.ts";
import { formatearMonto } from "../finanzas/formato.ts";
import { primerNombre } from "../email/marca.ts";

/**
 * "¿Quién me debe?" (fila D7 de docs/estrategia/plan-diferenciacion-2026-09-27.md).
 *
 * El dueño de una pyme paraguaya fía, y le da vergüenza cobrar. Esta
 * respuesta hace las dos cosas que le cuestan: le dice a quién cobrarle
 * primero, y le deja el mensaje escrito para que solo tenga que reenviarlo.
 *
 *     Te deben ₲ 1.500.000 entre 2 clientes:
 *     • Juan Pérez: ₲ 1.000.000, vencido hace 12 días.
 *     • María López: ₲ 500.000, desde hace 5 días.
 *
 *     Para cobrarle a Juan Pérez, podés reenviarle esto:
 *     "Hola Juan, ¿cómo estás? ..."
 *
 * Reglas:
 *
 *  - EOS NO LE ESCRIBE AL DEUDOR. Prepara el texto y el dueño decide si lo
 *    manda, a quién y cuándo. Cobrarle a alguien en nombre de otro sin que lo
 *    decida en ese momento no es algo que un encargado haga solo.
 *  - EL SALDO, NO EL TOTAL. Lee la cartera con `lib/erp/cartera-leer.ts`, la
 *    misma que la pantalla: un cliente que pagó la mitad debe la mitad.
 *  - PRIMERO LO MÁS ATRASADO. Lo vencido antes que lo que no venció; entre
 *    iguales, lo más viejo. Es a quién hay que llamar primero.
 *  - EL MENSAJE ES AMABLE Y NO AMENAZA. Menciona el monto y la fecha de la
 *    compra, y pregunta cuándo le queda bien. Nada de "urgente" ni "último
 *    aviso": el cliente que fía hoy es el que compra mañana.
 */

const PATRON =
  /^(?:eos[, ]+)?(?:y\s+)?(?:(?:quien|quién|quienes|quiénes)\s+me\s+(?:debe|deben)(?:\s+plata)?|(?:cuanto|cuánto|que|qué)\s+me\s+(?:debe|deben)(?:\s+(?:mis\s+)?clientes)?|(?:a\s+)?(?:quien|quién|quienes|quiénes)\s+(?:le|les)\s+tengo\s+que\s+cobrar|(?:mis\s+)?deudores|lista\s+de\s+deudores|(?:que|qué)\s+tengo\s+(?:para|por)\s+cobrar)(?:\s+(?:hoy|ahora|todavía|todavia))?\s*\??$/;

const LARGO_MAXIMO = 60;
/** Cuántos deudores se listan con nombre; el resto se resume. */
export const MAXIMO_EN_LISTA = 8;

function normalizar(texto: string): string {
  return texto
    .toLowerCase()
    .replace(/[¿¡!.]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function esPreguntaQuienMeDebe(mensaje: string): boolean {
  const limpio = normalizar(String(mensaje ?? ""));
  if (!limpio || limpio.length > LARGO_MAXIMO) return false;
  return PATRON.test(limpio);
}

export type Deudor = {
  nombre: string | null;
  moneda: string;
  saldo: number;
  /** La compra más vieja que todavía debe (YYYY-MM-DD). */
  desde: string;
  /** Días de atraso contra el vencimiento más viejo; null si nada venció. */
  vencidoHace: number | null;
  /** El vencimiento pactado más próximo que todavía no llegó, si hay. */
  venceEl: string | null;
};

function dias(desde: string, hasta: string): number {
  return Math.round((Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / 86_400_000);
}

/** dd/mm, como se escribe una fecha en un mensaje. */
function fechaCorta(iso: string): string {
  const [, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}`;
}

/** Agrupa lo pendiente por cliente y moneda, del más urgente al menos. */
export function deudores(documentos: DocumentoCartera[], hoy: string): Deudor[] {
  const grupos = new Map<string, Deudor>();

  for (const d of documentos) {
    if (!estaPendiente(d)) continue;

    const clave = `${d.contacto_id ?? `sin:${d.contacto_nombre ?? ""}`}|${d.moneda}`;
    const g = grupos.get(clave) ?? {
      nombre: d.contacto_nombre,
      moneda: d.moneda,
      saldo: 0,
      desde: d.fecha,
      vencidoHace: null,
      venceEl: null,
    };

    g.saldo += saldoDe(d);
    if (d.fecha < g.desde) g.desde = d.fecha;

    if (d.vence_el) {
      const atraso = dias(d.vence_el, hoy);
      if (atraso > 0) g.vencidoHace = Math.max(g.vencidoHace ?? 0, atraso);
      else if (!g.venceEl || d.vence_el < g.venceEl) g.venceEl = d.vence_el;
    }

    grupos.set(clave, g);
  }

  return [...grupos.values()].sort(
    (a, b) =>
      (b.vencidoHace ?? -1) - (a.vencidoHace ?? -1) ||
      a.desde.localeCompare(b.desde) ||
      b.saldo - a.saldo,
  );
}

function estado(d: Deudor, hoy: string): string {
  if (d.vencidoHace !== null) {
    return d.vencidoHace === 1 ? "vencido desde ayer" : `vencido hace ${d.vencidoHace} días`;
  }
  if (d.venceEl) return `vence el ${fechaCorta(d.venceEl)}`;
  const n = dias(d.desde, hoy);
  return n <= 0 ? "desde hoy" : n === 1 ? "desde ayer" : `desde hace ${n} días`;
}

/** El mensaje para reenviarle al cliente. Amable, con monto y fecha. */
export function mensajeDeCobro(d: Deudor): string {
  const nombre = primerNombre(d.nombre);
  const saludo = nombre ? `Hola ${nombre}, ¿cómo estás?` : "Hola, ¿cómo estás?";
  return (
    `${saludo} Te escribo por el saldo de ${formatearMonto(d.saldo, d.moneda)} ` +
    `de tu compra del ${fechaCorta(d.desde)}. ¿Cuándo te queda bien pasarlo? ¡Gracias!`
  );
}

export function redactarQuienMeDebe(lista: Deudor[], hoy: string): string {
  if (lista.length === 0) {
    return (
      "Según lo que tengo anotado, nadie te debe nada. " +
      'Si vendiste fiado y no me lo contaste, decime por ejemplo "le vendí a crédito a Juan 2 bolsas a 180 mil" y lo llevo yo.'
    );
  }

  // El total por moneda: guaraníes y dólares no se suman.
  const totales = new Map<string, number>();
  for (const d of lista) totales.set(d.moneda, (totales.get(d.moneda) ?? 0) + d.saldo);
  const total = [...totales.entries()].map(([m, t]) => formatearMonto(t, m)).join(" y ");
  const quienes = lista.length === 1 ? "1 cliente" : `${lista.length} clientes`;

  const lineas = lista
    .slice(0, MAXIMO_EN_LISTA)
    .map((d) => `• ${d.nombre ?? "Sin cliente anotado"}: ${formatearMonto(d.saldo, d.moneda)}, ${estado(d, hoy)}.`);

  const resto = lista.slice(MAXIMO_EN_LISTA);
  if (resto.length > 0) {
    const otros = resto.length === 1 ? "1 cliente más" : `${resto.length} clientes más`;
    lineas.push(`• Y ${otros}. La lista completa está en Negocio > Cartera.`);
  }

  const primero = lista[0];
  const conNombre = primero.nombre
    ? `Para cobrarle a ${primero.nombre}, podés reenviarle esto:`
    : "Para cobrar la más atrasada, podés reenviar esto:";

  return [
    `Te deben ${total} entre ${quienes}:`,
    ...lineas,
    "",
    conNombre,
    `"${mensajeDeCobro(primero)}"`,
    "",
    "Si querés el mensaje para otro, decime a quién.",
  ].join("\n");
}

export async function responderQuienMeDebe(
  admin: ClienteSinTipos,
  usuarioId: string,
  hoy: string,
): Promise<string> {
  const { documentos } = await leerCartera(admin, usuarioId, "cobrar");
  return redactarQuienMeDebe(deudores(documentos, hoy), hoy);
}
