/**
 * A dónde se fue la plata.
 *
 * El panel financiero contesta "¿estoy bien?". Esto contesta la pregunta que
 * viene inmediatamente después y que hoy nadie contesta: "¿y en qué se me
 * fue?". Sin eso, el disponible real es un veredicto sin explicación, y un
 * veredicto sin explicación no se puede discutir ni corregir.
 *
 * Dos decisiones de fondo:
 *
 *  - EL USUARIO NO CATEGORIZA. La columna `categoria` existe en la tabla desde
 *    la v51 y nunca se llenó, porque pedirle a alguien que etiquete cada gasto
 *    es exactamente el trabajo que EOS existe para no delegar. Acá se infiere
 *    de la descripción, que es lo que ya llega solo desde el correo del banco.
 *    Si algún día `categoria` viene cargada desde una integración, manda ella.
 *
 *  - ANTES "SIN RECONOCER" QUE UNA MENTIRA. Las reglas son deliberadamente
 *    estrechas. Un gasto mal clasificado es peor que uno sin clasificar: el
 *    sin clasificar se ve como pendiente, el mal clasificado se ve como
 *    respuesta. Por eso el desglose informa cuánto quedó sin reconocer en vez
 *    de repartirlo a ojo.
 *
 * Es puro: recibe filas ya leídas y no toca la base, para poder probar la
 * clasificación sin una sesión.
 */

export type MovimientoGasto = {
  monto: number;
  fecha: string;
  descripcion: string | null;
  categoria?: string | null;
};

export type LineaDestino = {
  clave: string;
  etiqueta: string;
  total: number;
  cantidad: number;
  /** Sobre el total del período, con un decimal. */
  porcentaje: number;
  /** Lo mismo en el período anterior. `null` si no hay con qué comparar. */
  antes: number | null;
};

export type Desglose = {
  total: number;
  cantidad: number;
  /** Cuánto de `total` EOS todavía no supo explicar. */
  sin_reconocer: number;
  destinos: LineaDestino[];
};

/**
 * Las reglas, en orden de prioridad.
 *
 * El orden importa: "cuota del colegio" tiene que caer en educación, no en
 * deudas, aunque diga "cuota". Lo más específico va primero.
 *
 * Los patrones son de Paraguay a propósito — ANDE, ESSAP, Copaco, Petrobras —
 * porque una lista genérica en inglés no reconocería nada de lo que aparece
 * de verdad en el correo de un banco paraguayo.
 */
const REGLAS: { clave: string; etiqueta: string; patrones: RegExp[] }[] = [
  {
    clave: "vivienda",
    etiqueta: "Vivienda",
    patrones: [/\balquiler(es)?\b/, /\bexpensas?\b/, /\bcondominio\b/, /\bhipoteca\b/],
  },
  {
    clave: "servicios",
    etiqueta: "Servicios",
    patrones: [
      /\bande\b/,
      /\bessap\b/,
      /\bcopaco\b/,
      /\bluz\b/,
      /\bagua\b/,
      /\benergia electrica\b/,
      /\binternet\b/,
      /\bfibra optica\b/,
      /\btigo\b/,
      /\bpersonal flow\b/,
      /\bclaro\b/,
      /\bvox\b/,
      /\bcable\b/,
    ],
  },
  {
    clave: "educacion",
    etiqueta: "Educación",
    patrones: [/\bcolegio\b/, /\buniversidad\b/, /\bmatricula\b/, /\bcuota escolar\b/, /\barancel\b/],
  },
  {
    clave: "salud",
    etiqueta: "Salud",
    patrones: [
      /\bfarmacia\b/,
      /\bpuntofarma\b/,
      /\bclinica\b/,
      /\bsanatorio\b/,
      /\bhospital\b/,
      /\blaboratorio\b/,
      /\bodontolog/,
      /\bmedicina prepaga\b/,
      /\bips\b/,
    ],
  },
  {
    clave: "mercado",
    etiqueta: "Mercado",
    patrones: [
      /\bsupermercado\b/,
      /\bsuperseis\b/,
      /\bstock\b/,
      /\bbiggie\b/,
      /\barete\b/,
      /\bcasa rica\b/,
      /\bsalemma\b/,
      /\bdespensa\b/,
      /\balmacen\b/,
      /\bverduleria\b/,
      /\bcarniceria\b/,
    ],
  },
  {
    clave: "transporte",
    etiqueta: "Transporte",
    patrones: [
      /\bcombustible\b/,
      /\bnafta\b/,
      /\bgasoil\b/,
      /\bpetrobras\b/,
      /\bpuma energy\b/,
      /\bcopetrol\b/,
      /\bestacion de servicio\b/,
      /\bpeaje\b/,
      /\bestacionamiento\b/,
      /\buber\b/,
      /\bbolt\b/,
      /\bmuv\b/,
      /\bpasaje\b/,
    ],
  },
  {
    clave: "comida",
    etiqueta: "Comida fuera",
    patrones: [
      /\brestaurante\b/,
      /\bdelivery\b/,
      /\bpedidosya\b/,
      /\bmonchis\b/,
      /\bcafeteria\b/,
      /\bpizzeria\b/,
      /\bhamburgues/,
    ],
  },
  {
    clave: "suscripciones",
    etiqueta: "Suscripciones",
    patrones: [
      /\bnetflix\b/,
      /\bspotify\b/,
      /\bdisney\b/,
      /\bhbo\b/,
      /\bprime video\b/,
      /\bgoogle (one|storage)\b/,
      /\bsuscripcion\b/,
    ],
  },
  {
    clave: "deudas",
    etiqueta: "Deudas y cuotas",
    patrones: [
      /\bcuota\b/,
      /\bprestamo\b/,
      /\btarjeta de credito\b/,
      /\bfinanciera\b/,
      /\bmora\b/,
      /\bintereses?\b/,
      /\brefinanciacion\b/,
    ],
  },
  {
    clave: "impuestos",
    etiqueta: "Impuestos y tasas",
    patrones: [
      /\bimpuesto\b/,
      /\biva\b/,
      /\bmunicipalidad\b/,
      /\bpatente\b/,
      /\btributo\b/,
      /\bhabilitacion\b/,
    ],
  },
];

