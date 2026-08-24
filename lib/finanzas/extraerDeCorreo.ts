/**
 * Extracción de movimientos desde avisos bancarios por correo.
 *
 * El banco ya le avisa al usuario cada vez que se mueve su plata. Ese aviso es
 * la fuente de datos más cercana a "cero carga manual" que existe hoy en
 * Paraguay, donde no hay APIs bancarias abiertas: el usuario configura una
 * regla de reenvío una sola vez y no vuelve a tocar nada.
 *
 * A diferencia de un documento subido, un aviso bancario es texto generado por
 * una máquina: tiene un solo importe relevante, una dirección explícita
 * ("débito", "acreditación") y una fecha. Por eso acá se puede aspirar a
 * confianza alta, mientras que `extraerMovimientos` (documentos libres) tiene
 * que mandar todo a revisión.
 *
 * Puro, sin I/O, como el resto de `lib/finanzas`: un importe mal leído acá
 * entra directo al disponible real del usuario.
 */

export type CorreoEntrante = {
  asunto: string | null;
  texto: string | null;
  html: string | null;
  remitente: string | null;
  /** Fecha de recepción, ISO. Se usa si el cuerpo no trae una fecha propia. */
  recibidoEn: string;
};

export type MovimientoDeCorreo = {
  tipo: "ingreso" | "gasto";
  monto: number;
  moneda: "PYG" | "USD";
  descripcion: string;
  fecha: string;
  confianza: number;
  evidencia: string;
};

/**
 * Por debajo de esto el movimiento NO se guarda.
 *
 * Es preferible perderse un movimiento (el usuario lo nota y lo carga) a
 * meter un importe mal leído en el disponible real (el usuario NO lo nota y
 * decide con un número falso).
 */
export const CONFIANZA_MINIMA_CORREO = 0.8;

const PALABRAS_GASTO = [
  "debito",
  "debitado",
  "compra",
  "pago",
  "pagaste",
  "retiro",
  "extraccion",
  "consumo",
  "cargo",
  "transferencia enviada",
  // En plural porque así lo escribe el GNB ("Transferencias Enviadas SPI"),
  // igual que su contraparte de ingresos. Sin esto la dirección no se detecta
  // en el asunto y la confianza queda justo en el umbral: un débito real a un
  // pelo de descartarse en silencio.
  "transferencias enviadas",
  "enviaste",
  "giro enviado",
];

/**
 * Señales de que el correo es publicidad, no un aviso de movimiento.
 *
 * Los bancos mandan promociones desde la misma casilla que los avisos, y una
 * promo trae importes grandes en voz imperativa ("llevate tu notebook desde
 * Gs. 2.500.000 en 12 cuotas"). Sin este filtro, esa oferta entraba como un
 * gasto real y le descontaba al usuario plata que nunca gastó — que es la
 * peor falla posible de todo este módulo.
 */
const PALABRAS_PROMOCIONALES = [
  "sin interes",
  "cuotas",
  "promocion",
  "promo ",
  "oferta",
  "aprovecha",
  "llevate",
  "compra ahora",
  "compra online",
  "conoce nuestro",
  "novedades",
  "beneficio",
  "sorteo",
  "descuento especial",
  "suscribite",
  "terminos y condiciones",
  "no responder a este correo publicitario",
];

/**
 * Marcas de que sí ocurrió una transacción.
 *
 * Un aviso bancario real siempre dice qué pasó y sobre qué cuenta. Exigir al
 * menos una de estas evita tratar como movimiento cualquier correo que
 * mencione un importe de pasada.
 */
const PALABRAS_TRANSACCIONALES = [
  "se registro",
  "se debito",
  "se acredito",
  "se realizo",
  "se proceso",
  "operacion",
  "comprobante",
  "tu cuenta",
  "su cuenta",
  "tu tarjeta",
  "su tarjeta",
  "saldo",
  "transaccion",
  "movimiento",
  "importe",
  "te informamos",
  "le informamos",
  "recibiste",
];

const PALABRAS_INGRESO = [
  "credito",
  "acreditacion",
  "acreditado",
  "deposito",
  "depositado",
  "transferencia recibida",
  // En plural porque así lo escribe el GNB en el asunto ("Transferencias
  // Recibidas SPI"). Sin esto la dirección no se detectaba en el asunto y la
  // confianza quedaba justo en el umbral, a un pelo de descartarse.
  "transferencias recibidas",
  "recibiste",
  "salario",
  "sueldo",
  "haberes",
  "cobro recibido",
  "ingreso",
];

/* =========================================================
   TEXTO
========================================================= */

