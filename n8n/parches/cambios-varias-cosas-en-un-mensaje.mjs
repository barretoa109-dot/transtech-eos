/**
 * Los cambios del prompt del 27/09/2026: cuando llega más de una cosa, EOS no
 * las mezcla, no inventa montos y no vuelve a anotar lo que ya está.
 *
 * ============================================================
 * LO QUE PASÓ (27 de septiembre de 2026, usando EOS de verdad)
 * ============================================================
 *
 * Dos capturas: un pago en Areté y, apiladas en otra, las notificaciones del
 * banco de un cobro de OpenAI por los tokens de la API (USD 5,95 = ₲ 35.105,
 * en la tarjeta de Banco Basa). "Anotalo en Personal". Lo que hizo EOS:
 *
 * 1. Sin ver la imagen (el Regenerar la perdía), usó ₲ 119.780: el monto de
 *    "OpenAI plan pro" del 25/09. Un movimiento viejo parecido, no el cobro.
 * 2. Pidió los datos de la tarjeta porque no estaba cargada; se cargó, y la
 *    compra no se retomó nunca.
 * 3. "No anotaste el débito de los Tokens", con una captura de la pantalla de
 *    movimientos DE EOS: leyó una línea ya anotada ("OpenAI Claude Pro son
 *    mensuales", ₲ 120.000) como un comprobante nuevo, juntó OpenAI con Claude
 *    y lo registró como compra del NEGOCIO, aunque le habían dicho Personal.
 *
 * La persona tiene ChatGPT Pro y Claude Pro como fijos mensuales; el uso de
 * la API es otra cosa. EOS no los distinguía.
 *
 * Sin comillas invertidas en el texto: en n8n el prompt vive dentro de un
 * literal de plantilla y una comilla lo corta. `aplicar` lo verifica.
 */

export const CAMBIOS = [
  {
    donde: "compra con tarjeta: tarjeta que no está cargada",
    viejo: "  Si no dicen con cuál tarjeta y tiene una sola, se usa esa.\n",
    nuevo: [
      "  Si no dicen con cuál tarjeta y tiene una sola, se usa esa.",
      "  Si NOMBRAN una tarjeta que no está cargada, mandá la acción IGUAL con",
      "  ese nombre: el sistema la crea y después pide el cierre y el",
      "  vencimiento. No pidas los datos de la tarjeta antes de anotar la",
      "  compra: la compra se pierde.",
      "",
    ].join("\n"),
  },
  {
    donde: "negocio o personal: lo dicho antes sigue valiendo",
    viejo: [
      "   puesta le cambia el margen de todo el mes y nadie lo relaciona.",
      "",
    ].join("\n"),
    nuevo: [
      "   puesta le cambia el margen de todo el mes y nadie lo relaciona.",
      "5. Lo que el usuario dijo antes EN ESTA CONVERSACIÓN sobre ese mismo",
      "   gasto sigue valiendo. Si dijo \"anotalo en Personal\" y después",
      "   insiste (\"no lo anotaste\"), va a Personal aunque sea para su",
      "   empresa: la persona decide de qué bolsillo sale. Algo que usa su",
      "   empresa pagado con su tarjeta personal es un gasto personal.",
      "",
    ].join("\n"),
  },
  {
    donde: "imágenes: capturas de EOS, varias operaciones, montos",
    viejo: [
      "- Nunca le digas a la persona que se equivoca con lo que vos no ves",
    ].join("\n"),
    nuevo: [
      "- UNA CAPTURA DE LA PANTALLA DE EOS NO ES UN COMPROBANTE. Si la imagen",
      "  muestra la app de EOS (sus movimientos, compras, fijos, tarjetas o",
      "  este chat), lo que figura ahí YA ESTÁ ANOTADO: no lo registres de",
      "  nuevo. Te la mandan para mostrarte algo que está mal o que falta:",
      "  leé qué señalan y corregí o completá eso.",
      "- Un comprobante, un aviso del banco o un correo SÍ son operaciones",
      "  nuevas. Si una imagen trae VARIAS (notificaciones apiladas), cada una",
      "  es una cosa distinta con SU monto: anotá las que te piden, cada una",
      "  por separado, y nunca juntes dos en una.",
      "- Si la misma operación aparece en dólares y en guaraníes (el cobro",
      "  del proveedor y el aviso del banco), el monto es el del banco en",
      "  guaraníes: es lo que salió de la cuenta.",
      "- EL MONTO DE UNA OPERACIÓN SALE DE ESA OPERACIÓN: de una imagen que",
      "  la muestra o de lo que la persona dijo sobre ELLA. Nunca de otra",
      "  operación de la conversación (otro comercio, otro día), ni de un",
      "  movimiento parecido ya anotado, ni del monto de un fijo. Si no lo",
      "  tenés así, NO mandes la acción: preguntá solo el monto. El cobro de",
      "  este mes no cuesta lo mismo que el del mes pasado.",
      "- La tarjeta es la que nombró la persona, tal cual. No la mezcles con",
      "  otra tarjeta cargada ni le agregues el emisor de otra.",
      "- Una suscripción que ya está entre los fijos (ChatGPT Pro, Claude",
      "  Pro, Netflix) y un consumo aparte del mismo proveedor (el uso de la",
      "  API, los tokens) son cosas DISTINTAS: no las confundas ni las",
      "  juntes en una.",
      "- Si la persona dice \"no lo anotaste\" o \"sigue sin anotar\", buscá más",
      "  arriba en la conversación qué quedó sin hacer o falló, y mandá esa",
      "  acción de nuevo con los datos que ya te dio. No preguntes lo que ya",
      "  te dijeron. Si junto con eso te mandan una captura de EOS, lo que",
      "  se ve en la captura es lo que YA está anotado, no lo que falta: su",
      "  monto no es el de lo que falta.",
      "- Nunca le digas a la persona que se equivoca con lo que vos no ves",
    ].join("\n"),
  },
];

export function aplicar(texto, etiqueta) {
  let salida = texto;

  for (const c of CAMBIOS) {
    if (c.nuevo.includes("`")) {
      throw new Error(
        `[${etiqueta}] "${c.donde}" trae una comilla invertida, y en n8n eso corta el prompt.`,
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
