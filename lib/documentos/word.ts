import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";

import {
  esColumnaNumerica,
  formatearCelda,
  totalesDeTabla,
  type Bloque,
  type Columna,
  type Documento,
} from "./especificacion.ts";

/**
 * Cualquier documento de EOS, en Word.
 *
 * Es el formato para el que va a EDITAR: agregarle un párrafo antes de
 * mandarlo, pegarle el membrete de la empresa, firmarlo. Por eso todo sale
 * como texto y tablas de verdad —nada de imágenes ni cuadros flotantes—: lo
 * que no se puede seleccionar con el cursor no sirve en un Word.
 *
 * Acá sí se usa el signo ₲: un .docx es XML en UTF-8 y la fuente la resuelve
 * Word en la máquina de quien lo abre. La restricción de "Gs." es de las
 * fuentes base del PDF y no aplica (ver `pdf.ts`).
 */

const AZUL = "113F8C";
const AZUL_CLARO = "1656BD";
const GRIS = "6B7280";
const AMBAR = "B45309";
const LINEA = "E5E7EB";

const SIN_BORDES = {
  top: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
  bottom: { style: BorderStyle.SINGLE, size: 2, color: LINEA },
  left: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
  right: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
};

function celda(
  texto: string,
  opciones: { negrita?: boolean; color?: string; derecha?: boolean; fondo?: string } = {},
) {
  return new TableCell({
    borders: SIN_BORDES,
    ...(opciones.fondo
      ? { shading: { type: ShadingType.CLEAR, color: "auto", fill: opciones.fondo } }
      : {}),
    children: [
      new Paragraph({
        alignment: opciones.derecha ? AlignmentType.RIGHT : AlignmentType.LEFT,
        children: [
          new TextRun({ text: texto, bold: opciones.negrita, color: opciones.color, size: 19 }),
        ],
      }),
    ],
  });
}

function encabezadoDeTabla(columnas: Columna[]): TableRow {
  return new TableRow({
    // `tableHeader` es lo que hace que Word repita esta fila arriba de cada
    // página cuando la tabla se parte. Sin eso, de la hoja dos en adelante las
    // columnas quedan sin nombre.
    tableHeader: true,
    children: columnas.map(
      (columna) =>
        new TableCell({
          borders: SIN_BORDES,
          shading: { type: ShadingType.CLEAR, color: "auto", fill: AZUL_CLARO },
          children: [
            new Paragraph({
              alignment: esColumnaNumerica(columna) ? AlignmentType.RIGHT : AlignmentType.LEFT,
              children: [
                new TextRun({ text: columna.titulo, bold: true, color: "FFFFFF", size: 19 }),
              ],
            }),
          ],
        }),
    ),
  });
}

function tablaDeBloque(bloque: Extract<Bloque, { tipo: "tabla" }>, documento: Documento): Table {
  const filas: TableRow[] = [encabezadoDeTabla(bloque.columnas)];

  for (const fila of bloque.filas) {
    filas.push(
      new TableRow({
        children: bloque.columnas.map((columna, i) =>
          celda(formatearCelda(fila[i], columna, documento.moneda), {
            derecha: esColumnaNumerica(columna),
          }),
        ),
      }),
    );
  }

  const totales = totalesDeTabla(bloque);
  if (totales) {
    filas.push(
      new TableRow({
        children: bloque.columnas.map((columna, i) => {
          const total = totales[i];
          const texto =
            total === null
              ? i === 0
                ? "Total"
                : ""
              : formatearCelda(total, columna, documento.moneda);

          return celda(texto, {
            negrita: true,
            color: AZUL,
            derecha: esColumnaNumerica(columna),
            fondo: "EEF3FB",
          });
        }),
      }),
    );
  }

  return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: filas });
}

