/**
 * La consulta que sale de EOS hacia un buscador público.
 *
 * El modelo propone la consulta (acción BUSCAR_WEB) y ya tiene la orden de
 * escribirla general. Esto es la red que no depende de que obedezca: corre en
 * el servidor, siempre, antes de que nada salga.
 *
 * Saca: correos, teléfonos, cédulas/RUC, montos, números largos, identificadores,
 * enlaces con parámetros, y los nombres privados de la cuenta (la persona, sus
 * clientes, sus proveedores) que aparecen en su contexto. No saca productos,
 * marcas, rubros ni lugares: eso es justamente lo que hay que buscar.
 */

export const LARGO_MAXIMO = 180;

function sinAcentos(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function escaparRegex(texto: string): string {
  return texto.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const PATRONES_PRIVADOS: RegExp[] = [
  // Correos.
  /[\w.+-]+@[\w-]+\.[\w.-]+/g,
  // Enlaces (pueden llevar tokens o ids en los parámetros).
  /\bhttps?:\/\/\S+/gi,
  // UUID.
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
  // Montos con moneda: ₲ 1.500.000, Gs. 300.000, USD 1.200, $ 50.
  /(?:₲|gs\.?|guaran[ií]es|usd|us\$|\$|u\$s)\s*\d[\d.,]*/gi,
  /\d[\d.,]*\s*(?:₲|gs\.?|guaran[ií]es|usd|d[oó]lares|millones|mil)\b/gi,
  // Teléfonos de Paraguay y números largos (cédula, RUC, cuentas, tarjetas).
  /\+?595[\s-]?\d[\d\s-]{6,}/g,
  // Celulares y fijos con espacios o guiones: 0981 123 456, 021-555-123.
  /\b0\d{2,3}[\s-]?\d{3}[\s-]?\d{3,4}\b/g,
  /\b\d{3}[\s-]\d{3}[\s-]\d{3,4}\b/g,
  /\b\d{1,3}(?:\.\d{3}){2,}(?:-\d)?\b/g,
  /\b\d{5,}(?:-\d)?\b/g,
  // Terminaciones de tarjeta.
  /\*{2,}\s?\d{2,4}/g,
];

/** Los nombres que NO pueden salir: la persona y los de su contexto (clientes, proveedores, contactos). */
export function privadosDelContexto(contexto: string, nombre?: string | null): string[] {
  const nombres = new Set<string>();
  const agregar = (crudo: string) => {
    const limpio = crudo
      .replace(/\(.*?\)/g, "")
      .replace(/[«»"“”]/g, "")
      .trim();
    if (limpio.length >= 3 && !/^\d/.test(limpio)) nombres.add(limpio);
  };

  if (nombre) {
    agregar(nombre);
    for (const parte of nombre.split(/\s+/)) if (parte.length >= 4) agregar(parte);
  }

  for (const linea of contexto.split(/\r?\n/)) {
    const m = linea.match(/^\s*(clientes|proveedores|contactos|deudores|acreedores)\s*:\s*(.+)$/i);
    if (!m) continue;
    for (const item of m[2].split(/[,;]/)) {
      const nombreItem = item.replace(/\(.*$/, "").trim();
      agregar(nombreItem);
    }
  }
  return [...nombres];
}

export type ConsultaLimpia = { ok: true; consulta: string; quitados: number } | { ok: false; motivo: string };

export function limpiarConsulta(cruda: unknown, privados: string[] = []): ConsultaLimpia {
  if (typeof cruda !== "string") return { ok: false, motivo: "sin_consulta" };
  let texto = cruda.replace(/\s+/g, " ").trim();
  let quitados = 0;

  for (const patron of PATRONES_PRIVADOS) {
    texto = texto.replace(patron, () => {
      quitados += 1;
      return " ";
    });
  }

  // Los nombres privados, sin importar tildes ni mayúsculas, como palabra entera.
  for (const nombre of [...privados].sort((a, b) => b.length - a.length)) {
    const patron = new RegExp(`(^|[^\\p{L}])${escaparRegex(sinAcentos(nombre))}(?=$|[^\\p{L}])`, "giu");
    const base = sinAcentos(texto);
    if (!patron.test(base)) continue;
    // Se reemplaza sobre el texto sin tildes para no fallar con "Pérez"/"Perez".
    texto = base.replace(patron, (_, antes) => {
      quitados += 1;
      return `${antes} `;
    });
  }

  texto = texto
    .replace(/[<>{}[\]`\\|]/g, " ")
    .replace(/\s+([,.;:])/g, "$1")
    .replace(/\s+/g, " ")
    .replace(/^[\s,.;:-]+|[\s,;:-]+$/g, "")
    .trim()
    .slice(0, LARGO_MAXIMO)
    .trim();

  if (texto.replace(/[^\p{L}\p{N}]/gu, "").length < 3) return { ok: false, motivo: "consulta_vacia" };
  return { ok: true, consulta: texto, quitados };
}

/** Código de país ISO de dos letras; Paraguay si no vino uno válido (EOS trabaja en Paraguay). */
export function paisDe(valor: unknown): string {
  const v = typeof valor === "string" ? valor.trim().toUpperCase() : "";
  return /^[A-Z]{2}$/.test(v) ? v : "PY";
}

const NOMBRES_PAIS: Record<string, string> = {
  PY: "Paraguay",
  AR: "Argentina",
  BR: "Brasil",
  UY: "Uruguay",
  BO: "Bolivia",
  CL: "Chile",
  US: "Estados Unidos",
  ES: "España",
  MX: "México",
  CO: "Colombia",
  PE: "Perú",
  CN: "China",
};

export function nombreDelPais(codigo: string): string {
  return NOMBRES_PAIS[codigo] ?? codigo;
}
