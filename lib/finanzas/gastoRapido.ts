/**
 * El efectivo: la única entrada manual que la doctrina permite.
 *
 * La hoja de ruta lo dice sin vueltas: el efectivo es el punto ciego real, y la
 * salida es "entrada mínima por excepción, nunca como flujo principal". Este
 * módulo es esa excepción, y su único requisito de diseño es que cueste una
 * línea de texto.
 *
 * Si registrar un gasto en efectivo lleva más que escribir "gasté 50 mil en
 * nafta", el usuario no lo va a hacer, y EOS va a seguir mostrando un
 * disponible más alto del real. La capa de conciliación tapa ese agujero
 * después; esto lo evita antes.
 *
 * ============================================================
 * POR QUÉ ENTIENDE "50 MIL" Y NO SOLO "50.000"
 * ============================================================
 *
 * `parsearImporte` lee lo que escribe un banco. Esto lee lo que escribe una
 * persona apurada en la caja de una estación de servicio, y una persona en
 * Paraguay escribe "50 mil", "1,5 millones", "300 lucas". Un parser que exija
 * "50.000" hace que la vía de escape no se use, y una vía de escape que no se
 * usa es igual a no tenerla.
 */

export type GastoRapido = {
  tipo: "ingreso" | "gasto";
  monto: number;
  moneda: "PYG" | "USD";
  descripcion: string;
  fecha: string;
  /** Qué tan seguro está EOS de haber entendido. La UI lo devuelve en palabras. */
  confianza: number;
};

/** Multiplicadores tal como se dicen, no como se escriben en un extracto. */
const MULTIPLICADORES: { patron: RegExp; factor: number }[] = [
  { patron: /\b(millones|millon|millón)\b/, factor: 1_000_000 },
  { patron: /\b(mil|lucas|luca)\b/, factor: 1_000 },
  { patron: /(\d)\s*k\b/, factor: 1_000 },
];

/** Primera persona: es alguien contando lo que hizo, no un aviso del banco. */
const SALE = [
  "gaste", "gasté", "pague", "pagué", "compre", "compré", "puse", "cargue",
  "cargué", "salio", "salió", "me costo", "me costó", "di", "abone", "aboné",
];

const ENTRA = [
  "cobre", "cobré", "me pagaron", "vendi", "vendí", "entro", "entró",
  "recibi", "recibí", "me dieron", "ingreso", "ingresó",
];

/** Palabras que solo describen la operación y ensucian la descripción. */
const RELLENO = new Set([
  "de", "en", "por", "para", "a", "el", "la", "los", "las", "un", "una",
  "gs", "guaranies", "guaraníes", "pyg", "y", "con", "al", "del",
]);