function parrafosDeBloque(bloque: Bloque, documento: Documento): (Paragraph | Table)[] {
  if (bloque.tipo === "titulo") {
    return [
      new Paragraph({
        heading:
          bloque.nivel === 1
            ? HeadingLevel.HEADING_1
            : bloque.nivel === 2
              ? HeadingLevel.HEADING_2
              : HeadingLevel.HEADING_3,
        spacing: { before: 260, after: 120 },
        children: [
          new TextRun({
            text: bloque.texto,
            bold: true,
            color: AZUL,
            size: bloque.nivel === 1 ? 30 : bloque.nivel === 2 ? 25 : 22,
          }),
        ],
      }),
    ];
  }

  if (bloque.tipo === "parrafo") {
    // Un párrafo con saltos de línea adentro son varios párrafos en Word: un
    // solo TextRun con "\n" sale todo pegado en una línea infinita.
    return bloque.texto.split(/\n+/).map(
      (linea) =>
        new Paragraph({
          spacing: { after: 120 },
          children: [new TextRun({ text: linea, size: 21 })],
        }),
    );
  }

  if (bloque.tipo === "nota") {
    return [
      new Paragraph({
        spacing: { before: 120, after: 160 },
        border: { left: { style: BorderStyle.SINGLE, size: 12, color: AMBAR, space: 8 } },
        children: [new TextRun({ text: bloque.texto, italics: true, color: AMBAR, size: 19 })],
      }),
    ];
  }

  if (bloque.tipo === "lista") {
    return bloque.items.map(
      (item) =>
        new Paragraph({
          spacing: { after: 60 },
          ...(bloque.ordenada
            ? { numbering: { reference: "lista-eos", level: 0 } }
            : { bullet: { level: 0 } }),
          children: [new TextRun({ text: item, size: 21 })],
        }),
    );
  }

  if (bloque.tipo === "indicadores") {
    return [
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: bloque.items.map(
          (indicador) =>
            new TableRow({
              children: [
                celda(indicador.etiqueta, { color: GRIS }),
                celda(indicador.valor, { negrita: true, color: AZUL, derecha: true }),
                celda(indicador.detalle ?? "", { color: GRIS, derecha: true }),
              ],
            }),
        ),
      }),
      new Paragraph({ text: "", spacing: { after: 160 } }),
    ];
  }

  return [tablaDeBloque(bloque, documento), new Paragraph({ text: "", spacing: { after: 200 } })];
}

export async function crearWordDocumento(documento: Documento): Promise<Buffer> {
  const hijos: (Paragraph | Table)[] = [
    new Paragraph({
      spacing: { after: 60 },
      children: [new TextRun({ text: documento.titulo, bold: true, color: AZUL, size: 40 })],
    }),
  ];

  if (documento.subtitulo) {
    hijos.push(
      new Paragraph({
        spacing: { after: 40 },
        children: [new TextRun({ text: documento.subtitulo, color: GRIS, size: 21 })],
      }),
    );
  }

  hijos.push(
    new Paragraph({
      spacing: { after: 260 },
      children: [
        new TextRun({
          text: `TransTech EOS · generado el ${documento.generadoEl}`,
          color: GRIS,
          size: 17,
        }),
      ],
    }),
  );

  for (const bloque of documento.bloques) {
    hijos.push(...parrafosDeBloque(bloque, documento));
  }

  const doc = new Document({
    creator: "TransTech EOS",
    title: documento.titulo,
    description: documento.subtitulo ?? "",
    numbering: {
      config: [
        {
          reference: "lista-eos",
          levels: [
            {
              level: 0,
              format: "decimal",
              text: "%1.",
              alignment: AlignmentType.START,
              style: { paragraph: { indent: { left: 460, hanging: 260 } } },
            },
          ],
        },
      ],
    },
    styles: {
      default: {
        document: { run: { font: "Calibri", size: 21 } },
      },
    },
    sections: [{ properties: {}, children: hijos }],
  });

  return Packer.toBuffer(doc);
}
