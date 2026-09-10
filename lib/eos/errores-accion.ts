/**
 * Traducir el error de una acción del negocio a algo que se pueda resolver.
 *
 * ============================================================
 * SE PERDÍAN TODOS, Y ES LA CAUSA DE "EOS NO REGISTRA NADA"
 * ============================================================
 *
 * `eos_execute_internal_effect_v64` y las funciones que llama levantan seis
 * excepciones con nombre propio: no encontré el producto, no encontré el
 * contacto, falta el nombre, la venta no trae ítems, el módulo no está activo.
 *
 * Ninguna estaba mapeada en `app/api/internal/action-effects/v1`, así que las
 * seis caían al `500` genérico con "No fue posible ejecutar el efecto
 * interno". Del otro lado hay una persona que pidió "vendí 3 bolsas de
 * balanceado a Rossana" y recibe "No pude completar automáticamente:
 * REGISTRAR_VENTA", sin una palabra sobre qué falló.
 *
 * Reproducido contra producción el 7 de septiembre de 2026: la venta no entró
 * porque Rossana no estaba entre sus contactos. El único dato que servía para
 * arreglarlo —el nombre que no se pudo resolver— se descartaba en el camino.
 *
 * ============================================================
 * NO SON ERRORES DEL SERVIDOR
 * ============================================================
 *
 * Ninguna de las seis es una falla: la petición está bien formada y la regla
 * de negocio dice que no. Por eso salen con **422** y no con 500.
 *
 * Que no aparezcan como 500 importa también del lado de adentro: un 500 es una
 * alarma, y seis situaciones normales disfrazadas de alarma enseñan a ignorar
 * las alarmas.
 *
 * ============================================================
 * CADA MENSAJE DICE EL SIGUIENTE PASO
 * ============================================================
 *
 * "No encontré el producto" deja a la persona en el mismo lugar. "No encontré
 * «balanceado» entre tus productos, decime cuál es o cargalo en Negocio >
 * Productos" la deja a un paso de resolverlo. Es la diferencia entre un error
 * y una instrucción.
 */

import { formatearMonto } from "../finanzas/formato.ts";

export type ErrorDeAccion = {
  codigo: string;
  /** Lo que ve el usuario. Tiene que decir qué hacer, no solo qué pasó. */
  mensaje: string;
  /**
   * Qué clase de "no" es.
   *
   *   422 — la petición está bien y la regla del negocio dice que no. Es una
   *         situación normal y la persona puede resolverla.
   *   500 — la base rechazó la orden. No es culpa de lo que escribió y no lo
   *         va a arreglar reformulando.
   *
   * La diferencia importa del lado de adentro también: un 500 es una alarma, y
   * seis situaciones normales disfrazadas de alarma enseñan a ignorarlas.
   */
  estado: 422 | 500;
};

type Regla = { codigo: string; mensaje: (detalle: string) => string };

/**
 * Los detalles que traen plata vienen como `MONEDA|resto`.
 *
 * ============================================================
 * LA BASE NO FORMATEA MONTOS, Y ESTE ES EL MOTIVO
 * ============================================================
 *
 * La v151 escribía el importe con `to_char` de Postgres, que usa el locale
 * del servidor: agrupa con coma y separa decimales con punto. Sesenta mil
 * guaraníes le llegaban a la persona como "60,000." — su propia plata con el
 * formato de otro país.
 *
 * El formato de la plata vive en `lib/finanzas/formato.ts` y en ningún otro
 * lado. La base manda el número pelado con su moneda, y acá se escribe.
 */
function conMoneda(detalle: string): { moneda: string; resto: string } {
  const corte = detalle.indexOf("|");
  if (corte < 0) return { moneda: "PYG", resto: detalle };
  return { moneda: detalle.slice(0, corte) || "PYG", resto: detalle.slice(corte + 1) };
}

/** `2026-08-21` a `21/08`. La fecha larga en una lista de tres no aporta. */
function diaYMes(iso: string): string {
  const [, mes, dia] = iso.split("-");
  return mes && dia ? `${dia}/${mes}` : iso;
}

