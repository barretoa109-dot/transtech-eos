/**
 * Un documento cualquiera, descrito antes de saber si va a ser Excel, PDF o
 * Word.
 *
 * ============================================================
 * POR QUÉ ESTO EXISTE, SI YA HAY INFORMES
 * ============================================================
 *
 * `lib/informes` sabe armar UN documento: el balance. Está bien que así sea —
 * un balance tiene reglas propias y no se improvisa. Pero el pedido del
 * usuario es más ancho: "si pide una tabla en Excel con las necesidades que
 * EOS recopiló, que la pueda hacer, sin una plantilla genérica para todo".
 *
 * Eso no se resuelve con más plantillas. Se resuelve dejando que EOS DESCRIBA
 * el documento —este tipo— y que el repositorio lo DIBUJE. La lista de temas
 * posibles es infinita; la lista de formas de mostrar algo en una hoja es
 * corta: un título, un párrafo, una lista, una tabla, un indicador, una
 * advertencia. Con esos seis bloques se arma tanto un cuadro de necesidades
 * como un acta de reunión o un presupuesto.
 *
 * ============================================================
 * ESTO LLEGA DE UN MODELO. ES ENTRADA HOSTIL.
 * ============================================================
 *
 * El que rellena esta estructura es EOS, o sea un modelo de lenguaje: puede
 * mandar una tabla de cuarenta mil filas, un título de un megabyte, una fila
 * con menos celdas que columnas, o `null` donde va un número. Nada de eso
 * puede llegar a un renderizador: exceljs y pdfkit tienen todo el derecho a
 * explotar con basura, y la respuesta del chat se caería con ellos.
 *
 * Por eso la única puerta de entrada es `normalizarDocumento`, que no confía
 * en nada, recorta todo a un tope y devuelve un motivo legible cuando el
 * pedido no se puede honrar. La regla es: **recortar en silencio lo que se
 * puede recortar, rechazar entero lo que no se entiende.** Un documento que
 * sale con 2.000 filas en vez de 40.000 sigue sirviendo; uno con las columnas
 * corridas una posición miente.
 */

import { hoyEnParaguay } from "../fecha.ts";

export type TipoColumna = "texto" | "numero" | "dinero" | "fecha" | "porcentaje";

export type Columna = {
  titulo: string;
  tipo: TipoColumna;
  /** Solo para `dinero`. Si falta, se usa la del documento. */
  moneda?: string;
  /** Si la columna se totaliza al pie. Solo tiene sentido en numéricas. */
  total?: boolean;
};

/** Una celda ya normalizada: texto, número o vacío. Nunca `undefined`. */
export type Celda = string | number | null;

export type Indicador = {
  etiqueta: string;
  valor: string;
  detalle?: string;
};

export type Bloque =
  | { tipo: "titulo"; texto: string; nivel: 1 | 2 | 3 }
  | { tipo: "parrafo"; texto: string }
  | { tipo: "lista"; ordenada: boolean; items: string[] }
  | { tipo: "tabla"; titulo?: string; columnas: Columna[]; filas: Celda[][] }
  | { tipo: "indicadores"; items: Indicador[] }
  | { tipo: "nota"; texto: string };

export type Documento = {
  titulo: string;
  subtitulo?: string;
  /** Moneda por defecto de las columnas de dinero. */
  moneda: string;
  /** `YYYY-MM-DD`. Va impreso: un archivo viejo tiene que delatarse solo. */
  generadoEl: string;
  bloques: Bloque[];
};

export type Resultado =
  | { ok: true; documento: Documento; recortes: string[] }
  | { ok: false; motivo: string };

/**
 * Topes.
 *
 * No son estéticos: son el tamaño a partir del cual generar el archivo deja de
 * entrar en el tiempo de una request y empieza a comerse la memoria del
 * servidor. Están del lado generoso —dos mil filas es un año de movimientos—
 * porque recortar de más también es mentirle al usuario.
 */
const TOPE = {
  titulo: 200,
  subtitulo: 400,
  parrafo: 5_000,
  bloques: 120,
  columnas: 24,
  filas: 2_000,
  celda: 500,
  items: 300,
  item: 500,
  indicadores: 12,
  /** Total de celdas del documento entero, sumando todas las tablas. */
  celdasTotales: 20_000,
} as const;

const TIPOS_COLUMNA: TipoColumna[] = ["texto", "numero", "dinero", "fecha", "porcentaje"];

