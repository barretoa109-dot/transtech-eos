/**
 * Los cambios del prompt para separar la plata del negocio de la personal.
 *
 * Se definen UNA vez acá y se aplican a los dos lugares donde vive el prompt:
 * `lib/gateway/sistema.ts` y el nodo `HTTP Request` del gateway en n8n. Que
 * sean el mismo texto lo verifica `lib/gateway/sistema.test.ts`.
 *
 * NADA de comillas invertidas en el texto del prompt: en n8n vive dentro de un
 * literal de plantilla y una comilla lo corta. Ver la prueba que lo prohíbe.
 */

export const CAMBIOS = [
  {
    donde: "la lista de acciones",
    viejo: ["REGISTRAR_COMPRA", "REGISTRAR_GASTO_FIJO", "", "Acciones del negocio (ERP y CRM):"].join("\n"),
    nuevo: [
      "REGISTRAR_COMPRA",
      "REGISTRAR_GASTO_FIJO",
      "REGISTRAR_MOVIMIENTO_PERSONAL",
      "",
      "Acciones del negocio (ERP y CRM):",
    ].join("\n"),
  },
  {
    donde: "la forma de datos y la regla de ámbito",
    viejo: [
      "  Si algo se repite Y además ya se pagó una vez, son las dos acciones:",
      "  la compra por lo pagado y el fijo por lo que viene.",
      "",
      "Reglas de estas siete, que no se negocian:",
    ].join("\n"),
    nuevo: [
      "  Si algo se repite Y además ya se pagó una vez, son las dos acciones:",
      "  la compra por lo pagado y el fijo por lo que viene.",
      "  Lleva ambito: negocio o personal. Ver la sección de abajo.",
      "",
      "REGISTRAR_MOVIMIENTO_PERSONAL",
      "  datos: { movimientos: [{ tipo, monto, descripcion, fecha? }] }",
      "  Es la plata de LA PERSONA, no la del negocio: su sueldo, el alquiler",
      "  de su casa, la comida, la nafta de su auto, la cuota del colegio, un",
      "  regalo, la tarjeta.",
      "  tipo es gasto o ingreso, y no se adivina de la descripcion: cobré e",
      "  invertí se parecen lo suficiente como para equivocar el signo, y un",
      "  gasto contado como ingreso mueve el disponible al doble para el lado",
      "  que no es.",
      "  No pongas categoria: EOS la deduce sola al mostrar el desglose. Pedirle",
      "  al usuario que categorice es justo el trabajo que este producto le",
      "  saca.",
      "",
      "NEGOCIO O PERSONAL: LA PREGUNTA QUE VA ANTES DE CADA ACCION DE PLATA",
      "",
      "EOS tiene dos lugares SEPARADOS y no se mezclan nunca:",
      "",
      "  - Negocios (ERP y CRM): lo que el usuario compra para vender, sus",
      "    ventas, su stock, sus clientes y proveedores, el alquiler del local,",
      "    el sueldo de su gente.",
      "  - Personal: la plata de la persona. Lo que cobra, su alquiler, la",
      "    comida, el combustible de su auto, la salud, el colegio, su tarjeta.",
      "",
      "REGISTRAR_VENTA, REGISTRAR_COMPRA, AJUSTAR_STOCK, CREAR_PRODUCTO,",
      "ACTUALIZAR_PRODUCTO y CREAR_CONTACTO son SIEMPRE del negocio.",
      "REGISTRAR_MOVIMIENTO_PERSONAL es SIEMPRE de la persona.",
      "REGISTRAR_GASTO_FIJO es de los dos y por eso lleva ambito.",
      "",
      "Cómo se decide, en este orden:",
      "",
      "1. Si el usuario lo dice, mandá eso y no lo discutas: para el negocio,",
      "   de la empresa, mío, de casa, personal.",
      "2. Si el contexto lo deja claro, alcanza. Un negocio de porcicultura que",
      "   compra balanceado no está comprando su almuerzo; un sueldo que la",
      "   persona COBRA es personal aunque tenga un negocio.",
      "3. Si de verdad no se puede saber y el monto es importante, PREGUNTÁ",
      "   antes de mandar la acción: eso es del negocio o tuyo. Una sola",
      "   pregunta, corta, sin acciones en ese mensaje.",
      "4. Con un monto chico y duda genuina, personal. Un gasto personal mal",
      "   puesto se arregla borrando una línea; una compra del negocio mal",
      "   puesta le cambia el margen de todo el mes y nadie lo relaciona.",
      "",
      "Reglas de estas ocho, que no se negocian:",
    ].join("\n"),
  },
];

export function aplicar(texto, etiqueta) {
  let salida = texto;

  for (const c of CAMBIOS) {
    /*
     * Se revisa lo que se ESCRIBE, no el resultado.
     *
     * En n8n esta función recibe el cuerpo entero de la petición, que es un
     * literal de plantilla y por lo tanto tiene comillas invertidas legítimas
     * —las que lo abren y lo cierran—. Revisar el resultado daba un falso
     * positivo ahí y dejaba pasar el caso real, que es la comilla que alguien
     * agrega DENTRO del texto nuevo. Eso tiró el chat el 7 de septiembre.
     */
    if (c.nuevo.includes("`")) {
      throw new Error(
        `[${etiqueta}] "${c.donde}" trae una comilla invertida, y en n8n eso corta el prompt. No se escribió nada.`,
      );
    }

    const partes = salida.split(c.viejo);
    if (partes.length !== 2) {
      throw new Error(
        `[${etiqueta}] "${c.donde}": el texto aparece ${partes.length - 1} veces, no 1. No se escribió nada.`,
      );
    }
    salida = partes.join(c.nuevo);
  }

  return salida;
}
