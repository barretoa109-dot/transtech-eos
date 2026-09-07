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

export type ErrorDeAccion = {
  codigo: string;
  /** Lo que ve el usuario. Tiene que decir qué hacer, no solo qué pasó. */
  mensaje: string;
  /** 422: la petición está bien y la regla dice que no. */
  estado: 422;
};

type Regla = { codigo: string; mensaje: (detalle: string) => string };

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
