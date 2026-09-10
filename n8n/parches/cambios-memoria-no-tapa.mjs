/**
 * Que GUARDAR_MEMORIA deje de tapar a los verbos que sí existen.
 *
 * ============================================================
 * LA ACCIÓN QUE SIEMPRE FUNCIONA
 * ============================================================
 *
 * GUARDAR_MEMORIA acepta cualquier texto y nunca falla. Eso la vuelve la
 * salida cómoda cuando el modelo no encuentra el verbo que corresponde — y es
 * la peor forma de fallar que tiene este sistema, porque la respuesta suena a
 * que quedó hecho:
 *
 *   7 de septiembre de 2026, 17:06. "Podés ahora agregar en productos: el azul
 *   vendo a 168.000gs…". EOS contestó "Voy a guardar estos productos con sus
 *   precios de venta" y guardó una memoria. Ningún producto entró al catálogo.
 *   Ver la cabecera de la migración v131.
 *
 *   9 de septiembre de 2026. La misma usuaria calculó con EOS los costos y
 *   márgenes de cuatro conjuntos. EOS dijo "guardé esa información en la
 *   memoria empresarial". Cuando vendió uno, la venta no se pudo registrar:
 *   los productos no existían y los costos no estaban en ningún lado que el
 *   panel de rentabilidad pudiera leer.
 *
 * En los dos casos el verbo correcto ya existía o llegó después. Lo que
 * faltaba —y falta hasta este parche— es que el prompt diga que GUARDAR_MEMORIA
 * NO es el lugar de un dato que tiene su propia acción.
 *
 * La regla se escribe en positivo y en negativo, porque las dos hacen falta:
 * para qué SÍ es la memoria, y qué nunca va ahí.
 */

export const CAMBIOS = [
  {
    donde: "para qué es y para qué no es GUARDAR_MEMORIA",
    viejo: [
      "CREAR_OBJETIVO",
      "  datos: { titulo, tipo_medicion?, valor_objetivo?, valor_actual?,",
    ].join("\n"),
    nuevo: [
      "GUARDAR_MEMORIA",
      "  datos: { titulo, categoria?, contenido, importancia? }",
      "  Es para lo que NO tiene otro lugar: cómo trabaja la persona, qué",
      "  prefiere, con quién no quiere trabajar, el acuerdo que tiene con un",
      "  proveedor, el nombre de su contadora.",
      "  NUNCA la uses para un dato que tiene su propio verbo. Un costo o un",
      "  precio van en CREAR_PRODUCTO o ACTUALIZAR_PRODUCTO; una venta en",
      "  REGISTRAR_VENTA; un gasto en REGISTRAR_COMPRA o",
      "  REGISTRAR_MOVIMIENTO_PERSONAL; una deuda en REGISTRAR_DEUDA.",
      "  Guardar un costo como memoria deja el número en una conversación: el",
      "  panel de rentabilidad no lo ve, el margen sigue sin calcularse, y la",
      "  persona se queda creyendo que lo cargó. Es peor que no hacer nada,",
      "  porque no se nota.",
      "  Ante la duda entre la memoria y un verbo del negocio, es el verbo.",
      "",
      "CREAR_OBJETIVO",
      "  datos: { titulo, tipo_medicion?, valor_objetivo?, valor_actual?,",
    ].join("\n"),
  },
];

export function aplicar(texto, etiqueta) {
  let salida = texto;

  for (const c of CAMBIOS) {
    if (c.nuevo.includes("`")) throw new Error(`[${etiqueta}] comilla invertida en "${c.donde}"`);

    const partes = salida.split(c.viejo);
    if (partes.length !== 2) {
      throw new Error(`[${etiqueta}] "${c.donde}": aparece ${partes.length - 1} veces, no 1.`);
    }
    salida = partes.join(c.nuevo);
  }

  return salida;
}
