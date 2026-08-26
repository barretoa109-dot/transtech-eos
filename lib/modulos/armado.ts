/**
 * El plan que arma el usuario.
 *
 * ============================================================
 * POR QUÉ SE VAN LOS PLANES
 * ============================================================
 *
 * Hasta ahora había cinco escalones —free, personal, pro, business,
 * enterprise— y cada uno era una apuesta sobre qué combinación de funciones
 * quiere la gente. La apuesta falla siempre en el mismo lugar: alguien que solo
 * quiere conversar más tiene que pagar el panel financiero que no usa, y
 * alguien que solo quiere el panel y el briefing tiene que pagar mensajes que
 * no va a mandar.
 *
 * El pedido del usuario fue explícito: "que el usuario pueda decidir qué
 * funciones de EOS quiere... así eliminamos las opciones de los demás planes y
 * el usuario tendrá una experiencia 100% personalizada".
 *
 * Entonces no hay planes: hay módulos con precio, el usuario prende los que
 * quiere y paga la suma. Los módulos ya existían como anexos contratables
 * (ERP, CRM); esto extiende el mismo modelo al producto entero.
 *
 * ============================================================
 * ESTE ARCHIVO NO ES LA AUTORIDAD DEL PRECIO
 * ============================================================
 *
 * La lista de módulos y sus precios viven en la tabla `eos_modulos`, y el total
 * que se cobra lo calcula la base (`eos_precio_armado`). Esto es la MISMA
 * cuenta, del lado del navegador, para que el usuario vea el total cambiar
 * mientras elige sin ir y volver al servidor en cada clic.
 *
 * Que la cuenta esté en dos lados es aceptable acá y no en otros: la del
 * navegador es informativa y la de la base es la que cobra. Lo que NO puede
 * pasar es que el servidor confíe en un total que le mandó el cliente — por eso
 * `POST /api/modulos/armado` recalcula todo y descarta el número que llegó.
 */

export type ModuloCatalogo = {
  codigo: string;
  nombre: string;
  descripcion: string | null;
  precio_mensual_pyg: number;
  precio_anual_pyg: number;
  /**
   * Módulos que son alternativas entre sí: se elige UNO. Hoy lo usan los tramos
   * de conversaciones, que no tiene sentido contratar dos veces.
   */
  grupo: string | null;
  /** Mensajes por mes que habilita. `null` = no toca el cupo; `-1` = sin tope. */
  limite_mensajes: number | null;
  /** Módulos sin los cuales éste no tiene dónde mostrarse. */
  requiere: string[];
  orden: number;
};

export type Armado = {
  /** Los códigos que quedaron efectivamente contratados, ya ordenados. */
  modulos: string[];
  /** Lo que se paga por mes, con el tope ya aplicado. */
  total: number;
  /** La suma antes del tope. Se muestra tachada cuando el tope actuó. */
  subtotal: number;
  tope_aplicado: boolean;
  /** Qué se agregó solo porque otro módulo lo necesitaba. */
  agregados: string[];
  /** Por qué no se pudo armar lo que se pidió. Vacío = todo bien. */
  problemas: string[];
};

/**
 * El techo mensual.
 *
 * Lo puso el usuario: "si el usuario pide todas las opciones entonces que su
 * máximo sea Gs. 500.000". No es un descuento por volumen calculado, es una
 * promesa: prendas lo que prendas, no vas a pagar más que esto. El catálogo
 * está armado para que la suma de TODO dé exactamente este número, así la
 * promesa no es una letra chica sino la última fila de la cuenta.
 */
export const TOPE_MENSUAL_PYG = 500_000;

/** Doce meses al precio de diez: el mismo descuento que tenían los planes. */
export const MESES_DEL_ANUAL = 10;

export type Periodicidad = "mensual" | "anual";

function porCodigo(catalogo: ModuloCatalogo[]): Map<string, ModuloCatalogo> {
  return new Map(catalogo.map((m) => [m.codigo, m]));
}

/**
 * Resuelve una selección: agrega lo que falte, saca lo repetido, suma y topea.
 *
 * Es tolerante a propósito con lo que llega —códigos desconocidos, repetidos,
 * dos tramos del mismo grupo— porque la selección viaja en una URL y en el
 * estado de una pantalla, y las dos cosas se pueden ensuciar sin mala
 * intención. Lo único que se rechaza de plano es una selección vacía.
 */
