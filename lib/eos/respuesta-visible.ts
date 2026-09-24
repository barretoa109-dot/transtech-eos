/**
 * Lo último que toca la respuesta antes de que la vea la persona.
 *
 * ============================================================
 * POR QUÉ EXISTE (24 de septiembre de 2026)
 * ============================================================
 *
 * Usando EOS de verdad, el chat mostró esto en medio de una respuesta:
 *
 *     409 - "{"ok":false,"execute":false,"decision":"block","error":"El replay
 *     cambió el payload de la orden original.","code":"EOS_COMMAND_PAYLOAD_MISMATCH"}"
 *
 * Es la salida cruda de un nodo HTTP de n8n cuando el Worker Gate rechaza una
 * orden: el Worker la copia como "motivo" y el gateway la pega en la
 * respuesta. Ningún cliente puede leer eso. Y abajo, en cada respuesta que
 * había anotado algo, "Guardé esa información en la memoria empresarial.",
 * repetido mensaje tras mensaje aunque nadie lo hubiera pedido.
 *
 * Los dos se corrigen también en su origen (el gateway y el prompt), pero el
 * texto viene de dos caminos (n8n y el gateway en TypeScript) y de un modelo
 * que puede escribir cualquier cosa. Esto es la red que no depende de que
 * cada uno de ellos se porte bien: corre siempre, al final, en el servidor.
 *
 * ============================================================
 * QUÉ SACA Y QUÉ NO
 * ============================================================
 *
 * Saca LÍNEAS enteras que son técnicas sin ambigüedad: un código HTTP con su
 * cuerpo, JSON de error, códigos internos `EOS_*`, pilas de error, rutas de
 * archivos del código y rutas internas de la API. Si sacó algo, deja UNA frase
 * humana en su lugar, para que la persona sepa que algo no se completó en vez
 * de creer que todo salió bien.
 *
 * No toca montos, fechas, nombres ni el texto normal: un falso positivo acá
 * borraría una respuesta buena, así que cada patrón exige una forma que un
 * mensaje escrito para una persona no tiene nunca.
 */

/** La frase que reemplaza lo técnico que se sacó. */
export const AVISO_ACCION_NO_COMPLETADA =
  "Una parte de lo que pediste no se pudo completar. Pedímelo de nuevo y lo intento otra vez.";

/*
 * Confirmaciones automáticas de memoria que el Worker agrega solas. La memoria
 * se guarda igual; lo que no hace falta es anunciarlo en cada respuesta.
 */
const CONFIRMACIONES_DE_MEMORIA = [
  "Guardé esa información en la memoria empresarial.",
];

const LINEA_TECNICA: RegExp[] = [
  // `409 - "{...}"`, `500 - {...}`: el formato de error del nodo HTTP de n8n.
  /^\s*\d{3}\s*-\s*["'{]/,
  // Cualquier línea que contenga un objeto JSON con claves entre comillas.
  /\{\s*"[a-z_]+"\s*:/i,
  // Códigos internos del sistema.
  /\bEOS_[A-Z0-9]+(?:_[A-Z0-9]+)+\b/,
  // Pilas de error.
  /^\s*at\s+[\w$.<>]+\s*\(/,
  /\b(?:TypeError|ReferenceError|SyntaxError|RangeError):\s/,
  // Rutas del código o de la API interna.
  /(?:^|[\s("'`])(?:\/?(?:app|lib|scripts|supabase|n8n|node_modules)\/[\w\-./[\]]+\.(?:ts|tsx|js|mjs|cjs|sql|json))/,
  /\/api\/internal\//,
  /\bnode_modules\b/,
];

function esTecnica(linea: string): boolean {
  return LINEA_TECNICA.some((patron) => patron.test(linea));
}

export type Limpieza = {
  texto: string;
  /** Cuántas líneas técnicas se sacaron (para el log, no para el usuario). */
  lineasTecnicas: number;
  /** Si se sacó una confirmación automática de memoria. */
  confirmacionMemoria: boolean;
};

export function limpiarRespuestaVisible(texto: string, respaldo = "Listo."): Limpieza {
  let confirmacionMemoria = false;
  let lineasTecnicas = 0;

  let salida = String(texto ?? "");

  for (const frase of CONFIRMACIONES_DE_MEMORIA) {
    if (salida.includes(frase)) {
      confirmacionMemoria = true;
      salida = salida.split(frase).join("");
    }
  }

  const lineas = salida.split("\n").filter((linea) => {
    if (!esTecnica(linea)) return true;
    lineasTecnicas += 1;
    return false;
  });

  salida = lineas
    .join("\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (lineasTecnicas > 0 && !salida.includes(AVISO_ACCION_NO_COMPLETADA)) {
    salida = salida ? `${salida}\n\n${AVISO_ACCION_NO_COMPLETADA}` : AVISO_ACCION_NO_COMPLETADA;
  }

  return { texto: salida || respaldo, lineasTecnicas, confirmacionMemoria };
}
