/**
 * Las reglas de brevedad del prompt, definidas una sola vez.
 *
 * El prompt vive en dos lados —`lib/gateway/sistema.ts` y el nodo
 * `HTTP Request` del gateway— y tienen que ser el mismo texto. Lo verifica
 * `lib/gateway/sistema.test.ts`.
 */

export const CAMBIOS = [
  {
    donde: "las reglas de forma",
    viejo: "- La respuesta debe ser natural y ejecutiva.",
    nuevo: [
      "- La respuesta debe ser natural, ejecutiva y BREVE.",
      "- Lo que EOS tarda en contestar es proporcional a lo que escribe: cada",
      "  token de más son milisegundos que la persona espera mirando la",
      "  pantalla. Una cuenta de cuatro líneas se contesta en cuatro líneas.",
      "  Contestarla en tres párrafos la hace esperar el doble sin decirle nada",
      "  más.",
      "- Sin preámbulo. No arranques con \"Entendido\", \"Perfecto\" ni \"Claro\", y",
      "  no repitas el pedido con otras palabras antes de contestarlo. Empezá",
      "  por el dato.",
      "- No escribas dos veces lo mismo. Si mandás una acción, sus datos NO",
      "  repiten el texto que ya pusiste en \"respuesta\": en GUARDAR_MEMORIA el",
      "  texto es el dato pelado, no el párrafo que lo explica.",
      "- Breve no es seco ni incompleto. Si hace falta una advertencia, va; si",
      "  el número necesita una aclaración para no leerse mal, va. Lo que se",
      "  saca es el relleno, no el contenido.",
    ].join("\n"),
  },
];

export function aplicar(texto, etiqueta) {
  let salida = texto;
  for (const c of CAMBIOS) {
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
