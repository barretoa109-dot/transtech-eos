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

import { formatear, type Informe } from "./armar.ts";

/**
 * El informe, en Word.
 *
 * Es el formato para el que va a EDITAR: agregarle un párrafo antes de
 * mandarlo, pegarle el membrete de la empresa, firmarlo. Por eso todo va como
 * texto y tablas de verdad —nada de imágenes ni cuadros de texto flotantes—:
 * lo que no se puede seleccionar con el cursor no sirve en un Word.
 *
 * Acá sí se usa el signo ₲: .docx es XML en UTF-8 y la fuente la resuelve
 * Word en la máquina del que abre. La restricción del PDF (ver `pdf.ts`) es
 * de las fuentes base del formato PDF, y no aplica.
 */

const AZUL = "113F8C";
const GRIS = "6B7280";
const VERDE = "0F7A5F";
const ROJO = "C02626";
const LINEA = "E5E7EB";

const SIN_BORDES = {
  top: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
  bottom: { style: BorderStyle.SINGLE, size: 4, color: LINEA },
  left: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
  right: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
};

function celda(texto: string, opciones: { negrita?: boolean; color?: string; derecha?: boolean; ancho?: number } = {}) {
  return new TableCell({
    borders: SIN_BORDES,
    width: opciones.ancho ? { size: opciones.ancho, type: WidthType.PERCENTAGE } : undefined,
    children: [
      new Paragraph({
        alignment: opciones.derecha ? AlignmentType.RIGHT : AlignmentType.LEFT,
        children: [
          new TextRun({
            text: texto,
            bold: opciones.negrita,
            color: opciones.color,
            size: 20,
          }),
        ],
      }),
    ],
  });
}

function encabezado(textos: string[], anchos: number[]) {
  return new TableRow({
    children: textos.map(
      (t, i) =>
        new TableCell({
          borders: SIN_BORDES,
          shading: { type: ShadingType.CLEAR, fill: AZUL },
          width: { size: anchos[i], type: WidthType.PERCENTAGE },
          children: [
            new Paragraph({
              alignment: i === textos.length - 1 ? AlignmentType.RIGHT : AlignmentType.LEFT,
              children: [new TextRun({ text: t, bold: true, color: "FFFFFF", size: 18 })],
            }),
          ],
        }),
    ),
  });
}

function seccion(texto: string): Paragraph {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 320, after: 140 },
    children: [new TextRun({ text: texto, bold: true, color: AZUL, size: 26 })],
  });
}