export function calcularArmado(
  seleccion: string[],
  catalogo: ModuloCatalogo[],
  periodicidad: Periodicidad = "mensual",
): Armado {
  const mapa = porCodigo(catalogo);
  const problemas: string[] = [];
  const agregados: string[] = [];

  const pedidos = [...new Set(seleccion.map((c) => c.trim().toLowerCase()).filter(Boolean))];
  const existentes = pedidos.filter((c) => mapa.has(c));

  // De cada grupo de alternativas queda UNA: la más cara de las pedidas, que es
  // la que cubre a las otras. Elegir la más barata dejaría a alguien con menos
  // de lo que pidió sin decírselo.
  const elegidos = new Set<string>();
  const porGrupo = new Map<string, string>();

  for (const codigo of existentes) {
    const modulo = mapa.get(codigo)!;

    if (!modulo.grupo) {
      elegidos.add(codigo);
      continue;
    }

    const anterior = porGrupo.get(modulo.grupo);

    if (!anterior || mapa.get(anterior)!.precio_mensual_pyg < modulo.precio_mensual_pyg) {
      porGrupo.set(modulo.grupo, codigo);
    }
  }

  for (const codigo of porGrupo.values()) elegidos.add(codigo);

  // Las dependencias se agregan solas y se avisan. La alternativa —rechazar la
  // selección y hacer que el usuario adivine qué falta— convierte una compra en
  // un acertijo.
  let cambio = true;
  while (cambio) {
    cambio = false;

    for (const codigo of [...elegidos]) {
      for (const requerido of mapa.get(codigo)?.requiere ?? []) {
        if (!mapa.has(requerido) || elegidos.has(requerido)) continue;

        elegidos.add(requerido);
        agregados.push(requerido);
        cambio = true;
      }
    }
  }

  if (elegidos.size === 0) {
    problemas.push("Elegí al menos una función para armar tu EOS.");
  }

  const modulos = [...elegidos].sort(
    (a, b) => (mapa.get(a)!.orden ?? 0) - (mapa.get(b)!.orden ?? 0) || a.localeCompare(b),
  );

  const subtotalMensual = modulos.reduce((total, c) => total + mapa.get(c)!.precio_mensual_pyg, 0);
  const totalMensual = Math.min(subtotalMensual, TOPE_MENSUAL_PYG);

  // El tope es MENSUAL, así que el anual se calcula sobre el mensual ya
  // topeado. Aplicarlo después dejaría al anual pagando por encima del techo
  // que se prometió, que es la manera más rápida de que la promesa se lea como
  // una trampa.
  const subtotal = periodicidad === "anual" ? subtotalMensual * MESES_DEL_ANUAL : subtotalMensual;
  const total = periodicidad === "anual" ? totalMensual * MESES_DEL_ANUAL : totalMensual;

  return {
    modulos,
    total,
    subtotal,
    tope_aplicado: subtotalMensual > TOPE_MENSUAL_PYG,
    agregados,
    problemas,
  };
}

/**
 * El cupo de mensajes que deja una selección.
 *
 * Manda el más alto de los módulos elegidos, y `-1` (sin tope) le gana a
 * cualquier número. Sin ningún módulo de conversaciones el cupo es 0: se puede
 * tener EOS sin poder chatear —alguien que solo quiere el panel y el briefing—
 * y eso tiene que poder representarse.
 */
export function cupoDeMensajes(modulos: string[], catalogo: ModuloCatalogo[]): number {
  const mapa = porCodigo(catalogo);
  let cupo = 0;

  for (const codigo of modulos) {
    const limite = mapa.get(codigo)?.limite_mensajes;
    if (limite === null || limite === undefined) continue;
    if (limite < 0) return -1;
    if (limite > cupo) cupo = limite;
  }

  return cupo;
}

/** Cuánto costaría prender TODO, para poder mostrar el techo con un número. */
export function precioDeTodo(catalogo: ModuloCatalogo[]): number {
  const armado = calcularArmado(
    catalogo.map((m) => m.codigo),
    catalogo,
  );

  return armado.total;
}
