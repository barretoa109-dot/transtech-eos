import { normalizarDescripcion } from "./recurrencia.ts";

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

      // Escritas a mano, no leídas de un extracto. Ver la nota en "comida".
      /\bcolectivo\b/,
      /\bremis\b/,
      /\btaxi\b/,
      /\bcubierta[s]?\b/,
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

      /*
       * Las comidas por su nombre.
       *
       * Los patrones de arriba son marcas y locales: lo que aparece en el
       * extracto del banco. Nadie escribe "PEDIDOSYA" cuando anota a mano —
       * escribe "el almuerzo". Con la pantalla de gastos personales esta
       * lista pasó a recibir texto escrito por una persona, y ahí las marcas
       * no alcanzan.
       *
       * Sólo las inequívocas. "comida" a secas queda afuera a propósito:
       * puede ser el súper o puede ser salir a comer, y un gasto mal
       * clasificado se lee como respuesta mientras que uno sin clasificar se
       * lee como pendiente. Para ésos está poder corregir la categoría a
       * mano, que manda sobre lo que se infiere.
       */
      /\balmuerzo\b/,
      /\balmorzar\b/,
      /\bcena\b/,
      /\bcenar\b/,
      /\bdesayuno\b/,
      /\bmerienda\b/,
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

/**
 * Lo que EOS todavía no pudo clasificar. Es una excepción que hay que revisar,
 * no un rubro de gasto: se muestra como "Por clasificar" con un aviso de cuántos
 * son, nunca como un porcentaje grande del mes.
 */
const OTROS = { clave: "otros", etiqueta: "Por clasificar" };

/** Una corrección que la persona hizo antes: "este concepto es de esta categoría". */
export type ReglaCategoria = { patron: string; categoria: string };

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
 * Valores que llegan a la columna `categoria` sin que nadie haya elegido nada:
 * el default que pone el ejecutor del chat ("general") y los rótulos de "no
 * sé". Ninguno es una categoría de la persona, así que no pueden ganar sobre
 * la inferencia del texto.
 */
const SIN_ELECCION = new Set(["general", "otros", "sin reconocer", "sin categoria"]);

/**
 * Lo que la persona escribió como categoría, limpio y acotado.
 *
 * "" si no hay nada usable o si es uno de los valores de `SIN_ELECCION`.
 */
export function limpiarCategoria(texto: string | null | undefined): string {
  const limpio = (texto ?? "").replace(/\s+/g, " ").trim().slice(0, 40);
  if (!limpio || SIN_ELECCION.has(normalizar(limpio))) return "";
  return limpio;
}

/**
 * A qué destino pertenece un gasto.
 *
 * `categoria` gana si la persona la puso, sea una de las del sistema o una
 * propia ("Granja", "Mascotas"). Antes una propia se descartaba en silencio y
 * el movimiento volvía a "Sin reconocer" aunque el usuario ya hubiera dicho
 * dónde iba. Si algún día una integración bancaria trae la categoría del
 * rubro, esa también gana: es mejor información que adivinar de un texto.
 */
/**
 * Una categoría escrita a mano o por el chat, reducida a su destino.
 *
 * Si la palabra es una clave del sistema ("comida"), es esa. Si no, se busca
 * con las mismas reglas que el texto: "almuerzo" o "uber" caen en su rubro, y
 * sólo lo que no encaja en ninguno queda como categoría propia ("Granja").
 */
function resolverCategoria(texto: string): string {
  const normal = normalizar(limpiarCategoria(texto)).trim();
  if (!normal) return "";
  if (POR_CLAVE.has(normal)) return normal;

  const porTexto = REGLAS.find((r) => r.patrones.some((p) => p.test(normal)));
  return porTexto ? porTexto.clave : normal;
}

