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

/*
 * ============================================================
 * UN MISMO MENSAJE NO PUEDE DECIR "LE PUSE EL COSTO" Y "DECIME EL COSTO"
 * ============================================================
 *
 * 24/09/2026: "Registrá esta venta: Campera Marrón Claro, venta 230.000, costo
 * 207.052". El modelo pidió la venta (que crea el producto sin costo) y después
 * ACTUALIZAR_PRODUCTO con el costo. Las dos se hicieron bien, pero la frase de
 * la venta se armó cuando el costo todavía no estaba, y la respuesta terminó
 * con "A “Campera…” le puse ₲ 207.052" y, dos líneas más abajo, "Todavía no sé
 * cuánto te cuesta “Campera…”: decime el costo". La persona volvió a mandarlo.
 *
 * Si en la misma respuesta hay un costo puesto para ese producto, el pedido de
 * costo ya no es cierto y se saca.
 *
 * 25/09/2026: lo mismo con varios productos. "De 2 de esos productos no sé el
 * costo" no decía cuáles y no se podía sacar; desde la v198 el worker los
 * nombra, y acá se sacan los que sí tienen costo. Y un costo puesto se
 * reconoce en las tres frases que lo dicen: la de CREAR_PRODUCTO, la de
 * ACTUALIZAR_PRODUCTO ("“X”: costo 207.052 (no tenía)") y la de la venta que
 * trae el costo ("A “X” le puse el costo de ₲ ...").
 */
const COSTO_PUESTO = [
  /A \u201C([^\u201D]+)\u201D, que ya estaba sin costo, le puse \u20B2 [\d.,]+\./g,
  /\u201C([^\u201D]+)\u201D: (?:[^\u201C.]|\.\d)*?\bcosto (?:de )?[\d.,]+/g,
  /A \u201C([^\u201D]+)\u201D le puse el costo de \u20B2 [\d.,]+/g,
];
/** La de la venta con varios: "Les puse el costo a “A” (₲ 1), “B” (₲ 2), así que...". */
const COSTOS_PUESTOS = /Les puse el costo a ((?:\u201C[^\u201D]+\u201D \(\u20B2 [\d.,]+\)(?:, )?)+)/g;
const PIDE_COSTO =
  /\s*Todav\u00eda no s\u00e9 cu\u00e1nto te cuesta \u201C([^\u201D]+)\u201D, as\u00ed que el margen queda pendiente: decime el costo y lo completo\./g;
const PIDE_COSTOS =
  /\s*Todav\u00eda no s\u00e9 cu\u00e1nto te cuestan ((?:\u201C[^\u201D]+\u201D(?:, | y )?)+), as\u00ed que sus m\u00e1rgenes quedan pendientes: pasame los costos y los completo\./g;

function clave(nombre: string): string {
  return nombre.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

function entreComillas(nombres: string[]): string {
  const q = nombres.map((n) => `\u201C${n}\u201D`);
  return q.length > 1 ? `${q.slice(0, -1).join(", ")} y ${q[q.length - 1]}` : q.join("");
}

export function quitarPedidosDeCostoResueltos(texto: string): string {
  const conCosto = new Set([
    ...COSTO_PUESTO.flatMap((patron) => [...texto.matchAll(patron)].map((m) => m[1])),
    ...[...texto.matchAll(COSTOS_PUESTOS)].flatMap((m) => [...m[1].matchAll(/\u201C([^\u201D]+)\u201D/g)].map((n) => n[1])),
  ].map(clave));
  if (conCosto.size === 0) return texto;

  return texto
    .replace(PIDE_COSTO, (frase, nombre: string) => (conCosto.has(clave(nombre)) ? "" : frase))
    .replace(PIDE_COSTOS, (frase, lista: string) => {
      const todos = [...lista.matchAll(/\u201C([^\u201D]+)\u201D/g)].map((m) => m[1]);
      const faltan = todos.filter((n) => !conCosto.has(clave(n)));
      if (faltan.length === todos.length) return frase;
      if (faltan.length === 0) return "";
      if (faltan.length === 1) {
        return ` Todav\u00eda no s\u00e9 cu\u00e1nto te cuesta \u201C${faltan[0]}\u201D, as\u00ed que el margen queda pendiente: decime el costo y lo completo.`;
      }
      return ` Todav\u00eda no s\u00e9 cu\u00e1nto te cuestan ${entreComillas(faltan)}, as\u00ed que sus m\u00e1rgenes quedan pendientes: pasame los costos y los completo.`;
    });
}

export function limpiarRespuestaVisible(texto: string, respaldo = "Listo."): Limpieza {
  let confirmacionMemoria = false;
  let lineasTecnicas = 0;

  let salida = quitarPedidosDeCostoResueltos(String(texto ?? ""));

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