const REGLAS: Regla[] = [
  {
    codigo: "EOS_ACCION_PRODUCTO_NO_RESUELTO",
    mensaje: (d) =>
      `No encontré "${d}" entre tus productos, o hay más de uno que se llama parecido. ` +
      "Decime cuál es exactamente, o pasame el precio de venta y te lo cargo al catálogo.",
  },
  {
    codigo: "EOS_ACCION_CONTACTO_NO_RESUELTO",
    mensaje: (d) =>
      `No encontré a "${d}" entre tus contactos. Pedime que lo agende primero ` +
      `—"agendá a ${d}"— y después registramos la venta a su nombre.`,
  },
  {
    codigo: "EOS_ACCION_CONTACTO_SIN_NOMBRE",
    mensaje: () => "Para agendar un contacto necesito al menos su nombre.",
  },
  {
    codigo: "EOS_ACCION_VENTA_SIN_ITEMS",
    mensaje: () =>
      'No entendí qué se vendió ni cuánto. Decímelo así: "vendí 3 bolsas de balanceado".',
  },
  {
    codigo: "EOS_ACCION_PRODUCTO_SIN_PRECIO",
    mensaje: (d) =>
      `Me falta a cuánto vendés "${d}". Decime el precio y lo cargo. ` +
      "Sin precio, la primera venta se registraría en cero y te ensuciaría el margen del mes.",
  },
  {
    codigo: "EOS_ACCION_PRODUCTO_SIN_NOMBRE",
    mensaje: () => "Para cargar un producto necesito al menos su nombre.",
  },
  {
    codigo: "EOS_ACCION_PRODUCTO_DEMASIADOS",
    mensaje: () =>
      "Son demasiados productos para cargar de una. Pasámelos de a diez, " +
      "o subí la planilla desde Negocio > Productos, que te muestra la vista previa antes de guardar.",
  },
  {
    codigo: "EOS_ACCION_PRODUCTO_SIN_DATOS",
    mensaje: () => "No entendí qué producto cargar. Decime el nombre y el precio de venta.",
  },
  {
    codigo: "EOS_ACCION_COMPRA_SIN_ITEMS",
    mensaje: () =>
      "No entendí qué se compró. Decímelo así: \"cargá 3 bolsas de balanceado a 68.000 cada una\".",
  },
  {
    codigo: "EOS_ACCION_COMPRA_SIN_CONCEPTO",
    mensaje: () => "Para registrar una compra necesito saber qué se compró, aunque sea con una palabra.",
  },
  {
    codigo: "EOS_ACCION_COMPRA_SIN_MONTO",
    mensaje: (d) =>
      `Me falta cuánto costó "${d}". Decime el total o el precio de cada uno y lo registro.`,
  },
  {
    codigo: "EOS_ACCION_COMPRA_DEMASIADOS",
    mensaje: () =>
      "Son demasiados conceptos para una sola compra dictada. Pasámelos de a veinte, " +
      "o cargá la factura desde Negocio > Compras.",
  },
  {
    codigo: "EOS_ACCION_COMPRA_SIN_ID",
    mensaje: () =>
      "Algo falló registrando la compra y prefiero no decirte que quedó. " +
      "Probá de nuevo, y si vuelve a pasar cargala desde Negocio > Compras.",
  },
  {
    codigo: "EOS_ACCION_FIJO_SIN_DATOS",
    mensaje: () =>
      'No entendí qué gasto fijo declarar. Decímelo así: "el alquiler son 2.000.000 por mes".',
  },
  {
    codigo: "EOS_ACCION_FIJO_SIN_DESCRIPCION",
    mensaje: () => "Para declarar un gasto fijo necesito saber de qué es.",
  },
  {
    codigo: "EOS_ACCION_FIJO_SIN_MONTO",
    mensaje: (d) => `Me falta cuánto es "${d}" y cada cuánto se paga.`,
  },
  {
    codigo: "EOS_ACCION_PERSONAL_SIN_DATOS",
    mensaje: () => 'No entendí qué anotar. Decímelo así: "gasté 50 mil en nafta".',
  },
  {
    codigo: "EOS_ACCION_PERSONAL_SIN_DESCRIPCION",
    mensaje: () => "Para anotarlo necesito saber en qué fue, aunque sea una palabra.",
  },
  {
    codigo: "EOS_ACCION_PERSONAL_SIN_MONTO",
    mensaje: (d) => `Me falta cuánto fue "${d}".`,
  },
  {
    codigo: "EOS_ACCION_PERSONAL_DEMASIADOS",
    mensaje: () => "Son demasiados movimientos de una. Pasámelos de a quince.",
  },
  {
    codigo: "EOS_ACCION_FIJO_DEMASIADOS",
    mensaje: () => "Son demasiados gastos fijos de una. Pasámelos de a diez.",
  },
  {
    codigo: "EOS_ACCION_TRANSFERENCIA_SIN_MONTO",
    mensaje: () => "Me falta cuánto pasaste de una cuenta a la otra.",
  },
  {
    codigo: "EOS_ACCION_TRANSFERENCIA_SIN_CUENTAS",
    mensaje: () =>
      "Para anotar una transferencia necesito las dos puntas. Decímelo así: " +
      "\"pasé 1 millón de Ueno a Continental\".",
  },
  {
    codigo: "EOS_ACCION_TRANSFERENCIA_MISMA_CUENTA",
    mensaje: (d) => `Pusiste \"${d}\" de los dos lados: una transferencia va de una cuenta a otra.`,
  },
  {
    codigo: "EOS_ACCION_DEUDA_SIN_ACREEDOR",
    mensaje: () => "Para anotar una deuda necesito a quién le debés.",
  },

  /*
   * Las cuatro de CORREGIR_MOVIMIENTO (v148).
   *
   * Las tres primeras son datos que faltan y que la persona puede completar en
   * la misma frase. La cuarta —no lo encontré— es la que más importa que diga
   * QUÉ buscó: si EOS buscó "nafta" y la fila decía "combustible", el único
   * dato que resuelve el problema es cuál palabra usó.
   */
  {
    codigo: "EOS_ACCION_CORRECCION_SIN_REFERENCIA",
    mensaje: () =>
      "Decime cuál movimiento corrijo. Alcanza con la palabra con la que lo anotaste: " +
      '"el gasto de nafta era 80 mil".',
  },
  {
    codigo: "EOS_ACCION_CORRECCION_SIN_CAMBIO",
    mensaje: () =>
      "Entendí cuál movimiento, pero no qué cambiarle. Decime el monto correcto, " +
      "la fecha o cómo debería llamarse.",
  },
  {
    codigo: "EOS_ACCION_CORRECCION_MONTO_INVALIDO",
    mensaje: () => "Ese monto no me cierra: tiene que ser mayor que cero.",
  },
  {
    codigo: "EOS_ACCION_MOVIMIENTO_NO_ENCONTRADO",
    mensaje: (d) =>
      `No encontré ningún movimiento tuyo de los últimos siete días que diga "${d}". ` +
      "Si es más viejo, corregilo desde Personal, en la lista de movimientos.",
  },
  /*
   * Los de declarar un saldo.
   *
   * El de la cuenta ambigua es el único error del sistema que existe porque
   * una acción se NIEGA a desempatar sola: un saldo escrito en la cuenta
   * equivocada deja mal el patrimonio, el disponible y la cobertura a la vez,
   * y los dos números quedan plausibles. Por eso el mensaje trae los nombres
   * que coincidieron: la persona contesta con uno y listo.
   */
  {
    codigo: "EOS_ACCION_SALDO_SIN_CUENTA",
    mensaje: () =>
      "Decime en qué cuenta. Por ejemplo: \"tengo 3 millones en Ueno\" o " +
      "\"en efectivo me quedan 500 mil\".",
  },
  {
    codigo: "EOS_ACCION_SALDO_SIN_MONTO",
    mensaje: (d) => `Me falta cuánto tenés en "${d}".`,
  },
  {
    codigo: "EOS_ACCION_SALDO_NEGATIVO",
    mensaje: () =>
      "Un saldo no puede ser negativo. Si estás en descubierto o le debés a " +
      "esa cuenta, eso es una deuda: decime a quién y cuánto.",
  },
  {
    codigo: "EOS_ACCION_CUENTA_AMBIGUA",
    mensaje: (d) => `Tenés más de una cuenta que se parece: ${d}. ¿En cuál lo anoto?`,
  },
  /*
   * Los de cobrar una venta y pagar una compra.
   *
   * Los dos que valen: "varios pendientes" y "excede".
   *
   * El primero es la negativa a elegir. "Me pagó la factura" de alguien que
   * tiene tres es una frase incompleta, y completarla por él deja escrito un
   * ingreso que sí ocurrió contra el documento que no era — y una factura
   * marcada como cobrada es una factura que la persona deja de reclamar. Por
   * eso el mensaje trae las tres con su fecha y su importe.
   *
   * El segundo evita el saldo a favor. Un monto mayor a lo que se debe es
   * casi siempre un cero de más al escribir, y el saldo negativo resultante
   * no se parece a un error: se parece a un anticipo, y nadie lo revisa.
   */
  {
    codigo: "EOS_ACCION_COBRO_SIN_CONTACTO",
    mensaje: () => "Decime de quién es el cobro: el nombre del cliente o del proveedor.",
  },
  {
    codigo: "EOS_ACCION_COBRO_SIN_PENDIENTES",
    mensaje: (d) =>
      `"${d}" no tiene nada pendiente conmigo. Si la venta no está cargada, ` +
      "contámela y después la cobramos.",
  },
  {
    codigo: "EOS_ACCION_COBRO_MONTO_INVALIDO",
    mensaje: () => "Ese monto no me cierra: tiene que ser mayor que cero.",
  },
  {
    codigo: "EOS_ACCION_COBRO_VARIAS_MONEDAS",
    mensaje: (d) => `Te debe en ${d}. Decime en cuál de las dos te pagó.`,
  },
  {
    codigo: "EOS_ACCION_COBRO_VARIOS_PENDIENTES",
    mensaje: (d) => {
      const { moneda, resto } = conMoneda(d);
      const docs = resto
        .split(";")
        .filter(Boolean)
        .map((par) => {
          const [fecha, saldo] = par.split(":");
          return `${diaYMes(fecha)} por ${formatearMonto(Number(saldo), moneda)}`;
        });

      return (
        `Tiene ${docs.length} facturas abiertas: ${docs.join(", ")}. ` +
        "¿Cuál te pagó, o cuánto te dio?"
      );
    },
  },
  {
    codigo: "EOS_ACCION_COBRO_EXCEDE",
    mensaje: (d) => {
      const { moneda, resto } = conMoneda(d);
      return (
        `Eso es más de lo que te debe: son ${formatearMonto(Number(resto), moneda)} en total. ` +
        "Decime el monto correcto."
      );
    },
  },
  {
    codigo: "EOS_ACCION_DEUDA_SIN_SALDO",
    mensaje: (d) =>
      `Me falta cuánto le debés a "${d}". Sin el saldo no puedo ordenar tus pagos ni decirte en cuánto salís.`,
  },
  {
    codigo: "EOS_ACCION_DEUDA_NO_ENCONTRADA",
    mensaje: (d) =>
      `No tengo ninguna deuda con "${d}". Contame cuánto le debés y la anoto: "debo 8 millones a ${d}".`,
  },
  {
    codigo: "EOS_ACCION_PAGO_SIN_MONTO",
    mensaje: (d) =>
      `No sé de cuánto fue el pago a "${d}" y esa deuda no tiene cuota declarada. Decime el monto: descontar un número inventado del saldo sería peor que no anotarlo.`,
  },
  {
    codigo: "EOS_ACCION_SIN_MODULO_ERP",
    mensaje: () =>
      "Tu cuenta no tiene activo el módulo ERP, que es el que registra ventas y stock. " +
      "Lo podés agregar desde Planes.",
  },
  {
    codigo: "EOS_ACCION_SIN_MODULO_CRM",
    mensaje: () =>
      "Tu cuenta no tiene activo el módulo CRM, que es el que guarda tus contactos. " +
      "Lo podés agregar desde Planes.",
  },
];