export function clasificar(
  descripcion: string | null,
  categoria?: string | null,
  reglas: ReglaCategoria[] = [],
): string {
  const declarada = resolverCategoria(categoria ?? "");
  if (declarada) return declarada;

  if (!descripcion) return OTROS.clave;

  /*
   * Lo que la persona corrigió antes manda sobre la regla del texto: si alguna
   * vez dijo que "Uber" era de Mascotas, eso se respeta. El patrón es el núcleo
   * de la descripción, así que "Uber 35000" y "UBER 42000" caen igual, pero
   * "Uber Eats" es otro concepto.
   */
  const nucleo = normalizarDescripcion(descripcion);
  const regla = nucleo ? reglas.find((r) => r.patron === nucleo) : undefined;
  const aprendida = regla ? resolverCategoria(regla.categoria) : "";
  if (aprendida) return aprendida;

  const texto = normalizar(descripcion);

  for (const regla of REGLAS) {
    if (regla.patrones.some((p) => p.test(texto))) return regla.clave;
  }

  return OTROS.clave;
}

/**
 * Los destinos que EOS conoce, para que una pantalla pueda ofrecerlos.
 *
 * Se exporta la lista y no cada regla: quien corrige una categoría a mano
 * elige de acá, y así la corrección usa las mismas claves que la inferencia
 * en vez de crear un vocabulario paralelo que después nadie puede agrupar.
 */
export const DESTINOS: { clave: string; etiqueta: string }[] = [
  ...REGLAS.map((r) => ({ clave: r.clave, etiqueta: r.etiqueta })),
  OTROS,
];