/** Quita etiquetas y entidades para poder buscar sobre el texto plano. */
export function aTextoPlano(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#\d+;/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

function sinAcentos(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

/* =========================================================
   IMPORTES
========================================================= */

/**
 * Convierte el importe tal como lo escribe el banco a número.
 *
 * En guaraníes el punto es separador de miles y no hay decimales
 * ("1.500.000"). En dólares puede venir "1,500.00" o "1.500,00" según el
 * banco. La regla: el último separador, si deja exactamente dos dígitos
 * atrás y la moneda no es PYG, es decimal; todo lo demás es de miles.
 */
export function aNumero(crudo: string, moneda: "PYG" | "USD"): number | null {
  const limpio = crudo.replace(/\s/g, "");
  if (!/\d/.test(limpio)) return null;

  const ultimoPunto = limpio.lastIndexOf(".");
  const ultimaComa = limpio.lastIndexOf(",");
  const corte = Math.max(ultimoPunto, ultimaComa);

  let entero = limpio;
  let decimales = "";

  if (moneda === "USD" && corte !== -1 && limpio.length - corte - 1 === 2) {
    entero = limpio.slice(0, corte);
    decimales = limpio.slice(corte + 1);
  }

  const valor = Number(`${entero.replace(/[.,]/g, "")}.${decimales || "0"}`);
  return Number.isFinite(valor) && valor > 0 ? valor : null;
}

type ImporteHallado = { monto: number; moneda: "PYG" | "USD"; crudo: string; indice: number };

/**
 * Busca importes con su moneda explícita.
 *
 * Solo se aceptan importes que traen la moneda pegada. Un número suelto en un
 * correo puede ser un número de cuenta, un código de operación o un saldo:
 * confundir cualquiera de esos con un movimiento sería peor que no detectar.
 */
export function buscarImportes(texto: string): ImporteHallado[] {
  const patrones: { re: RegExp; moneda: "PYG" | "USD" }[] = [
    { re: /(?:gs\.?|g\.|₲|pyg)\s*([\d][\d.,]*)/gi, moneda: "PYG" },
    { re: /([\d][\d.,]*)\s*(?:gs\.?|₲|guaranies|guaraníes)/gi, moneda: "PYG" },
    { re: /(?:us\$|usd|u\$s|\$us)\s*([\d][\d.,]*)/gi, moneda: "USD" },
  ];

  const hallados: ImporteHallado[] = [];

  for (const { re, moneda } of patrones) {
    for (const m of texto.matchAll(re)) {
      const monto = aNumero(m[1], moneda);
      if (monto === null) continue;
      hallados.push({ monto, moneda, crudo: m[0].trim(), indice: m.index ?? 0 });
    }
  }

  return hallados.sort((a, b) => a.indice - b.indice);
}

/* =========================================================
   DIRECCIÓN Y FECHA
========================================================= */

function marcaDireccion(texto: string): { tipo: "ingreso" | "gasto"; pos: number } | null {
  const plano = sinAcentos(texto);

  // Se busca la primera coincidencia por posición, no por orden de la lista:
  // "transferencia recibida ... pago a" tiene que ganar el que aparece antes.
  let mejor: { tipo: "ingreso" | "gasto"; pos: number } | null = null;

  for (const palabra of PALABRAS_INGRESO) {
    const pos = plano.indexOf(palabra);
    if (pos !== -1 && (mejor === null || pos < mejor.pos)) mejor = { tipo: "ingreso", pos };
  }
  for (const palabra of PALABRAS_GASTO) {
    const pos = plano.indexOf(palabra);
    if (pos !== -1 && (mejor === null || pos < mejor.pos)) mejor = { tipo: "gasto", pos };
  }

  return mejor;
}

function direccionEn(texto: string): "ingreso" | "gasto" | null {
  return marcaDireccion(texto)?.tipo ?? null;
}

/**
 * Palabras que convierten a un importe en un SALDO y no en un movimiento.
 *
 * Casi todo aviso bancario informa el saldo junto con la operación, y el saldo
 * siempre es el número más grande del correo. Tomarlo por el movimiento no
 * produce un error chico: convierte una acreditación de ₲500.000 en un ingreso
 * de ₲4.200.000, con confianza suficiente para guardarse solo.
 */
const PALABRAS_DE_SALDO = ["saldo", "limite disponible", "disponible es", "cupo"];

/** ¿El importe que empieza en `indice` viene precedido por palabra de saldo? */
function pareceSaldo(plano: string, indice: number): boolean {
  const antes = plano.slice(Math.max(0, indice - 35), indice);
  return PALABRAS_DE_SALDO.some((p) => antes.includes(p));
}

/**
 * De todos los importes del aviso, cuál es el del movimiento.
 *
 * La regla es semántica, no posicional: **el importe del movimiento es el que
 * está más cerca de la palabra que dice qué pasó** ("se acreditó", "consumo",
 * "se debitó"). Tomar el primero funcionaba solo mientras el banco escribiera
 * la operación antes que el saldo; dado vuelta —"su saldo es X luego de la
 * acreditación de Y"— guardaba el saldo como ingreso.
 *
 * Un importe pegado a la palabra "saldo" queda descartado salvo que sea el
 * único: es la señal más fuerte de que ese número no es el movimiento.
 */
function elegirPrincipal(
  importes: ImporteHallado[],
  plano: string,
  posicionDireccion: number,
): ImporteHallado {
  const noSaldo = importes.filter((i) => !pareceSaldo(plano, i.indice));
  const candidatos = noSaldo.length > 0 ? noSaldo : importes;

  return candidatos.reduce((mejor, actual) =>
    Math.abs(actual.indice - posicionDireccion) < Math.abs(mejor.indice - posicionDireccion)
      ? actual
      : mejor,
  );
}

/** Fecha del cuerpo (dd/mm/aaaa o dd-mm-aaaa). Si no hay, la del correo. */
function buscarFecha(texto: string, porDefecto: string): string {
  const m = texto.match(/\b(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})\b/);
  if (!m) return porDefecto.slice(0, 10);

  const dia = Number(m[1]);
  const mes = Number(m[2]);
  const anioCrudo = Number(m[3]);
  const anio = anioCrudo < 100 ? 2000 + anioCrudo : anioCrudo;

  if (dia < 1 || dia > 31 || mes < 1 || mes > 12) return porDefecto.slice(0, 10);

  return `${anio}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
}

/**
 * Descripción legible del movimiento.
 *
 * El asunto del aviso suele ser lo más informativo que tiene el correo
 * ("Compra con tarjeta - SUPERMERCADO X"). Como esta descripción alimenta la
 * detección de recurrencia, importa que sea estable entre avisos del mismo
 * tipo — por eso sale del asunto y no del cuerpo, que cambia siempre.
 */
function describir(correo: CorreoEntrante, cuerpo: string): string {
  // El caso normal acá es un REENVÍO: el usuario configura una regla y su
  // correo antepone "Fwd:". El asunto original vive dentro del cuerpo, en la
  // cabecera del mensaje reenviado, y es más limpio y más estable que el
  // reenviado — importa porque de esta descripción sale la clave con la que
  // se agrupan las series recurrentes.
  const original = cuerpo.match(/^\s*(?:Subject|Asunto):\s*(.+)$/mi)?.[1]?.trim();
  const asunto = (original || correo.asunto || "").trim();

  const limpio = asunto.replace(/^((re|rv|fwd?|fw)\s*:\s*)+/i, "").trim();
  if (limpio) return limpio.slice(0, 160);

  const dominio = (correo.remitente ?? "").split("@")[1]?.split(".")[0];
  return dominio ? `Aviso de ${dominio}` : "Movimiento informado por correo";
}

/* =========================================================
   EXTRACCIÓN
========================================================= */

/**
 * Extrae los movimientos de un aviso bancario.
 *
 * Deliberadamente conservador: si el correo trae varios importes (típico
 * cuando además informa el saldo o el límite disponible) no se adivina cuál es
 * el movimiento. Se toma el primero solo cuando hay una dirección clara y se
 * baja la confianza, de modo que el umbral lo descarte si además el resto del
 * aviso es ambiguo.
 */
export function extraerDeCorreo(correo: CorreoEntrante): MovimientoDeCorreo[] {
  const cuerpo = (correo.texto?.trim() || (correo.html ? aTextoPlano(correo.html) : "")).slice(
    0,
    20_000,
  );
  const asunto = correo.asunto ?? "";
  const completo = `${asunto}\n${cuerpo}`;

  const plano = sinAcentos(completo);

  // Publicidad: se descarta entero. Un banco manda promos desde la misma
  // casilla que los avisos, y una promo con importe grande entraría como gasto.
  if (PALABRAS_PROMOCIONALES.some((p) => plano.includes(p))) return [];

  // "desde Gs. X" / "hasta Gs. X" es lenguaje de rango, no de transacción.
  if (/\b(desde|hasta)\s*(gs\.?|g\.|₲|pyg|us\$|usd)/i.test(completo)) return [];

  // Y tiene que decir explícitamente que pasó algo sobre una cuenta.
  if (!PALABRAS_TRANSACCIONALES.some((p) => plano.includes(p))) return [];

  const importes = buscarImportes(completo);
  if (importes.length === 0) return [];

  // El asunto es la señal más confiable de dirección; el cuerpo, la de respaldo.
  const dirAsunto = direccionEn(asunto);
  const dirCuerpo = direccionEn(cuerpo);
  const tipo = dirAsunto ?? dirCuerpo;

  if (!tipo) return [];

  const fecha = buscarFecha(cuerpo, correo.recibidoEn);
  const descripcion = describir(correo, cuerpo);
  const principal = elegirPrincipal(importes, plano, marcaDireccion(completo)?.pos ?? 0);

  // Confianza: máxima cuando el asunto dice la dirección y hay un único
  // importe en todo el aviso. Cada ambigüedad la baja.
  let confianza = 0.7;
  if (dirAsunto) confianza += 0.15;
  if (dirAsunto && dirCuerpo && dirAsunto === dirCuerpo) confianza += 0.05;
  if (importes.length === 1) confianza += 0.1;
  else confianza -= 0.1 * Math.min(importes.length - 1, 3);

  confianza = Math.max(0, Math.min(0.98, Math.round(confianza * 100) / 100));

  return [
    {
      tipo,
      monto: principal.monto,
      moneda: principal.moneda,
      descripcion,
      fecha,
      confianza,
      evidencia: principal.crudo,
    },
  ];
}