function sinAcentos(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function sumarDias(iso: string, dias: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + dias * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Encuentra el importe, resolviendo los multiplicadores hablados.
 *
 * Devuelve también el tramo de texto que ocupó, para poder sacarlo de la
 * descripción: "gasté 50 mil en nafta" tiene que quedar en "nafta", no en
 * "50 mil nafta".
 */
export function leerMonto(texto: string): { monto: number; moneda: "PYG" | "USD"; tramo: string } | null {
  const plano = sinAcentos(texto);

  // Número, con o sin separadores, seguido opcionalmente de un multiplicador.
  const m = plano.match(/(\d[\d.,]*)\s*(millones|millon|mil|lucas|luca|k)?\b/);
  if (!m) return null;

  const crudo = m[1];
  const palabra = m[2] ?? "";

  // El punto es separador de miles; la coma, decimal ("1,5 millones").
  const normalizado = crudo.replace(/\./g, "").replace(",", ".");
  const base = Number(normalizado);
  if (!Number.isFinite(base) || base <= 0) return null;

  let factor = 1;
  for (const { patron, factor: f } of MULTIPLICADORES) {
    if (patron.test(palabra) || (palabra === "k" && f === 1_000)) {
      factor = f;
      break;
    }
  }

  const esUSD = /\b(usd|dolares|dolar|us\$)\b/.test(plano) || /\$/.test(texto);
  const monto = Math.round(base * factor * 100) / 100;

  if (monto <= 0) return null;

  return { monto, moneda: esUSD ? "USD" : "PYG", tramo: m[0] };
}

/** Ayer, anteayer, o hoy. Nadie carga un gasto en efectivo de hace un mes. */
export function leerFecha(texto: string, hoy: string): string {
  const plano = sinAcentos(texto);
  if (/\banteayer\b/.test(plano)) return sumarDias(hoy, -2);
  if (/\bayer\b/.test(plano)) return sumarDias(hoy, -1);
  return hoy;
}

function leerDireccion(texto: string): { tipo: "ingreso" | "gasto"; seguro: boolean } {
  const plano = sinAcentos(texto);

  const entra = ENTRA.some((p) => plano.includes(sinAcentos(p)));
  const sale = SALE.some((p) => plano.includes(sinAcentos(p)));

  if (entra && !sale) return { tipo: "ingreso", seguro: true };
  if (sale && !entra) return { tipo: "gasto", seguro: true };

  // Sin verbo o con los dos, se asume gasto: es lo que el usuario viene a
  // registrar el 95% de las veces. Pero baja la confianza, y la pantalla lo
  // muestra para que el error se vea en el momento y no un mes después.
  return { tipo: "gasto", seguro: false };
}

function limpiarDescripcion(texto: string, tramoMonto: string): string {
  const sinMonto = texto.replace(new RegExp(tramoMonto.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), " ");

  const palabras = sinMonto
    .split(/\s+/)
    .map((p) => p.replace(/[.,;:!¡?¿]+$/g, "").trim())
    .filter(Boolean)
    .filter((p) => {
      const plano = sinAcentos(p);
      if (RELLENO.has(plano)) return false;
      if (SALE.some((v) => sinAcentos(v) === plano)) return false;
      if (ENTRA.some((v) => sinAcentos(v) === plano)) return false;
      if (/^(ayer|anteayer|hoy|mil|millones|millon|lucas|luca)$/.test(plano)) return false;
      if (/^\d+$/.test(plano)) return false;
      return true;
    });

  return palabras.join(" ").trim();
}

/**
 * Convierte una línea escrita a las apuradas en un movimiento.
 *
 * Devuelve `null` cuando no encuentra un importe: es preferible que la
 * pantalla diga "no te entendí" a guardar un movimiento inventado. Guardrail 3.
 */
export function interpretar(texto: string, hoy: string): GastoRapido | null {
  const limpio = (texto ?? "").trim();
  if (limpio.length === 0 || limpio.length > 200) return null;

  const importe = leerMonto(limpio);
  if (!importe) return null;

  const direccion = leerDireccion(limpio);
  const descripcion = limpiarDescripcion(limpio, importe.tramo);

  // Confianza: el verbo es la señal fuerte; la descripción, la de respaldo.
  // Nunca llega a 1: es una línea escrita al paso, no un aviso del banco.
  let confianza = 0.5;
  if (direccion.seguro) confianza += 0.3;
  if (descripcion.length >= 3) confianza += 0.15;

  return {
    tipo: direccion.tipo,
    monto: importe.monto,
    moneda: importe.moneda,
    descripcion: descripcion || "Efectivo",
    fecha: leerFecha(limpio, hoy),
    confianza: Math.round(Math.min(0.95, confianza) * 100) / 100,
  };
}

/**
 * Lo que la pantalla le devuelve al usuario después de guardar.
 *
 * No es cortesía: es el mecanismo de corrección. Como esto se guarda sin pedir
 * confirmación —a propósito, para que cueste una línea—, la única defensa
 * contra un error de lectura es que el usuario VEA lo que EOS entendió, en el
 * momento, cuando todavía se acuerda de cuánto gastó.
 */
export function confirmar(gasto: GastoRapido): string {
  const simbolo = gasto.moneda === "USD" ? "US$" : "₲";
  const monto = new Intl.NumberFormat("es-PY").format(gasto.monto);
  const verbo = gasto.tipo === "ingreso" ? "Entró" : "Salió";

  return `${verbo} ${simbolo} ${monto} — ${gasto.descripcion}`;
}