/**
 * El texto que la excepción de Postgres pone después de `CÓDIGO: `.
 *
 * `raise exception 'EOS_ACCION_PRODUCTO_NO_RESUELTO: %', v_texto` llega como
 * un mensaje con el código, dos puntos y el nombre que no se pudo resolver.
 * Ese nombre es lo único accionable que trae el error.
 */
export function detalleDelError(mensaje: string, codigo: string): string {
  const i = mensaje.indexOf(codigo);
  if (i < 0) return "";

  return mensaje
    .slice(i + codigo.length)
    .replace(/^\s*:\s*/, "")
    .trim();
}

/**
 * ¿Este error del ejecutor es una regla de negocio?
 *
 * Devuelve `null` cuando no lo es, y ahí sí corresponde el 500 de siempre: un
 * error que no está en esta lista es uno que nadie previó, y disfrazarlo de
 * mensaje amable escondería una falla real.
 */
export function errorDeAccion(mensaje: string): ErrorDeAccion | null {
  for (const regla of REGLAS) {
    if (!mensaje.includes(regla.codigo)) continue;

    const detalle = detalleDelError(mensaje, regla.codigo);

    return {
      codigo: regla.codigo,
      // Sin detalle el mensaje quedaría con comillas vacías; ahí se cae a una
      // frase genérica del mismo tipo, que sigue siendo mejor que un 500.
      mensaje: detalle
        ? regla.mensaje(detalle)
        : regla.mensaje("eso").replace(/"eso"/g, "lo que me pediste"),
      estado: 422,
    };
  }

  return null;
}