export function esColumnaNumerica(columna: Columna): boolean {
  return columna.tipo === "numero" || columna.tipo === "dinero" || columna.tipo === "porcentaje";
}

function texto(valor: unknown, tope: number): string {
  if (valor === null || valor === undefined) return "";
  const crudo = typeof valor === "string" ? valor : String(valor);
  // Los saltos de línea sobreviven en párrafos; los caracteres de control no,
  // porque un carácter de control en el XML de un .docx lo deja ilegible para Word.
  const limpio = crudo.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim();
  return limpio.length > tope ? `${limpio.slice(0, tope - 1)}…` : limpio;
}

function numero(valor: unknown): number | null {
  if (typeof valor === "number") return Number.isFinite(valor) ? valor : null;
  if (typeof valor !== "string") return null;

  // Se sacan el símbolo y los espacios, pero NO los separadores: son la única
  // pista de dónde termina la parte entera.
  const limpio = valor.replace(/[^\d,.\-]/g, "");
  if (!/\d/.test(limpio)) return null;

  const negativo = /^-/.test(valor.trim());
  const cuerpo = limpio.replace(/-/g, "");

  const ultimaComa = cuerpo.lastIndexOf(",");
  const ultimoPunto = cuerpo.lastIndexOf(".");

  /**
   * Cuál de los dos signos es el decimal.
   *
   * "1.234.567,89" y "1,234,567.89" conviven en los datos paraguayos según de
   * dónde vino el número: el extracto del banco escribe uno y un CSV exportado
   * de Excel en inglés escribe el otro. Las reglas, en orden:
   *
   *  1. Si están los dos, el que está más cerca del final es el decimal.
   *  2. Si hay uno solo y aparece varias veces, es separador de miles.
   *  3. Si hay uno solo y aparece una vez, decide cuántos dígitos lo siguen:
   *     tres dígitos exactos es miles ("1.250" son mil doscientos cincuenta,
   *     que es como se escribe acá), cualquier otra cantidad es decimal.
   */
  let decimal: "," | "." | null = null;

  if (ultimaComa >= 0 && ultimoPunto >= 0) {
    decimal = ultimaComa > ultimoPunto ? "," : ".";
  } else {
    const signo = ultimaComa >= 0 ? "," : ultimoPunto >= 0 ? "." : null;

    if (signo) {
      const apariciones = cuerpo.split(signo).length - 1;
      const cola = cuerpo.slice(cuerpo.lastIndexOf(signo) + 1);
      decimal = apariciones === 1 && cola.length !== 3 ? signo : null;
    }
  }

  const normalizado =
    decimal === null
      ? cuerpo.replace(/[.,]/g, "")
      : decimal === ","
        ? cuerpo.replace(/\./g, "").replace(",", ".")
        : cuerpo.replace(/,/g, "");

  const n = Number(normalizado);
  if (!Number.isFinite(n)) return null;

  return negativo ? -n : n;
}

function esObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor);
}

function normalizarColumna(valor: unknown, indice: number): Columna {
  const crudo = esObjeto(valor) ? valor : { titulo: texto(valor, TOPE.celda) };

  const tipoPedido = String(crudo.tipo ?? "texto").toLowerCase();
  const tipo = (TIPOS_COLUMNA as string[]).includes(tipoPedido)
    ? (tipoPedido as TipoColumna)
    : "texto";

  const moneda = texto(crudo.moneda, 8).toUpperCase();

  return {
    titulo: texto(crudo.titulo ?? crudo.nombre, 120) || `Columna ${indice + 1}`,
    tipo,
    ...(tipo === "dinero" && moneda ? { moneda } : {}),
    // Un total sobre una columna de texto no significa nada, así que se ignora
    // en vez de generar una fila de totales vacía al pie de la tabla.
    ...(crudo.total === true && tipo !== "texto" && tipo !== "fecha" ? { total: true } : {}),
  };
}

function normalizarFila(valor: unknown, columnas: Columna[]): Celda[] {
  // Un objeto con las claves de las columnas es la forma en que un modelo
  // escribe una fila cuando no le insistís con el arreglo. Aceptarlo evita
  // rechazar tablas perfectamente buenas por una diferencia de forma.
  const crudo: unknown[] = Array.isArray(valor)
    ? valor
    : esObjeto(valor)
      ? columnas.map((c) => valor[c.titulo] ?? valor[c.titulo.toLowerCase()])
      : [valor];

  return columnas.map((columna, i) => {
    const celda = crudo[i];

    if (celda === null || celda === undefined || celda === "") return null;

    if (esColumnaNumerica(columna)) return numero(celda);

    return texto(celda, TOPE.celda) || null;
  });
}

