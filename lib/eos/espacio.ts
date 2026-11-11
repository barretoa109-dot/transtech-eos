/**
 * En qué espacio está parada la persona cuando escribe: Personal o su negocio.
 *
 * ============================================================
 * EL CHAT ERA EL ÚNICO QUE NO LO SABÍA
 * ============================================================
 *
 * EOS separa los dos lados desde hace meses: la base por `ambito` (v136 para
 * la plata, v143/v146 para cuentas, tarjetas y deudas, v144 para los
 * objetivos), el menú desde el 05/10/2026 y hasta el historial de chats desde
 * la v256. El chat —la parte que más se usa— era el único que seguía
 * recibiendo las dos cosas juntas en cada mensaje.
 *
 * Se vio así el 11/11/2026, parado en "Mi negocio":
 *
 *   > Dame un resumen de mis objetivos actuales
 *   Tus objetivos actuales son saldar los ₲ 3.000.000 de la American Express
 *   de Itaú… En la granja, querés ampliar la capacidad…
 *
 * La tarjeta es de la persona y la granja es del negocio, y la respuesta las
 * puso en el mismo párrafo porque el contexto se las puso en la misma lista.
 *
 * ============================================================
 * POR QUÉ NO ALCANZABA CON ROTULAR
 * ============================================================
 *
 * El contexto ya rotulaba: "NEGOCIO" y "VOS" en los movimientos (v137),
 * "[negocio]" en cada objetivo (v144). Con eso el modelo PUEDE distinguirlos,
 * pero sigue teniendo las dos cosas adelante, y a una pregunta abierta —"mis
 * objetivos"— contesta con todo lo que ve. Lo único que garantiza que no
 * mezcle es no mandárselo.
 *
 * ============================================================
 * QUÉ CANALES TIENEN ESPACIO
 * ============================================================
 *
 * La web y la app nativa, que es la misma web adentro de un WebView: ahí la
 * persona eligió un espacio y la pantalla entera habla de ese. WhatsApp no
 * tiene espacios, así que no manda ninguno y sigue recibiendo las dos cosas:
 * las conversaciones de WhatsApp quedaron en 'personal' por el default de la
 * v256, que es el lado seguro de una columna nueva y no una clasificación.
 */

export type EspacioDelChat = "personal" | "negocio";

const ESPACIOS: readonly string[] = ["personal", "negocio"];

/**
 * El espacio que vino en el pedido, o `null`.
 *
 * `null` no es un error: es "este canal no tiene espacios". Lo que no se
 * reconoce también cae ahí, porque un valor raro significa que el cliente
 * cambió y todavía no lo sabemos — y en la duda es mejor contestar de más
 * que esconderle a alguien la mitad de sus datos sin avisar.
 */
export function espacioDelPedido(valor: unknown): EspacioDelChat | null {
  if (typeof valor !== "string") return null;

  const limpio = valor.trim().toLowerCase();

  return ESPACIOS.includes(limpio) ? (limpio as EspacioDelChat) : null;
}

/** Cómo se llama el espacio en la pantalla, para poder nombrárselo a la persona. */
export function nombreDelEspacio(espacio: EspacioDelChat): string {
  return espacio === "negocio" ? "Mi negocio" : "Personal";
}

/**
 * Qué memorias se leen desde este espacio, escrito como lo pide PostgREST.
 *
 * Las del espacio Y las que no tienen ninguno. Las sin ámbito son las
 * guardadas antes de la v259: no se pueden repartir sin inventar —toda
 * conversación anterior a la v256 quedó en 'personal' por un default, no por
 * una elección— así que se siguen viendo en los dos lados, como hasta hoy.
 * Lo nuevo nace separado y el arrastre se va apagando solo.
 *
 * Devuelve `null` cuando no hay espacio: ahí la consulta va sin filtro.
 */
export function filtroDeMemorias(espacio: EspacioDelChat | null): string | null {
  // `espacio` ya pasó por `espacioDelPedido`, así que es una de dos palabras
  // nuestras: no hay texto de nadie metiéndose en este filtro.
  return espacio ? `ambito.is.null,ambito.eq.${espacio}` : null;
}

/**
 * La primera línea del contexto: dónde está parada la persona.
 *
 * ============================================================
 * POR QUÉ VA EN EL CONTEXTO Y NO EN EL PROMPT DE SISTEMA
 * ============================================================
 *
 * `contexto_negocio` es un campo que viaja igual por los dos gateways —el de
 * TypeScript y el de n8n— y no hay que dar de alta nada en ninguno para que
 * llegue. El prompt de sistema vive en dos lados (`lib/gateway/sistema.ts` y
 * el parche de n8n) y cambiarlo pide tocar los dos y volver a exportar el
 * workflow. Esto es un dato del turno, no una regla del producto: su lugar es
 * el contexto.
 *
 * ============================================================
 * LO QUE NO ESTÁ ACÁ NO ES LO QUE NO EXISTE
 * ============================================================
 *
 * Sin esta línea, un modelo que ya no recibe las ventas en Personal contesta
 * "no tengo tus ventas", que se lee como que EOS se rompió. Con ella contesta
 * "eso lo ves en Mi negocio", que es la verdad y además enseña el producto.
 */
export function encabezadoDeEspacio(espacio: EspacioDelChat | null): string {
  if (espacio === null) return "";

  const aca = nombreDelEspacio(espacio);
  const alla = nombreDelEspacio(espacio === "negocio" ? "personal" : "negocio");

  if (espacio === "negocio") {
    return [
      `La persona está escribiendo desde el espacio "${aca}".`,
      "Todo lo que sigue es de su negocio. Su plata personal —sus cuentas, sus",
      "tarjetas, sus deudas y sus objetivos propios— no entra acá y no se mezcla",
      "con esto, ni siquiera desde lo que recuerdes de otras conversaciones.",
      `Si te pregunta por algo suyo, decile que lo ve en "${alla}": que no esté`,
      "acá no quiere decir que no exista.",
      "Un objetivo o un gasto fijo que te pida desde acá, sin decir de quién es,",
      "es del negocio.",
    ].join("\n");
  }

  return [
    `La persona está escribiendo desde el espacio "${aca}".`,
    "Todo lo que sigue es su plata. Su negocio —ventas, catálogo, stock,",
    "clientes, lo que le deben y lo que debe— no entra acá y no se mezcla con",
    "esto, ni siquiera desde lo que recuerdes de otras conversaciones.",
    `Si te pregunta por el negocio, decile que lo ve en "${alla}": que no esté`,
    "acá no quiere decir que no exista.",
    "Un objetivo o un gasto fijo que te pida desde acá, sin decir de quién es,",
    "es personal.",
  ].join("\n");
}
