import ExcelJS from "exceljs";

import {
  esColumnaNumerica,
  totalesDeTabla,
  type Bloque,
  type Columna,
  type Documento,
} from "./especificacion.ts";

/**
 * Cualquier documento de EOS, en Excel.
 *
 * ============================================================
 * LA REGLA: LOS NÚMEROS VAN COMO NÚMEROS
 * ============================================================
 *
 * Es la única razón por la que alguien pide algo en Excel y no en PDF. Un
 * archivo donde "₲ 1.500.000" es una cadena de texto se ve igual en pantalla
 * y no sirve para nada: no se suma, no se ordena de mayor a menor, no entra en
 * una tabla dinámica. Entonces el símbolo y los puntos de mil viven en el
 * FORMATO de la celda, y el valor guardado es 1500000 a secas.
 *
 * ============================================================
 * UNA TABLA, UNA HOJA
 * ============================================================
 *
 * El resto del documento —los títulos, los párrafos, las advertencias— va en
 * una primera hoja de resumen, y cada tabla se lleva la suya. Apilar tres
 * tablas una debajo de la otra en la misma hoja es lo que hace que el filtro
 * automático agarre las filas equivocadas, y es exactamente en ese momento
 * cuando el usuario deja de confiar en el archivo.
 */

const AZUL = "FF1656BD";
const AZUL_OSCURO = "FF113F8C";
const GRIS = "FF6B7280";
const LINEA = "FFE5E7EB";
const AMBAR = "FFB45309";

function formatoDeColumna(columna: Columna, monedaDefecto: string): string | undefined {
  if (columna.tipo === "dinero") {
    const moneda = columna.moneda || monedaDefecto;
    const simbolo = moneda === "USD" ? '"US$" ' : moneda === "PYG" ? '"₲" ' : `"${moneda}" `;
    const decimales = moneda === "PYG" ? "" : ".00";
    return `${simbolo}#,##0${decimales};[Red]-${simbolo}#,##0${decimales}`;
  }

  if (columna.tipo === "porcentaje") return '0.0"%"';
  if (columna.tipo === "numero") return "#,##0.##";

  return undefined;
}

/**
 * Excel no acepta cualquier cosa como nombre de hoja: hasta 31 caracteres, sin
 * `[]:*?/\` y sin repetirse. Un nombre inválido no da un error prolijo, hace
 * que el archivo entero se abra "reparado" y con las hojas renombradas.
 */
function nombreDeHoja(propuesto: string, usados: Set<string>): string {
  const base =
    propuesto
      .replace(/[[\]:*?/\\]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 31) || "Tabla";

  let nombre = base;
  let n = 2;

  while (usados.has(nombre.toLowerCase())) {
    const sufijo = ` (${n++})`;
    nombre = `${base.slice(0, 31 - sufijo.length)}${sufijo}`;
  }

  usados.add(nombre.toLowerCase());
  return nombre;
}

function escribirEncabezado(hoja: ExcelJS.Worksheet, documento: Documento, ancho: number) {
  const ultima = String.fromCharCode(64 + Math.min(Math.max(ancho, 2), 26));

  hoja.mergeCells(`A1:${ultima}1`);
  const t = hoja.getCell("A1");
  t.value = documento.titulo;
  t.font = { name: "Calibri", size: 18, bold: true, color: { argb: AZUL_OSCURO } };
  t.alignment = { vertical: "middle" };
  hoja.getRow(1).height = 26;

  hoja.mergeCells(`A2:${ultima}2`);
  const s = hoja.getCell("A2");
  s.value = documento.subtitulo
    ? `${documento.subtitulo} · generado el ${documento.generadoEl}`
    : `TransTech EOS · generado el ${documento.generadoEl}`;
  s.font = { name: "Calibri", size: 10, color: { argb: GRIS } };
}

function escribirTabla(
  hoja: ExcelJS.Worksheet,
  bloque: Extract<Bloque, { tipo: "tabla" }>,
  documento: Documento,
  desdeFila: number,
): number {
  const { columnas, filas } = bloque;

  const encabezado = hoja.getRow(desdeFila);
  columnas.forEach((columna, i) => {
    const celda = encabezado.getCell(i + 1);
    celda.value = columna.titulo;
    celda.font = { name: "Calibri", size: 10, bold: true, color: { argb: "FFFFFFFF" } };
    celda.fill = { type: "pattern", pattern: "solid", fgColor: { argb: AZUL } };
    celda.alignment = { vertical: "middle", horizontal: esColumnaNumerica(columna) ? "right" : "left" };
  });
  encabezado.height = 20;

  filas.forEach((fila, indiceFila) => {
    const r = hoja.getRow(desdeFila + 1 + indiceFila);

    columnas.forEach((columna, i) => {
      const celda = r.getCell(i + 1);
      celda.value = fila[i];
      celda.font = { name: "Calibri", size: 10 };
      celda.border = { bottom: { style: "hair", color: { argb: LINEA } } };

      const formato = formatoDeColumna(columna, documento.moneda);
      if (formato) celda.numFmt = formato;
      if (esColumnaNumerica(columna)) celda.alignment = { horizontal: "right" };
    });
  });

  let ultimaFila = desdeFila + filas.length;

  const totales = totalesDeTabla(bloque);
  if (totales) {
    ultimaFila += 1;
    const r = hoja.getRow(ultimaFila);

    columnas.forEach((columna, i) => {
      const celda = r.getCell(i + 1);
      const total = totales[i];

      celda.value = total === null ? (i === 0 ? "Total" : null) : total;
      celda.font = { name: "Calibri", size: 10, bold: true, color: { argb: AZUL_OSCURO } };
      celda.border = { top: { style: "thin", color: { argb: AZUL } } };

      const formato = formatoDeColumna(columna, documento.moneda);
      if (formato) celda.numFmt = formato;
      if (esColumnaNumerica(columna)) celda.alignment = { horizontal: "right" };
    });
  }

  // El ancho sale del contenido real: una columna de descripciones y una de
  // importes no pueden medir lo mismo, y nadie va a ajustarlas a mano.
  columnas.forEach((columna, i) => {
    const largos = filas.map((fila) => {
      const valor = fila[i];
      if (valor === null) return 0;
      return typeof valor === "number" ? String(Math.round(valor)).length + 6 : valor.length;
    });

    const maximo = Math.max(columna.titulo.length + 2, ...largos, 10);
    hoja.getColumn(i + 1).width = Math.min(maximo + 2, 60);
  });

  // Filtro solo si hay algo que filtrar: sobre una tabla de dos filas es ruido.
  if (filas.length >= 4) {
    hoja.autoFilter = {
      from: { row: desdeFila, column: 1 },
      to: { row: desdeFila + filas.length, column: columnas.length },
    };
    hoja.views = [{ state: "frozen", ySplit: desdeFila }];
  }

  return ultimaFila;
}

