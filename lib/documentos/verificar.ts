/**
 * La última puerta antes de que un archivo salga del servidor.
 *
 * ============================================================
 * POR QUÉ NO ALCANZA CON VALIDAR LA DESCRIPCIÓN
 * ============================================================
 *
 * `especificacion.ts` ya no deja pasar un documento sin título, sin contenido
 * o con las columnas corridas. Eso protege la ENTRADA del renderizador.
 *
 * Esto protege la SALIDA, que es otra cosa. Entre una descripción sana y un
 * archivo sano hay tres bibliotecas (exceljs, pdfkit, docx), un stream y un
 * Buffer, y cualquiera de los tres puede devolver menos de lo que promete sin
 * lanzar un error: un stream que se cierra antes de tiempo entrega un PDF
 * cortado, y un `Buffer.concat` sobre un array vacío entrega cero bytes con
 * toda tranquilidad. El `try/catch` de la ruta no ve nada de eso porque no
 * hubo excepción — y el archivo se baja igual, con 200 y su Content-Type.
 *
 * Del lado del usuario eso es "EOS me mandó un archivo que no abre". Es la
 * queja más cara que existe, porque destruye la confianza en TODOS los
 * documentos, no en ese: nadie vuelve a bajar un balance si una vez le llegó
 * uno roto.
 *
 * ============================================================
 * QUÉ MIRA, Y POR QUÉ ESO ALCANZA
 * ============================================================
 *
 * No abre el archivo ni lo reparsea: sería caro y volvería a depender de las
 * mismas bibliotecas que estamos auditando. Mira cuatro cosas baratas que un
 * archivo sano SIEMPRE cumple y uno roto casi nunca:
 *
 *   1. que tenga bytes;
 *   2. que tenga al menos el tamaño que el formato no puede bajar;
 *   3. que empiece con la firma de su formato;
 *   4. que TERMINE con su marca de cierre.
 *
 * La cuarta es la que atrapa el corte, que es el caso silencioso: un PDF
 * cortado por la mitad empieza igual que uno entero.
 *
 * Ante la duda NO se entrega. Un documento que se puede volver a pedir cuesta
 * un clic; uno roto cuesta un cliente.
 */

export type FormatoArchivo = "excel" | "pdf" | "word";

export type Verificacion = { ok: true } | { ok: false; motivo: string };

/**
 * El piso de cada formato, con margen.
 *
 * Un xlsx y un docx son ZIP con varias entradas obligatorias: exceljs y docx
 * no bajan de unos 5 KB ni con una hoja en blanco. Un PDF de pdfkit con una
 * sola línea ronda el kilobyte. Los números de acá están MUY por debajo de
 * esos mínimos reales a propósito: la idea es atrapar el archivo trunco, no
 * discutir con la biblioteca si un documento chico es legítimo.
 */
const MINIMO: Record<FormatoArchivo, number> = {
  excel: 1024,
  word: 1024,
  pdf: 400,
};

/** `PK\x03\x04`: el encabezado de toda entrada ZIP. xlsx y docx son ZIP. */
const FIRMA_ZIP = [0x50, 0x4b, 0x03, 0x04];

/** `PK\x05\x06`: el fin del directorio central. Sin esto, el ZIP está cortado. */
const CIERRE_ZIP = [0x50, 0x4b, 0x05, 0x06];

/** `%PDF-` */
const FIRMA_PDF = [0x25, 0x50, 0x44, 0x46, 0x2d];

/** `%%EOF` */
const CIERRE_PDF = [0x25, 0x25, 0x45, 0x4f, 0x46];

/**
 * El directorio central de un ZIP puede llevar un comentario de hasta 64 KB
 * detrás, así que el cierre se busca en esa ventana. En un PDF el `%%EOF` es
 * lo último salvo por un salto de línea, pero se le da aire por si el
 * generador dejó objetos incrementales al final.
 */
const VENTANA_FINAL: Record<FormatoArchivo, number> = {
  excel: 66_560,
  word: 66_560,
  pdf: 4096,
};

export function verificarArchivo(formato: FormatoArchivo, cuerpo: Uint8Array | null | undefined): Verificacion {
  if (!cuerpo || cuerpo.length === 0) {
    return { ok: false, motivo: "el archivo salió sin un solo byte" };
  }

  if (cuerpo.length < MINIMO[formato]) {
    return {
      ok: false,
      motivo: `el archivo salió con ${cuerpo.length} bytes, por debajo del mínimo de un ${formato} (${MINIMO[formato]})`,
    };
  }

  const firma = formato === "pdf" ? FIRMA_PDF : FIRMA_ZIP;

  if (!empiezaCon(cuerpo, firma)) {
    return { ok: false, motivo: `el archivo no empieza con la firma de un ${formato}` };
  }

  const cierre = formato === "pdf" ? CIERRE_PDF : CIERRE_ZIP;

  if (!terminaConteniendo(cuerpo, cierre, VENTANA_FINAL[formato])) {
    return { ok: false, motivo: `el archivo quedó cortado: no aparece la marca de cierre de un ${formato}` };
  }

  return { ok: true };
}

