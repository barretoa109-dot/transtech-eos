/**
 * Hablarle a EOS en vez de escribirle.
 *
 * ============================================================
 * POR QUÉ EL RECONOCIMIENTO DEL NAVEGADOR Y NO UNA API DE AUDIO
 * ============================================================
 *
 * La alternativa era grabar el audio, subirlo y transcribirlo del lado del
 * servidor. Suena más "de verdad" y es peor en las tres cosas que importan acá:
 *
 *   - El usuario espera. Grabar 8 segundos, subir 200 KB por una conexión
 *     paraguaya y esperar la transcripción son varios segundos MÁS antes de
 *     que EOS empiece siquiera a leer el mensaje. Con el reconocimiento del
 *     navegador el texto aparece mientras la persona habla.
 *   - Cuesta plata por minuto hablado, arriba de lo que ya cuesta la
 *     respuesta.
 *   - La voz sale del dispositivo. Una grabación de alguien diciendo cuánto
 *     facturó su negocio es un dato más sensible que el texto, y acá no hace
 *     falta que viaje.
 *
 * El precio es que no todos los navegadores lo tienen. Eso se dice en pantalla
 * en vez de ofrecer un botón que no hace nada: ver `soportaDictado`.
 *
 * ============================================================
 * EL DICTADO SE SUMA A LO ESCRITO, NUNCA LO PISA
 * ============================================================
 *
 * Si alguien escribió media frase y después aprieta el micrófono, lo dictado va
 * al final de lo que ya estaba. Reemplazar el campo sería perder texto que la
 * persona tipeó, y es el tipo de pérdida que no se puede deshacer con Ctrl+Z
 * porque el cambio no lo hizo el teclado.
 */

/** Lo mínimo que este módulo necesita del objeto global. No importa `dom`. */
type VentanaConVoz = {
  SpeechRecognition?: unknown;
  webkitSpeechRecognition?: unknown;
};

/**
 * ¿Este navegador puede dictar?
 *
 * Chrome, Edge y Safari sí (con prefijo `webkit` en los dos últimos). Firefox
 * no, y no está en camino. Se pregunta por el constructor y no por el nombre
 * del navegador: la lista de user agents envejece, la capacidad no.
 */
export function soportaDictado(ventana: VentanaConVoz | undefined | null): boolean {
  if (!ventana) return false;
  return typeof ventana.SpeechRecognition === "function" || typeof ventana.webkitSpeechRecognition === "function";
}

/**
 * El idioma que se le pide al reconocedor.
 *
 * `es-PY` primero porque el vocabulario de acá —guaraní mezclado, "Gs.",
 * nombres de ciudades— se reconoce mejor con el modelo regional. Los
 * navegadores que no tengan ese código caen solos a un español genérico, así
 * que pedirlo no cuesta nada y cuando está, se nota.
 */
export const IDIOMA_DICTADO = "es-PY";

/**
 * Junta lo que ya estaba escrito con lo que se acaba de dictar.
 *
 * Las reglas son las de cualquiera que dicta: un espacio en el medio, ninguno
 * al principio, y si lo anterior terminó en salto de línea se respeta el salto
 * en vez de convertirlo en espacio —alguien que apretó Shift+Enter quiso ese
 * renglón—.
 */
export function fusionarDictado(previo: string, dictado: string): string {
  const limpio = dictado.trim();
  if (!limpio) return previo;

  if (!previo) return limpio;

  // Termina en salto o en espacio: se pega tal cual, sin agregar otro.
  if (/\s$/.test(previo)) return previo + limpio;

  return `${previo} ${limpio}`;
}

/**
 * El texto de un resultado del reconocedor, quedándose solo con lo definitivo.
 *
 * El navegador emite el mismo pedazo de frase varias veces mientras corrige:
 * primero como `isFinal: false` (una hipótesis que va a cambiar) y al final una
 * vez como `isFinal: true`. Si se acumulan los dos, el mensaje termina con la
 * frase repetida tres o cuatro veces.
 *
 * Se devuelven las dos por separado: lo definitivo, que se guarda, y lo
 * provisorio, que solo se muestra en gris para que la persona vea que la
 * escucharon.
 */
export type LecturaDeVoz = { definitivo: string; provisorio: string };

type ResultadoCrudo = {
  isFinal?: boolean;
  0?: { transcript?: string };
  length?: number;
};

export function leerResultados(
  resultados: ArrayLike<ResultadoCrudo> | null | undefined,
  desde = 0,
): LecturaDeVoz {
  const salida: LecturaDeVoz = { definitivo: "", provisorio: "" };
  if (!resultados) return salida;

  for (let i = desde; i < resultados.length; i += 1) {
    const resultado = resultados[i];
    const texto = resultado?.[0]?.transcript ?? "";
    if (!texto) continue;

    if (resultado.isFinal) {
      salida.definitivo = fusionarDictado(salida.definitivo, texto);
    } else {
      salida.provisorio = fusionarDictado(salida.provisorio, texto);
    }
  }

  return salida;
}

/**
 * Qué decirle a la persona cuando el dictado falla.
 *
 * El evento del navegador trae un código seco (`not-allowed`, `no-speech`), y
 * mostrarlo sería mostrarle un error de programador a alguien que solo quería
 * hablar. Cada uno tiene una salida distinta y por eso se distinguen: al que le
 * falta permiso hay que decirle dónde darlo, y al que no se le escuchó nada
 * simplemente que hable más cerca.
 */
export function mensajeDeErrorDeVoz(codigo: string | undefined | null): string {
  switch (codigo) {
    case "not-allowed":
    case "service-not-allowed":
      return "No nos diste permiso para usar el micrófono. Habilitalo en el candado de la barra de direcciones.";
    case "no-speech":
      return "No te escuchamos. Probá de nuevo, más cerca del micrófono.";
    case "audio-capture":
      return "No encontramos un micrófono conectado.";
    case "network":
      return "El dictado necesita conexión y no la hay. Escribilo y listo.";
    case "aborted":
      // Lo cortó la propia persona apretando el botón: no es un error que
      // haya que contarle.
      return "";
    default:
      return "No pudimos usar el micrófono. Escribilo y seguimos igual.";
  }
}
