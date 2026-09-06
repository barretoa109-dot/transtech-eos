/**
 * Cuántos archivos entran en un mensaje, y de qué tamaño.
 *
 * ============================================================
 * DE UNO A DIEZ, Y POR QUÉ NO ALCANZABA CON SUBIR EL NÚMERO
 * ============================================================
 *
 * El compositor mandaba un archivo por mensaje. Quien saca cinco fotos de sus
 * facturas del día tenía que mandarlas de a una —y gastar cinco mensajes de su
 * plan— para que EOS las leyera.
 *
 * Subir el tope a diez sin tocar nada más rompía en el primer intento. Una foto
 * de un teléfono actual pesa entre 3 y 5 MB; diez son 40 MB, y en base64 son
 * 54. Ningún servidor de funciones acepta un cuerpo así, y en una conexión
 * paraguaya la subida sola tardaría más que toda la respuesta.
 *
 * Por eso las imágenes se achican ANTES de salir del navegador. El modelo no
 * lee más de ~1568 píxeles del lado largo: mandarle 4000 es pagar la subida de
 * tres veces más píxeles de los que va a mirar. Achicada a ese tope y guardada
 * como JPEG, la misma foto pesa entre 200 y 400 KB. Diez entran en unos 3 MB,
 * que sí viaja.
 *
 * El beneficio se nota también con una sola foto, que es el caso de siempre:
 * la subida pasa de segundos a instantánea.
 *
 * Este archivo tiene las REGLAS —cuántos, de qué tamaño, a qué medida
 * achicar—. El redimensionado en sí necesita un canvas y vive en el cliente
 * (`app/eos/services/uploads.ts`); acá está lo que se puede probar sin
 * navegador, que es donde estaban los errores que importan.
 */

/**
 * Diez, que es lo que se pidió.
 *
 * No es un número redondo por casualidad: es el tope a partir del cual una
 * persona deja de mandar fotos de a una y manda "las del día". Más que eso
 * empieza a ser una carga masiva, y para eso está la importación del ERP.
 */
export const MAX_ADJUNTOS = 10;

/** Por archivo, antes de achicar. Lo que ya regía cuando era uno solo. */
export const MAX_BYTES_POR_ARCHIVO = 15 * 1024 * 1024;

/**
 * El total del mensaje, ya en base64 y con las imágenes achicadas.
 *
 * Es el número que de verdad tiene que entrar en el cuerpo del pedido. Se mide
 * sobre el base64 y no sobre los bytes originales porque es lo que viaja:
 * base64 agrega un tercio.
 */
export const MAX_BASE64_TOTAL = 18 * 1024 * 1024;

/**
 * El lado más largo al que se achica una imagen.
 *
 * 1568 px es el detalle máximo que los modelos de visión aprovechan; arriba de
 * eso la imagen se reescala del otro lado igual. Mandar más es pagar subida
 * por píxeles que nadie mira.
 */
export const LADO_MAXIMO_IMAGEN = 1568;

export type Adjunto = {
  nombre: string;
  tipo: string;
  tamanio?: number;
  base64: string;
};

/**
 * A qué medida achicar, conservando la proporción.
 *
 * Devuelve `null` cuando la imagen ya entra: reprocesar una foto chica la
 * recomprime sin ganar nada y le agrega artefactos.
 */
export function medidaParaModelo(
  ancho: number,
  alto: number,
  tope = LADO_MAXIMO_IMAGEN,
): { ancho: number; alto: number } | null {
  if (!Number.isFinite(ancho) || !Number.isFinite(alto) || ancho <= 0 || alto <= 0) return null;
  if (ancho <= tope && alto <= tope) return null;

  const factor = tope / Math.max(ancho, alto);

  // `round` y no `floor`: con `floor`, una imagen de 1569 de lado quedaría en
  // 1567 y la proporción se corre un píxel en cada paso.
  return {
    ancho: Math.max(1, Math.round(ancho * factor)),
    alto: Math.max(1, Math.round(alto * factor)),
  };
}

export type Rechazo = { motivo: string };

/**
 * ¿Entra este conjunto de adjuntos en un mensaje?
 *
 * Devuelve `null` cuando sí. Cuando no, un motivo escrito para que lo lea la
 * persona que acaba de elegir las fotos, no para un log: dice cuántas eligió y
 * cuántas entran, porque "demasiados archivos" obliga a adivinar.
 */
export function revisarAdjuntos(adjuntos: Adjunto[]): Rechazo | null {
  if (adjuntos.length === 0) return null;

  if (adjuntos.length > MAX_ADJUNTOS) {
    return {
      motivo: `Podés mandar hasta ${MAX_ADJUNTOS} archivos por mensaje y elegiste ${adjuntos.length}. Sacá ${
        adjuntos.length - MAX_ADJUNTOS
      } y mandá el resto en otro mensaje.`,
    };
  }

  for (const adjunto of adjuntos) {
    if (!adjunto.nombre || !adjunto.tipo || !adjunto.base64) {
      return { motivo: "Uno de los archivos llegó incompleto. Probá adjuntarlo de nuevo." };
    }

    if (typeof adjunto.tamanio === "number" && adjunto.tamanio > MAX_BYTES_POR_ARCHIVO) {
      return {
        motivo: `"${adjunto.nombre}" pesa más de 15 MB, que es el máximo por archivo.`,
      };
    }
  }

  const total = adjuntos.reduce((suma, a) => suma + a.base64.length, 0);

  if (total > MAX_BASE64_TOTAL) {
    return {
      motivo:
        "Todo junto pesa demasiado para un solo mensaje. Mandá menos archivos por vez, o menos pesados.",
    };
  }

  return null;
}

/**
 * Qué escribir en el campo cuando alguien adjunta sin escribir nada.
 *
 * Con un archivo se lo nombra —"Analizá esta imagen: factura.jpg"— porque el
 * nombre le dice a la persona cuál mandó. Con varios, nombrarlos a todos deja
 * un mensaje de cuatro renglones que nadie quiso escribir, así que se cuentan.
 */
export function textoPorDefecto(adjuntos: Adjunto[]): string {
  if (adjuntos.length === 0) return "";

  if (adjuntos.length === 1) {
    const uno = adjuntos[0];
    const que = uno.tipo.startsWith("image/") ? "esta imagen" : "este archivo";
    return `Analizá ${que}: ${uno.nombre}`;
  }

  // "estas imágenes" y "estos archivos": el género lo decide el sustantivo, y
  // una frase mal concordada en el campo de texto de alguien la escribió el
  // producto, no la persona.
  const todasImagenes = adjuntos.every((a) => a.tipo.startsWith("image/"));

  return todasImagenes
    ? `Analizá estas ${adjuntos.length} imágenes`
    : `Analizá estos ${adjuntos.length} archivos`;
}