function empiezaCon(cuerpo: Uint8Array, firma: number[]): boolean {
  if (cuerpo.length < firma.length) return false;

  for (let i = 0; i < firma.length; i += 1) {
    if (cuerpo[i] !== firma[i]) return false;
  }

  return true;
}

/** Busca la secuencia dentro de los últimos `ventana` bytes. */
function terminaConteniendo(cuerpo: Uint8Array, marca: number[], ventana: number): boolean {
  const desde = Math.max(0, cuerpo.length - ventana);

  for (let i = cuerpo.length - marca.length; i >= desde; i -= 1) {
    let coincide = true;

    for (let j = 0; j < marca.length; j += 1) {
      if (cuerpo[i + j] !== marca[j]) {
        coincide = false;
        break;
      }
    }

    if (coincide) return true;
  }

  return false;
}

/* ============================================================
   Y que los números del documento no se contradigan entre sí
   ============================================================

   El verificador de arriba mira los BYTES. Esto mira el contenido, y atrapa
   otra cosa: una tabla cuya fila "TOTAL" no suma sus propias filas.

   Pasa porque quien describe el documento es un modelo de lenguaje. Puede
   escribir doce filas correctas y un total redondeado de memoria, o arrastrar
   el total de una versión anterior de la tabla. El renderizador lo imprime
   fielmente, y el usuario recibe una planilla que se contradice a sí misma —
   con la particularidad de que la va a descubrir recién cuando la muestre.

   Un archivo que no abre se nota enseguida. Uno cuyo total está mal se nota
   tarde y delante de otro. */

export type ProblemaDeCifras = {
  tabla: string;
  columna: string;
  declarado: number;
  suma: number;
};

/** Cómo se llama una fila que dice ser el total de las de arriba. */
const ES_FILA_TOTAL = /^\s*(total|totales|suma|sumatoria|subtotal)\b/i;

/**
 * Cuánto puede desviarse sin ser una contradicción.
 *
 * Cada fila puede haberse redondeado hasta medio guaraní para arriba o para
 * abajo, así que con N filas la diferencia legítima máxima es N/2. Debajo de
 * eso es redondeo; arriba, alguien sumó mal.
 */
function tolerancia(filas: number): number {
  return Math.max(1, filas / 2);
}

export function cifrasContradictorias(documento: {
  bloques: { tipo: string; [clave: string]: unknown }[];
}): ProblemaDeCifras[] {
  const problemas: ProblemaDeCifras[] = [];

  for (const bloque of documento.bloques) {
    if (bloque.tipo !== "tabla") continue;

    const columnas = (bloque.columnas ?? []) as { titulo: string }[];
    const filas = (bloque.filas ?? []) as (string | number | null)[][];
    const titulo = String(bloque.titulo ?? "una tabla");

    for (let i = 0; i < filas.length; i += 1) {
      const primera = filas[i]?.[0];
      if (typeof primera !== "string" || !ES_FILA_TOTAL.test(primera)) continue;

      for (let j = 1; j < (filas[i]?.length ?? 0); j += 1) {
        const declarado = filas[i][j];
        if (typeof declarado !== "number" || !Number.isFinite(declarado)) continue;

        // Se suman solo las filas ANTERIORES que no son a su vez un total: una
        // tabla con subtotales por sección no puede contarlos dos veces.
        let suma = 0;
        let contadas = 0;

        for (let k = 0; k < i; k += 1) {
          const etiqueta = filas[k]?.[0];
          if (typeof etiqueta === "string" && ES_FILA_TOTAL.test(etiqueta)) continue;

          const celda = filas[k]?.[j];
          if (typeof celda === "number" && Number.isFinite(celda)) {
            suma += celda;
            contadas += 1;
          }
        }

        // Sin filas numéricas arriba no hay nada que contrastar: puede ser una
        // tabla de una sola línea que dice "Total" por título.
        if (contadas === 0) continue;

        if (Math.abs(suma - declarado) > tolerancia(contadas)) {
          problemas.push({
            tabla: titulo,
            columna: columnas[j]?.titulo ?? `columna ${j + 1}`,
            declarado,
            suma,
          });
        }
      }
    }
  }

  return problemas;
}

/** Lo que se le dice al usuario. Sin jerga y sin culparlo. */
export function avisoDeCifras(problemas: ProblemaDeCifras[]): string {
  const primero = problemas[0];

  return (
    `Este documento tiene un total que no coincide con sus filas ` +
    `("${primero.columna}" en ${primero.tabla}: dice ${primero.declarado} y las filas suman ${primero.suma}). ` +
    "No te lo entregamos así. Volvé a pedirlo."
  );
}