export async function crearWordInforme(informe: Informe): Promise<Buffer> {
  const fmt = (v: number, moneda = informe.moneda) => formatear(v, moneda);

  const hijos: (Paragraph | Table)[] = [
    new Paragraph({
      spacing: { after: 60 },
      children: [new TextRun({ text: informe.titulo, bold: true, color: AZUL, size: 40 })],
    }),
    new Paragraph({
      spacing: { after: 20 },
      children: [new TextRun({ text: informe.periodo.etiqueta, color: GRIS, size: 20 })],
    }),
    new Paragraph({
      spacing: { after: 260 },
      children: [
        new TextRun({ text: `TransTech EOS · generado el ${informe.generadoEl}`, color: GRIS, size: 17 }),
      ],
    }),
  ];

  // ---------- Resumen ----------
  hijos.push(seccion("Resumen del período"));

  const filasResumen = [
    ["Ingresos", fmt(informe.resumen.ingresos), VERDE],
    ["Gastos", fmt(informe.resumen.gastos), ROJO],
    ["Resultado", fmt(informe.resumen.neto), informe.resumen.neto >= 0 ? VERDE : ROJO],
  ];

  if (informe.resumen.comprometido > 0) {
    filasResumen.push([
      "Compromisos del período (no restados)",
      fmt(informe.resumen.comprometido),
      GRIS,
    ]);
  }

  hijos.push(
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: filasResumen.map(
        ([etiqueta, valor, color]) =>
          new TableRow({
            children: [
              celda(etiqueta, { ancho: 70 }),
              celda(valor, { negrita: true, color, derecha: true, ancho: 30 }),
            ],
          }),
      ),
    }),
  );

  hijos.push(
    new Paragraph({
      spacing: { before: 140 },
      children: [
        new TextRun({
          text: `${informe.resumen.movimientos} movimientos considerados`,
          color: GRIS,
          size: 18,
        }),
      ],
    }),
  );

  // ---------- Por destino ----------
  if (informe.destinos.length > 0) {
    hijos.push(seccion("En qué se fue"));
    hijos.push(
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
          encabezado(["Destino", "% del total", "Total"], [50, 20, 30]),
          ...informe.destinos.map(
            (d) =>
              new TableRow({
                children: [
                  celda(d.etiqueta, { ancho: 50 }),
                  celda(`${d.porcentaje}%`, { color: GRIS, ancho: 20 }),
                  celda(fmt(d.total), { negrita: true, derecha: true, ancho: 30 }),
                ],
              }),
          ),
        ],
      }),
    );
  }

  // ---------- Movimientos ----------
  hijos.push(seccion("Detalle de movimientos"));

  if (informe.movimientos.length === 0) {
    hijos.push(
      new Paragraph({
        children: [
          new TextRun({
            text: "No hubo movimientos registrados en este período.",
            italics: true,
            color: GRIS,
            size: 19,
          }),
        ],
      }),
    );
  } else {
    hijos.push(
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
          encabezado(["Fecha", "Descripción", "Monto"], [16, 59, 25]),
          ...informe.movimientos.map((m) => {
            const esIngreso = m.tipo === "ingreso";
            const esCompromiso = m.tipo === "compromiso";

            // El compromiso va sin signo y en gris: la plata todavía no salió
            // de la cuenta, y un "-" acá contradice al resumen de arriba, que
            // dice explícitamente que no está restado del resultado.
            const signo = esCompromiso ? "" : esIngreso ? "+" : "-";

            return new TableRow({
              children: [
                celda(m.fecha, { color: GRIS, ancho: 16 }),
                celda(
                  (m.descripcion ?? "(sin descripción)") + (esCompromiso ? "  (compromiso)" : ""),
                  { ancho: 59 },
                ),
                celda(`${signo}${fmt(m.monto)}`, {
                  negrita: !esCompromiso,
                  color: esCompromiso ? GRIS : esIngreso ? VERDE : undefined,
                  derecha: true,
                  ancho: 25,
                }),
              ],
            });
          }),
        ],
      }),
    );
  }

  // ---------- Deudas ----------
  if (informe.deudas.length > 0) {
    hijos.push(seccion("Deudas declaradas"));
    hijos.push(
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
          encabezado(["Acreedor", "Estado", "Saldo declarado"], [45, 25, 30]),
          ...informe.deudas.map(
            (d) =>
              new TableRow({
                children: [
                  celda(`${d.acreedor} (${d.tipo})`, { ancho: 45 }),
                  celda(`${d.estado.replace(/_/g, " ")} · ${d.saldo_declarado_el}`, {
                    color: GRIS,
                    ancho: 25,
                  }),
                  celda(fmt(d.saldo_declarado, d.moneda), { negrita: true, derecha: true, ancho: 30 }),
                ],
              }),
          ),
        ],
      }),
    );
    hijos.push(
      new Paragraph({
        spacing: { before: 120 },
        children: [
          new TextRun({
            text: "Los saldos son los que declaraste vos. EOS no ve los pagos a estas deudas salvo que lleguen por correo.",
            italics: true,
            color: GRIS,
            size: 17,
          }),
        ],
      }),
    );
  }

  // ---------- Advertencias ----------
  if (informe.advertencias.length > 0) {
    hijos.push(seccion("Lo que este informe no incluye"));
    for (const aviso of informe.advertencias) {
      hijos.push(
        new Paragraph({
          bullet: { level: 0 },
          spacing: { after: 90 },
          children: [new TextRun({ text: aviso, color: GRIS, size: 18 })],
        }),
      );
    }
  }

  const documento = new Document({
    creator: "TransTech EOS",
    title: `${informe.titulo} — ${informe.periodo.etiqueta}`,
    sections: [{ properties: {}, children: hijos }],
  });

  return Packer.toBuffer(documento);
}
