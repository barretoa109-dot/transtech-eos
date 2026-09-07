/**
 * Etapa 2: juntar lo que devolvió el Worker con lo que ya dijo el modelo.
 *
 * Puerto del nodo `08 GW Agregar Resultados Worker`.
 *
 * ============================================================
 * UN REINTENTO NO ES UNA SEGUNDA EJECUCIÓN
 * ============================================================
 *
 * El Worker Gate reconoce un comando repetido y contesta que ya estaba hecho,
 * sin volver a hacerlo. Ese resultado llega marcado (`idempotent`,
 * `command_idempotent`, `decision: "completed"`) y va a su propia lista.
 *
 * Contarlo como ejecutado diría que la venta se cargó dos veces, que es
 * exactamente lo contrario de lo que pasó y lo que más asusta a quien lo lee.
 *
 * ============================================================
 * NUNCA `String(objeto)`
 * ============================================================
 *
 * `extraerTexto` baja campo por campo en vez de convertir. Un `String(objeto)`
 * produce `"[object Object]"`, y eso terminaría en la burbuja del chat como si
 * fuera la respuesta.
 */

export type ResultadoWorker = Record<string, unknown>;

export type Base = {
  request_id: string;
  conversacion_id: string;
  respuesta: string;
  documento: Record<string, unknown> | null;
  acciones: { tipo: string; datos: Record<string, unknown> }[];
  accion: string;
  metadata: Record<string, unknown>;
  tokens_entrada: number;
  tokens_salida: number;
};

export type Final = {
  request_id: string;
  conversacion_id: string;
  respuesta: string;
  tokens_entrada: number;
  tokens_salida: number;
  documento: Record<string, unknown> | null;
  acciones: { tipo: string; datos: Record<string, unknown> }[];
  tipo: "texto" | "archivo";
  archivo_url: string;
  archivo_tipo: string;
  archivo_nombre: string;
  accion: string;
  metadata: Record<string, unknown>;
  worker: {
    ok: boolean;
    resultados: number;
    acciones_ejecutadas: string[];
    acciones_idempotentes: string[];
    errores: { accion: string; error: string }[];
  };
};

const CAMPOS_DE_TEXTO = ["respuesta", "message", "text", "output_text", "content"] as const;

/**
 * Lo que el worker escribe cuando él tampoco sabe por qué falló.
 *
 * Tiene que decir exactamente lo mismo que el nodo "05 INT Respuesta" del
 * workflow. Si dicen cosas distintas, este archivo va a tratar la frase
 * genérica como si fuera un motivo real y el usuario va a leer "no fue posible
 * completar la acción interna" en vez de saber QUÉ acción falló, que es lo
 * poco que se sabe en ese caso.
 */
const MOTIVO_GENERICO = "No fue posible completar la acción interna.";

function esObjeto(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === "object" && !Array.isArray(v);
}

/** Saca texto real. Nunca convierte un objeto a string. */
export function extraerTexto(valor: unknown): string {
  if (valor === null || valor === undefined) return "";
  if (typeof valor === "string") return valor.trim();

  if (Array.isArray(valor)) {
    for (const item of valor) {
      const t = extraerTexto(item);
      if (t) return t;
    }
    return "";
  }

  if (!esObjeto(valor)) return "";

  for (const campo of CAMPOS_DE_TEXTO) {
    const t = extraerTexto(valor[campo]);
    if (t) return t;
  }

  // Algunos endpoints del Worker devuelven lo durable adentro de `resultado`.
  if (esObjeto(valor.resultado)) {
    for (const campo of CAMPOS_DE_TEXTO) {
      const t = extraerTexto(valor.resultado[campo]);
      if (t) return t;
    }
  }

  return "";
}

export function accionDe(r: ResultadoWorker): string {
  const anidada = esObjeto(r?.resultado) ? (r.resultado as Record<string, unknown>).accion : undefined;
  const valor = r?.accion ?? r?.action ?? anidada ?? "";
  return typeof valor === "string" ? valor.trim().toUpperCase() : "";
}

export function tieneError(r: ResultadoWorker): boolean {
  return Boolean(r && (r.ok === false || r.error));
}

/** Un resultado que el gate reconoció como repetido, no como recién hecho. */
function esRepetido(r: ResultadoWorker): boolean {
  return r.idempotent === true || r.command_idempotent === true || r.decision === "completed";
}

