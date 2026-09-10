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

/**
 * ============================================================
 * LA MÁQUINA DE ESTADOS, Y POR QUÉ HACÍA FALTA UNA
 * ============================================================
 *
 * Lo que se reportó desde un teléfono, el 9 de septiembre de 2026: la persona
 * aprieta el micrófono, el navegador NO tiene permiso, aparece el aviso de que
 * falta el permiso… y el botón se queda rojo, latiendo, con "Escuchando…"
 * abajo. No sale más de ahí: apretar de nuevo no hace nada, el chat parece
 * estar grabando, y la única salida es recargar la página.
 *
 * La causa es que el estado vivía repartido en tres callbacks del reconocedor
 * y **solo uno de ellos lo apagaba**:
 *
 *   · `onerror` mostraba el mensaje y NO tocaba `escuchando`.
 *   · `onend` sí apagaba… pero `onend` no siempre llega. Con el permiso
 *     denegado, Safari en iOS y varios Android emiten `onerror` y nunca
 *     `onend`. Ahí `escuchando` se quedaba en `true` para siempre.
 *   · y `alternar` sobre un reconocedor ya muerto llamaba a `stop()`, que no
 *     hace nada y no dispara ningún evento: el segundo toque tampoco salía.
 *
 * La regla que arregla la clase entera de problema, y no solo este caso:
 *
 *   **TODO evento que no sea "se abrió el micrófono" termina en inactivo y
 *   suelta lo que haya tomado.** No hay ningún camino que deje la interfaz
 *   escuchando sin un micrófono abierto de verdad.
 *
 * Está acá y no en el hook para poder probarla sin navegador: son las tres
 * pruebas de regresión del micrófono, y ninguna necesita un teléfono.
 */
export type EstadoDictado = "inactivo" | "pidiendo_permiso" | "escuchando";

export type EventoDictado =
  /** La persona apretó el botón para empezar. */
  | { tipo: "pedir" }
  /** El navegador avisó que el micrófono está abierto (`onstart`). */
  | { tipo: "abrio" }
  /** `onerror`, con el código seco del navegador. */
  | { tipo: "error"; codigo?: string | null }
  /** `onend`: el reconocedor terminó, por lo que sea. */
  | { tipo: "fin" }
  /** La persona apretó el botón para cortar. */
  | { tipo: "cancelar" }
  /** Pasó el tiempo y el micrófono nunca se abrió ni avisó nada. */
  | { tipo: "vencio" };

export type Transicion = {
  estado: EstadoDictado;
  /** Hay que abortar el reconocedor y soltar el micrófono. */
  soltar: boolean;
  /** Lo que se le muestra a la persona. Vacío cuando no hay nada que decir. */
  error: string;
};

/**
 * Cuánto se espera a que el navegador diga algo antes de darlo por colgado.
 *
 * Ocho segundos es holgado para un cartel de permiso que la persona todavía no
 * respondió, y corto para no dejar el botón rojo indefinidamente si el
 * reconocedor nunca contesta — que es lo que pasa en algunos WebView.
 */
export const ESPERA_MAXIMA_MS = 8_000;

export const ERROR_COLGADO =
  "No pudimos abrir el micrófono. Escribilo y seguimos igual.";

export function siguienteEstado(
  estado: EstadoDictado,
  evento: EventoDictado,
): Transicion {
  switch (evento.tipo) {
    case "pedir":
      // Apretar mientras ya está escuchando es la forma de cortar, y quien
      // llama lo resuelve mandando `cancelar`. Acá, pedir dos veces no
      // arranca dos reconocedores.
      return estado === "inactivo"
        ? { estado: "pidiendo_permiso", soltar: false, error: "" }
        : { estado, soltar: false, error: "" };

    case "abrio":
      return { estado: "escuchando", soltar: false, error: "" };

    case "error":
      // El único camino que muestra un mensaje, y también apaga. Antes solo
      // mostraba.
      return {
        estado: "inactivo",
        soltar: true,
        error: mensajeDeErrorDeVoz(evento.codigo),
      };

    case "vencio":
      return { estado: "inactivo", soltar: true, error: ERROR_COLGADO };

    case "cancelar":
    case "fin":
      // Cortar a propósito no es un error y no lleva mensaje.
      return { estado: "inactivo", soltar: true, error: "" };
  }
}

/** ¿Este estado tiene que verse como "estamos grabando"? */
export function estaEscuchando(estado: EstadoDictado): boolean {
  return estado === "escuchando";
}

/**
 * ¿Se puede escribir?
 *
 * Siempre. Está escrito como función y con su prueba porque es la regla que el
 * bug rompía en la práctica: con el botón trabado en rojo, la persona creía
 * que el chat estaba tomado y no volvía a escribir hasta recargar. Ningún
 * estado del dictado puede bloquear el teclado.
 */
export function puedeEscribir(estado: EstadoDictado): boolean {
  // El `void` no es adorno: la firma toma el estado a propósito, para que
  // quien lea la llamada vea que la pregunta se hizo y la respuesta es "sí"
  // en los tres. Una función sin argumentos no diría eso.
  void estado;
  return true;
}