const OTROS = { clave: "otros", etiqueta: "Sin reconocer" };

/**
 * Minúsculas y sin tildes.
 *
 * Los patrones de arriba se escriben SIN tildes justamente porque el texto
 * llega acá ya normalizado: "Energía" y "energia" tienen que ser la misma
 * palabra, y duplicar cada patrón con y sin tilde es una forma segura de
 * olvidarse una.
 */
function normalizar(texto: string): string {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

const POR_CLAVE = new Map(REGLAS.map((r) => [r.clave, r.etiqueta]));

/**
 * A qué destino pertenece un gasto.
 *
 * `categoria` gana si viene cargada y es una clave conocida: si algún día una
 * integración bancaria trae la categoría del rubro, esa es mejor información
 * que adivinar de un texto.
 */
export function clasificar(descripcion: string | null, categoria?: string | null): string {
  const declarada = categoria ? normalizar(categoria).trim() : "";
  if (declarada && POR_CLAVE.has(declarada)) return declarada;

  if (!descripcion) return OTROS.clave;
  const texto = normalizar(descripcion);

  for (const regla of REGLAS) {
    if (regla.patrones.some((p) => p.test(texto))) return regla.clave;
  }

  return OTROS.clave;
}

export function etiquetaDe(clave: string): string {
  return POR_CLAVE.get(clave) ?? OTROS.etiqueta;
}

function acumular(movimientos: MovimientoGasto[]): Map<string, { total: number; cantidad: number }> {
  const mapa = new Map<string, { total: number; cantidad: number }>();

  for (const m of movimientos) {
    const monto = Number(m.monto);
    // Un importe roto no puede ensuciar el desglose entero.
    if (!Number.isFinite(monto) || monto <= 0) continue;

    const clave = clasificar(m.descripcion, m.categoria);
    const actual = mapa.get(clave) ?? { total: 0, cantidad: 0 };
    actual.total += monto;
    actual.cantidad += 1;
    mapa.set(clave, actual);
  }

  return mapa;
}

function redondear(valor: number): number {
  return Math.round(valor * 100) / 100;
}

/**
 * Reparte los gastos del período entre destinos, de mayor a menor.
 *
 * "Sin reconocer" siempre va último aunque sea el más grande: es una tarea
 * pendiente de EOS, no un rubro de gasto del usuario, y encabezar la lista con
 * la propia ignorancia no ayuda a decidir nada.
 */
export function desglosarGastos(
  actuales: MovimientoGasto[],
  previos: MovimientoGasto[] = [],
): Desglose {
  const ahora = acumular(actuales);
  const antes = acumular(previos);
  const hayComparacion = previos.length > 0;

  const total = [...ahora.values()].reduce((t, v) => t + v.total, 0);
  const cantidad = [...ahora.values()].reduce((t, v) => t + v.cantidad, 0);

  const destinos = [...ahora.entries()]
    .map(([clave, v]) => ({
      clave,
      etiqueta: clave === OTROS.clave ? OTROS.etiqueta : etiquetaDe(clave),
      total: redondear(v.total),
      cantidad: v.cantidad,
      porcentaje: total > 0 ? Math.round((v.total / total) * 1000) / 10 : 0,
      antes: hayComparacion ? redondear(antes.get(clave)?.total ?? 0) : null,
    }))
    .sort((a, b) => {
      if (a.clave === OTROS.clave) return 1;
      if (b.clave === OTROS.clave) return -1;
      return b.total - a.total;
    });

  return {
    total: redondear(total),
    cantidad,
    sin_reconocer: redondear(ahora.get(OTROS.clave)?.total ?? 0),
    destinos,
  };
}