function capitalizar(texto: string): string {
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

/**
 * Etiqueta de una clave cuando no hay un movimiento a mano. Para una propia,
 * sólo la clave: las tildes se pierden acá, por eso `destinoDe` prefiere el
 * texto que escribió la persona.
 */
export function etiquetaDe(clave: string): string {
  if (clave === OTROS.clave) return OTROS.etiqueta;
  return POR_CLAVE.get(clave) ?? capitalizar(clave);
}

/**
 * Destino y etiqueta de un movimiento.
 *
 * Para una categoría propia la etiqueta es lo que escribió la persona, con sus
 * tildes; la clave normalizada sólo sirve para agrupar. Si la clave no viene
 * de la persona, sale capitalizada.
 */
export function destinoDe(
  m: MovimientoGasto,
  reglas: ReglaCategoria[] = [],
): { clave: string; etiqueta: string } {
  const clave = clasificar(m.descripcion, m.categoria, reglas);

  const delSistema = POR_CLAVE.get(clave);
  if (delSistema) return { clave, etiqueta: delSistema };
  if (clave === OTROS.clave) return { clave, etiqueta: OTROS.etiqueta };

  return { clave, etiqueta: limpiarCategoria(m.categoria) || capitalizar(clave) };
}

function acumular(
  movimientos: MovimientoGasto[],
  reglas: ReglaCategoria[],
): Map<string, { etiqueta: string; total: number; cantidad: number }> {
  const mapa = new Map<string, { etiqueta: string; total: number; cantidad: number }>();

  for (const m of movimientos) {
    const monto = Number(m.monto);

    /*
     * Un importe roto no puede ensuciar el desglose entero. Pero un NEGATIVO
     * no está roto: desde la v141 es una devolución, y tiene que restar.
     *
     * Estaba escrito `monto <= 0` y descartaba las devoluciones en silencio.
     * El efecto era el peor posible: una camisa de 200.000 comprada y devuelta
     * seguía apareciendo como 200.000 gastados en su categoría, y el
     * presupuesto de ese rubro consumido por una compra que se deshizo.
     */
    if (!Number.isFinite(monto) || monto === 0) continue;

    const { clave, etiqueta } = destinoDe(m, reglas);
    const actual = mapa.get(clave) ?? { etiqueta, total: 0, cantidad: 0 };
    actual.total += monto;

    // Una devolución no es un gasto más: resta del total pero no cuenta como
    // una salida. Contarla haría que "3 compras" sean 4 con una devuelta.
    if (monto > 0) actual.cantidad += 1;

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
  reglas: ReglaCategoria[] = [],
): Desglose {
  const ahora = acumular(actuales, reglas);
  const antes = acumular(previos, reglas);
  const hayComparacion = previos.length > 0;

  const total = [...ahora.values()].reduce((t, v) => t + v.total, 0);
  const cantidad = [...ahora.values()].reduce((t, v) => t + v.cantidad, 0);

  const destinos = [...ahora.entries()]
    .map(([clave, v]) => ({
      clave,
      etiqueta: v.etiqueta,
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

/**
 * De dónde vino la plata.
 *
 * El reverso de `desglosarGastos`, y la otra mitad de la pregunta del usuario:
 * "a dónde va, a dónde fue". Un panel que solo explica los gastos deja creer
 * que el problema siempre está del lado del que gasta; muchas veces está del
 * lado del que cobra —un cliente que dejó de pagar, un ingreso que era único y
 * no se repitió— y eso solo se ve mirando los ingresos con la misma lupa.
 *
 * NO usa las reglas de rubro de los gastos: "ANDE" o "supermercado" no
 * significan nada en un ingreso. Se agrupa por la categoría si el usuario la
 * puso, y si no por el núcleo de la descripción, con el mismo normalizador con
 * el que `recurrencia` agrupa las series — así "Transferencia Juan Pérez
 * agosto" y "TRANSF. JUAN PEREZ - 09/2026" caen juntos, que es lo que una
 * persona espera al mirar de dónde le entra la plata.
 */
export type LineaOrigen = {
  etiqueta: string;
  total: number;
  cantidad: number;
  porcentaje: number;
  /** Lo mismo en el período anterior. `null` si no hay con qué comparar. */
  antes: number | null;
};

export type DesgloseIngresos = {
  total: number;
  cantidad: number;
  origenes: LineaOrigen[];
};

/** Cuántos orígenes se muestran antes de juntar el resto en "Otros ingresos". */
const MAX_ORIGENES = 6;

function claveDeOrigen(m: MovimientoGasto): { clave: string; etiqueta: string } {
  const categoria = (m.categoria ?? "").trim();
  if (categoria) return { clave: categoria.toLowerCase(), etiqueta: categoria };

  const nucleo = normalizarDescripcion(m.descripcion);
  if (!nucleo) return { clave: "sin-detalle", etiqueta: "Sin detalle" };

  return { clave: nucleo, etiqueta: capitalizar(nucleo) };
}

function acumularOrigenes(movimientos: MovimientoGasto[]) {
  const mapa = new Map<string, { etiqueta: string; total: number; cantidad: number }>();

  for (const m of movimientos) {
    const { clave, etiqueta } = claveDeOrigen(m);
    const actual = mapa.get(clave);

    if (actual) {
      actual.total += m.monto;
      actual.cantidad += 1;
    } else {
      mapa.set(clave, { etiqueta, total: m.monto, cantidad: 1 });
    }
  }

  return mapa;
}

export function desglosarIngresos(
  actuales: MovimientoGasto[],
  previos: MovimientoGasto[] = [],
): DesgloseIngresos {
  const ahora = acumularOrigenes(actuales);
  const antes = acumularOrigenes(previos);
  const hayComparacion = previos.length > 0;

  const total = [...ahora.values()].reduce((t, v) => t + v.total, 0);
  const cantidad = [...ahora.values()].reduce((t, v) => t + v.cantidad, 0);

  const ordenados = [...ahora.entries()].sort((a, b) => b[1].total - a[1].total);
  const principales = ordenados.slice(0, MAX_ORIGENES);
  const resto = ordenados.slice(MAX_ORIGENES);

  const origenes: LineaOrigen[] = principales.map(([clave, v]) => ({
    etiqueta: v.etiqueta,
    total: redondear(v.total),
    cantidad: v.cantidad,
    porcentaje: total > 0 ? Math.round((v.total / total) * 1000) / 10 : 0,
    antes: hayComparacion ? redondear(antes.get(clave)?.total ?? 0) : null,
  }));

  if (resto.length > 0) {
    const totalResto = resto.reduce((t, [, v]) => t + v.total, 0);

    origenes.push({
      etiqueta: `Otros ${resto.length} orígenes`,
      total: redondear(totalResto),
      cantidad: resto.reduce((t, [, v]) => t + v.cantidad, 0),
      porcentaje: total > 0 ? Math.round((totalResto / total) * 1000) / 10 : 0,
      antes: hayComparacion
        ? redondear(resto.reduce((t, [clave]) => t + (antes.get(clave)?.total ?? 0), 0))
        : null,
    });
  }

  return { total: redondear(total), cantidad, origenes };
}