export async function crearExcelDocumento(documento: Documento): Promise<ExcelJS.Buffer> {
  const libro = new ExcelJS.Workbook();
  libro.creator = "TransTech EOS";
  libro.created = new Date();

  const tablas = documento.bloques.filter(
    (b): b is Extract<Bloque, { tipo: "tabla" }> => b.tipo === "tabla",
  );
  const narrativa = documento.bloques.filter((b) => b.tipo !== "tabla");

  const usados = new Set<string>();

  // La hoja de resumen existe cuando hay algo que contar, o cuando NO hay
  // ninguna tabla: un libro de Excel sin hojas no se puede abrir.
  if (narrativa.length > 0 || tablas.length === 0) {
    const hoja = libro.addWorksheet(nombreDeHoja(tablas.length ? "Resumen" : documento.titulo, usados));
    escribirEncabezado(hoja, documento, 4);
    hoja.getColumn(1).width = 4;
    hoja.getColumn(2).width = 100;

    let fila = 4;

    for (const bloque of narrativa) {
      if (bloque.tipo === "titulo") {
        const celda = hoja.getCell(`B${fila}`);
        celda.value = bloque.texto;
        celda.font = {
          name: "Calibri",
          size: bloque.nivel === 1 ? 14 : bloque.nivel === 2 ? 12 : 11,
          bold: true,
          color: { argb: AZUL_OSCURO },
        };
        fila += 2;
        continue;
      }

      if (bloque.tipo === "parrafo" || bloque.tipo === "nota") {
        const celda = hoja.getCell(`B${fila}`);
        celda.value = bloque.texto;
        celda.alignment = { wrapText: true, vertical: "top" };
        celda.font = {
          name: "Calibri",
          size: 10,
          italic: bloque.tipo === "nota",
          color: { argb: bloque.tipo === "nota" ? AMBAR : "FF111827" },
        };
        // Alto estimado: exceljs no mide texto, y una fila de 15 puntos con un
        // párrafo de cinco líneas adentro se ve como una línea cortada.
        hoja.getRow(fila).height = Math.min(120, 14 * Math.ceil(bloque.texto.length / 95));
        fila += 2;
        continue;
      }

      if (bloque.tipo === "lista") {
        bloque.items.forEach((item, i) => {
          const celda = hoja.getCell(`B${fila}`);
          celda.value = bloque.ordenada ? `${i + 1}. ${item}` : `• ${item}`;
          celda.font = { name: "Calibri", size: 10 };
          celda.alignment = { wrapText: true, vertical: "top" };
          fila += 1;
        });
        fila += 1;
        continue;
      }

      if (bloque.tipo === "indicadores") {
        for (const indicador of bloque.items) {
          const etiqueta = hoja.getCell(`B${fila}`);
          etiqueta.value = indicador.detalle
            ? `${indicador.etiqueta} — ${indicador.valor} (${indicador.detalle})`
            : `${indicador.etiqueta} — ${indicador.valor}`;
          etiqueta.font = { name: "Calibri", size: 11, bold: true, color: { argb: AZUL_OSCURO } };
          fila += 1;
        }
        fila += 1;
      }
    }
  }

  for (const tabla of tablas) {
    const hoja = libro.addWorksheet(nombreDeHoja(tabla.titulo ?? "Tabla", usados));

    if (tablas.length === 1 && narrativa.length === 0) {
      escribirEncabezado(hoja, documento, tabla.columnas.length);
      escribirTabla(hoja, tabla, documento, 4);
    } else {
      const t = hoja.getCell("A1");
      t.value = tabla.titulo ?? documento.titulo;
      t.font = { name: "Calibri", size: 13, bold: true, color: { argb: AZUL_OSCURO } };
      escribirTabla(hoja, tabla, documento, 3);
    }
  }

  return libro.xlsx.writeBuffer();
}