function normalizarBloque(
  valor: unknown,
  presupuesto: { celdas: number },
  recortes: string[],
): Bloque | null {
  if (typeof valor === "string") {
    const t = texto(valor, TOPE.parrafo);
    return t ? { tipo: "parrafo", texto: t } : null;
  }

  if (!esObjeto(valor)) return null;

  const tipo = String(valor.tipo ?? "").toLowerCase();

  if (tipo === "titulo" || tipo === "subtitulo" || tipo === "encabezado") {
    const t = texto(valor.texto ?? valor.titulo, TOPE.titulo);
    if (!t) return null;
    const nivelPedido = Number(valor.nivel ?? (tipo === "subtitulo" ? 2 : 1));
    const nivel = nivelPedido === 3 ? 3 : nivelPedido === 2 ? 2 : 1;
    return { tipo: "titulo", texto: t, nivel };
  }

  if (tipo === "parrafo" || tipo === "texto") {
    const t = texto(valor.texto ?? valor.contenido, TOPE.parrafo);
    return t ? { tipo: "parrafo", texto: t } : null;
  }

  if (tipo === "nota" || tipo === "advertencia" || tipo === "aviso") {
    const t = texto(valor.texto ?? valor.contenido, TOPE.parrafo);
    return t ? { tipo: "nota", texto: t } : null;
  }

  if (tipo === "lista") {
    const crudos = Array.isArray(valor.items) ? valor.items : [];
    const items = crudos
      .slice(0, TOPE.items)
      .map((i) => texto(i, TOPE.item))
      .filter(Boolean);

    if (crudos.length > TOPE.items) recortes.push(`una lista se cortó en ${TOPE.items} ítems`);
    if (items.length === 0) return null;

    return { tipo: "lista", ordenada: valor.ordenada === true || valor.numerada === true, items };
  }

  if (tipo === "indicadores" || tipo === "kpis" || tipo === "kpi") {
    const crudos = Array.isArray(valor.items) ? valor.items : [];
    const items = crudos
      .slice(0, TOPE.indicadores)
      .filter(esObjeto)
      .map((i) => ({
        etiqueta: texto(i.etiqueta ?? i.label ?? i.nombre, 80),
        valor: texto(i.valor ?? i.value, 60),
        ...(texto(i.detalle ?? i.nota, 120) ? { detalle: texto(i.detalle ?? i.nota, 120) } : {}),
      }))
      .filter((i) => i.etiqueta && i.valor);

    return items.length ? { tipo: "indicadores", items } : null;
  }

  if (tipo === "tabla") {
    const crudasColumnas = Array.isArray(valor.columnas) ? valor.columnas : [];
    const columnas = crudasColumnas.slice(0, TOPE.columnas).map(normalizarColumna);

    if (columnas.length === 0) return null;
    if (crudasColumnas.length > TOPE.columnas) {
      recortes.push(`una tabla se cortó en ${TOPE.columnas} columnas`);
    }

    const crudasFilas = Array.isArray(valor.filas) ? valor.filas : [];

    // El presupuesto de celdas es del documento entero, no de cada tabla: diez
    // tablas de dos mil filas son veinte mil filas igual.
    const cabenPorPresupuesto = Math.max(0, Math.floor(presupuesto.celdas / columnas.length));
    const limite = Math.min(TOPE.filas, cabenPorPresupuesto);

    const filas = crudasFilas.slice(0, limite).map((f) => normalizarFila(f, columnas));
    presupuesto.celdas -= filas.length * columnas.length;

    if (crudasFilas.length > filas.length) {
      recortes.push(
        `una tabla llegó con ${crudasFilas.length} filas y se incluyeron las primeras ${filas.length}`,
      );
    }

    const tituloTabla = texto(valor.titulo ?? valor.nombre, TOPE.titulo);

    return {
      tipo: "tabla",
      ...(tituloTabla ? { titulo: tituloTabla } : {}),
      columnas,
      filas,
    };
  }

  return null;
}