/** Los códigos que este módulo reconoce. Para las pruebas y para el que agregue uno. */
export const CODIGOS_DE_NEGOCIO = REGLAS.map((r) => r.codigo);

/**
 * Lo que rompe una regla de la BASE, no una del negocio.
 *
 * ============================================================
 * LA OTRA MITAD DEL PROBLEMA
 * ============================================================
 *
 * Las reglas de arriba son situaciones normales: no encontré el producto, el
 * módulo no está activo. Salen con 422 y con una instrucción.
 *
 * Esto es lo otro: una clave foránea que no existe, un `check` que no se
 * cumple, un único duplicado. Hasta el 8 de septiembre de 2026 los tres caían
 * al 500 genérico —"No fue posible ejecutar el efecto interno."— sin código y
 * sin motivo, indistinguibles desde afuera de que el servidor se hubiera
 * caído.
 *
 * Se encontró probando `CREAR_OBJETIVO` de punta a punta: la orden fallaba por
 * un `conversacion_id` que no existía, y averiguarlo llevó veinte minutos con
 * acceso al log de n8n y a la base. Para alguien usando el chat habría sido
 * imposible.
 *
 * ============================================================
 * LO QUE SE LE DICE, Y LO QUE NO
 * ============================================================
 *
 * NO se le muestra el detalle de la base. Puede traer datos de otra fila y no
 * le dice nada a nadie.
 *
 * Se le dice la única distinción que sí le sirve: **esto no es culpa de lo que
 * escribiste**. Con eso, en vez de reformular la frase diez veces buscando la
 * palabra mágica, sabe que hay que avisar. El detalle queda en el log, que es
 * donde se puede leer entero.
 */
export function errorDeLaBase(sqlstate: string): ErrorDeAccion | null {
  /*
   * Las clases de Postgres que importan:
   *
   *   22 — dato mal formado (un texto donde va un número, una fecha inválida)
   *   23 — violación de integridad (foránea, check, único, not null)
   *   42 — consulta o permiso mal formados
   *
   * Ninguna es un error de la persona ni algo que pueda reintentar escribiendo
   * distinto. Las demás clases —conexión, recursos, deadlock— sí pueden ser
   * transitorias, y por eso quedan afuera: convertirlas en "problema del
   * sistema" haría que un reintento que iba a funcionar se lea como un fallo.
   */
  if (!/^(22|23|42)/.test(sqlstate)) return null;

  return {
    codigo: `EOS_INTERNAL_EFFECT_DB_${sqlstate}`,
    mensaje:
      "No pude registrarlo por un problema del sistema, no por lo que escribiste. Ya quedó anotado para revisar.",
    estado: 500,
  };
}