export function juntarResultados(base: Base, resultados: ResultadoWorker[]): Final {
  const errores = resultados.filter(tieneError);
  const validos = resultados.filter((r) => !tieneError(r));

  const archivo = validos.find(
    (r) => typeof r.archivo_url === "string" && (r.archivo_url as string).trim(),
  );
  const archivoUrl = String(archivo?.archivo_url ?? "").trim();

  let respuesta = extraerTexto(base.respuesta) || "Listo.";

  /*
   * Lo que dijo el Worker, sin repetir lo que ya dijo el modelo.
   *
   * Se descartan los duplicados entre sí y los que ya están adentro de la
   * respuesta: si no, el usuario lee dos veces la misma frase y parece que el
   * sistema tartamudea.
   */
  const delWorker = validos
    .filter((r) => accionDe(r) !== "RESPONDER")
    .map((r) => extraerTexto(r))
    .filter(Boolean)
    .filter((t, i, arr) => arr.indexOf(t) === i)
    .filter((t) => !respuesta.includes(t));

  /*
   * Una lectura REEMPLAZA la respuesta, no se le suma.
   *
   * Quien pidió el dashboard quiere los números, no la frase de cortesía que
   * el modelo escribió antes de tenerlos.
   */
  const lectura = validos.find(
    (r) =>
      r.executed === true &&
      ["VER_DASHBOARD", "VER_BRIEFING"].includes(accionDe(r)) &&
      extraerTexto(r),
  );

  if (lectura) {
    respuesta = extraerTexto(lectura);
    const extras = delWorker.filter((t) => t !== respuesta);
    if (extras.length > 0) respuesta = `${respuesta}\n\n${extras.join("\n\n")}`.trim();
  } else if (delWorker.length > 0) {
    respuesta = `${respuesta}\n\n${delWorker.join("\n\n")}`.trim();
  }

  if (archivoUrl && !respuesta.includes(archivoUrl)) {
    respuesta = `${respuesta}\n\nDescargar archivo: ${archivoUrl}`.trim();
  }

  /*
   * Un error se dice, no se esconde. Y se dice POR QUÉ, si se sabe.
   *
   * El modelo ya escribió "lo dejo listo". Si el worker no pudo, callarlo deja
   * a la persona creyendo que su venta quedó cargada.
   *
   * Hasta el 7 de septiembre de 2026 esto solo nombraba la acción: "No pude
   * completar automáticamente: REGISTRAR_VENTA." El motivo venía en el mismo
   * resultado y se descartaba, porque los resultados con error nunca aportaban
   * texto — solo los válidos.
   *
   * Probado de punta a punta: alguien pidió "vendí 3 bolsas de balanceado a
   * Rossana" y leyó esa frase seca. El resultado traía adentro "No encontré a
   * Rossana entre tus contactos, pedime que la agende primero", que es la
   * diferencia entre un callejón sin salida y algo que se arregla en cinco
   * segundos.
   */
  if (errores.length > 0) {
    const motivos: string[] = [];
    const sinMotivo: string[] = [];

    for (const error of errores) {
      const texto = extraerTexto(error);

      if (texto && texto !== MOTIVO_GENERICO) motivos.push(texto);
      else sinMotivo.push(accionDe(error));
    }

    const unicos = [...new Set(motivos)].filter((t) => !respuesta.includes(t));
    if (unicos.length > 0) respuesta = `${respuesta}\n\n${unicos.join("\n\n")}`.trim();

    // Sin motivo se nombra la acción, que es lo único que se sabe. Es la
    // frase de siempre, ahora reservada para cuando de verdad no hay más.
    const acciones = [...new Set(sinMotivo.filter(Boolean))];
    if (acciones.length > 0) {
      respuesta = `${respuesta}\n\nNo pude completar automáticamente: ${acciones.join(", ")}.`.trim();
    }
  }

  const ejecutadas = validos
    .filter((r) => (r.executed === true || r.estado === "completada") && !esRepetido(r))
    .map(accionDe)
    .filter(Boolean);

  const repetidas = validos.filter(esRepetido).map(accionDe).filter(Boolean);

  return {
    request_id: base.request_id,
    conversacion_id: base.conversacion_id,
    respuesta,
    tokens_entrada: base.tokens_entrada,
    tokens_salida: base.tokens_salida,
    documento: base.documento,
    acciones: base.acciones,
    tipo: archivoUrl ? "archivo" : "texto",
    archivo_url: archivoUrl,
    archivo_tipo: String(archivo?.archivo_tipo ?? "").trim(),
    archivo_nombre: String(archivo?.archivo_nombre ?? "").trim(),
    accion: archivo ? accionDe(archivo) || "GENERAR_EXCEL" : base.accion || "RESPONDER",
    metadata: base.metadata,
    worker: {
      ok: errores.length === 0,
      resultados: resultados.length,
      acciones_ejecutadas: [...new Set(ejecutadas)],
      acciones_idempotentes: [...new Set(repetidas)],
      errores: errores.map((e) => ({
        accion: accionDe(e),
        error: extraerTexto(e.error) || extraerTexto(e.message) || "Worker no completado",
      })),
    },
  };
}