/**
 * La única puerta de entrada.
 *
 * Devuelve el motivo en castellano cuando no se puede armar nada, porque ese
 * texto termina en el chat: "no pude armar el archivo" a secas obliga al
 * usuario a adivinar si pedir de nuevo sirve de algo.
 */
export function normalizarDocumento(valor: unknown): Resultado {
  if (typeof valor === "string") {
    try {
      valor = JSON.parse(valor);
    } catch {
      return { ok: false, motivo: "El documento no vino en un formato que se pueda leer." };
    }
  }

  if (!esObjeto(valor)) {
    return { ok: false, motivo: "El documento no vino en un formato que se pueda leer." };
  }

  const titulo = texto(valor.titulo ?? valor.nombre, TOPE.titulo);
  if (!titulo) return { ok: false, motivo: "El documento no tiene título." };

  const crudos = Array.isArray(valor.bloques)
    ? valor.bloques
    : Array.isArray(valor.contenido)
      ? valor.contenido
      : [];

  const recortes: string[] = [];
  const presupuesto = { celdas: TOPE.celdasTotales };

  if (crudos.length > TOPE.bloques) {
    recortes.push(`el documento se cortó en ${TOPE.bloques} secciones`);
  }

  const bloques = crudos
    .slice(0, TOPE.bloques)
    .map((b) => normalizarBloque(b, presupuesto, recortes))
    .filter((b): b is Bloque => b !== null);

  if (bloques.length === 0) {
    return { ok: false, motivo: "El documento llegó sin contenido para escribir." };
  }

  const generadoEl = /^\d{4}-\d{2}-\d{2}$/.test(String(valor.generadoEl ?? ""))
    ? String(valor.generadoEl)
    : hoyEnParaguay();

  const moneda = texto(valor.moneda, 8).toUpperCase() || "PYG";
  const subtitulo = texto(valor.subtitulo ?? valor.descripcion, TOPE.subtitulo);

  return {
    ok: true,
    recortes,
    documento: {
      titulo,
      ...(subtitulo ? { subtitulo } : {}),
      moneda,
      generadoEl,
      bloques,
    },
  };
}

/**
 * Cómo se escribe un valor cuando el formato no puede guardarlo como número.
 *
 * El Excel NO usa esto: allá el número va como número y el símbolo vive en el
 * formato de celda, para que quien abra el archivo pueda sumar. Acá es para el
 * PDF y el Word, donde todo termina siendo texto igual.
 *
 * `simboloGuarani` en false imprime "Gs." en vez de "₲": las fuentes base del
 * PDF no tienen el glifo del guaraní. Ver el comentario largo de
 * `lib/informes/pdf.ts`.
 */
export function formatearCelda(
  valor: Celda,
  columna: Columna,
  monedaDefecto: string,
  simboloGuarani = true,
): string {
  if (valor === null) return "";
  if (typeof valor === "string") return valor;

  if (columna.tipo === "porcentaje") {
    return `${new Intl.NumberFormat("es-PY", { maximumFractionDigits: 1 }).format(valor)}%`;
  }

  if (columna.tipo === "dinero") {
    const moneda = columna.moneda || monedaDefecto;
    const simbolo =
      moneda === "USD" ? "US$" : moneda === "PYG" ? (simboloGuarani ? "₲" : "Gs.") : moneda;
    // Los guaraníes no llevan decimales; el resto sí, porque un dólar con
    // centavos redondeado a la unidad deja de cerrar contra el extracto.
    const decimales = moneda === "PYG" ? 0 : 2;
    const numeroFormateado = new Intl.NumberFormat("es-PY", {
      minimumFractionDigits: decimales,
      maximumFractionDigits: decimales,
    }).format(valor);
    return `${simbolo} ${numeroFormateado}`;
  }

  return new Intl.NumberFormat("es-PY", { maximumFractionDigits: 2 }).format(valor);
}

/** Los totales al pie, para las columnas que los pidieron. */
export function totalesDeTabla(
  bloque: Extract<Bloque, { tipo: "tabla" }>,
): (number | null)[] | null {
  if (!bloque.columnas.some((c) => c.total)) return null;

  return bloque.columnas.map((columna, i) => {
    if (!columna.total) return null;

    return bloque.filas.reduce<number>((total, fila) => {
      const celda = fila[i];
      return typeof celda === "number" ? total + celda : total;
    }, 0);
  });
}
