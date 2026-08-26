import PDFDocument from "pdfkit";

import type { Informe } from "./armar.ts";

/**
 * El informe, en PDF.
 *
 * Es el formato para imprimir o mandar: nadie edita un PDF, y por eso es el
 * que se le pasa a un contador o a un banco. Se arma con pdfkit, sin navegador
 * headless, porque un Chromium en el servidor para dibujar una tabla es
 * kilómetros de infraestructura para lo que acá son veinte líneas.
 *
 * ============================================================
 * POR QUÉ ACÁ DICE "Gs." Y EN LA PANTALLA "₲"
 * ============================================================
 *
 * Las fuentes base de PDF (Helvetica y compañía) usan WinAnsi, que **no tiene
 * el signo del guaraní** (U+20B2). Escribirlo saldría como un cuadrito o como
 * otra letra. Las salidas son dos: embeber una tipografía completa —un binario
 * de cientos de kilobytes en el repo, para un glifo— o usar "Gs.", que es
 * exactamente como se escribe en las facturas paraguayas.
 *
 * Se eligió "Gs.". No es una degradación: es la notación impresa de siempre.
 */

function plata(valor: number, moneda: string): string {
  const simbolo = moneda === "USD" ? "US$" : "Gs.";
  const numero = new Intl.NumberFormat("es-PY", { maximumFractionDigits: 0 }).format(
    Math.round(valor),
  );
  return `${simbolo} ${numero}`;
}

const AZUL = "#113f8c";
const GRIS = "#6b7280";
const LINEA = "#e5e7eb";
const VERDE = "#0f7a5f";
const ROJO = "#c02626";

const MARGEN = 48;

export function crearPdfInforme(informe: Informe): Promise<Buffer> {
  return new Promise((resolver, rechazar) => {
    const doc = new PDFDocument({
      size: "A4",
      margin: MARGEN,
      info: {
        Title: `${informe.titulo} — ${informe.periodo.etiqueta}`,
        Author: "TransTech EOS",
      },
    });

    const trozos: Buffer[] = [];
    doc.on("data", (t: Buffer) => trozos.push(t));
    doc.on("end", () => resolver(Buffer.concat(trozos)));
    doc.on("error", rechazar);

    const ancho = doc.page.width - MARGEN * 2;
    const derecha = doc.page.width - MARGEN;

    // ---------- Encabezado ----------
    doc.fillColor(AZUL).font("Helvetica-Bold").fontSize(20).text(informe.titulo, MARGEN, MARGEN);
    doc
      .fillColor(GRIS)
      .font("Helvetica")
      .fontSize(10)
      .text(`${informe.periodo.etiqueta}`, { continued: false });
    doc.fontSize(8.5).text(`TransTech EOS · generado el ${informe.generadoEl}`);

    doc.moveDown(1);
    linea(doc, ancho);
    doc.moveDown(1);

    // ---------- Resumen ----------
    seccion(doc, "Resumen del período");

    const filas: [string, number, string | null][] = [
      ["Ingresos", informe.resumen.ingresos, VERDE],
      ["Gastos", informe.resumen.gastos, ROJO],
      ["Resultado", informe.resumen.neto, informe.resumen.neto >= 0 ? VERDE : ROJO],
    ];

    if (informe.resumen.comprometido > 0) {
      filas.push(["Compromisos del período (no restados)", informe.resumen.comprometido, null]);
    }

    for (const [etiqueta, valor, color] of filas) {
      const y = doc.y;
      doc.fillColor("#07132a").font("Helvetica").fontSize(11).text(etiqueta, MARGEN, y);
      doc
        .fillColor(color ?? "#07132a")
        .font("Helvetica-Bold")
        .text(plata(valor, informe.moneda), MARGEN, y, { width: ancho, align: "right" });
      doc.moveDown(0.45);
    }

    doc.moveDown(0.4);
    doc
      .fillColor(GRIS)
      .font("Helvetica")
      .fontSize(9)
      .text(`${informe.resumen.movimientos} movimientos considerados`, MARGEN, doc.y);

    // ---------- Por destino ----------
    if (informe.destinos.length > 0) {
      doc.moveDown(1.4);
      seccion(doc, "En qué se fue");

      for (const d of informe.destinos) {
        const y = doc.y;
        doc.fillColor("#07132a").font("Helvetica").fontSize(10.5).text(d.etiqueta, MARGEN, y);
        doc
          .fillColor(GRIS)
          .fontSize(9)
          .text(`${d.porcentaje}%`, MARGEN, y, { width: ancho - 110, align: "right" });
        doc
          .fillColor("#07132a")
          .font("Helvetica-Bold")
          .fontSize(10.5)
          .text(plata(d.total, informe.moneda), MARGEN, y, { width: ancho, align: "right" });

        // Barra proporcional: en papel, dos rubros con cifras parecidas se
        // distinguen mucho antes por el largo de la barra que por el número.
        const yBarra = doc.y + 3;
        doc.rect(MARGEN, yBarra, ancho, 3).fill(LINEA);
        doc.rect(MARGEN, yBarra, (ancho * d.porcentaje) / 100, 3).fill(AZUL);
        doc.y = yBarra + 11;
      }
    }

    // ---------- Movimientos ----------
    doc.addPage();
    seccion(doc, "Detalle de movimientos");
    doc.moveDown(0.3);

    const colFecha = MARGEN;
    const colDesc = MARGEN + 68;
    const anchoDesc = ancho - 68 - 95;

    cabeceraTabla(doc, ["Fecha", "Descripción", "Monto"], [colFecha, colDesc, derecha - 95], [60, anchoDesc, 95]);

    if (informe.movimientos.length === 0) {
      doc
        .fillColor(GRIS)
        .font("Helvetica-Oblique")
        .fontSize(10)
        .text("No hubo movimientos registrados en este período.", MARGEN, doc.y + 6);
    }

    for (const m of informe.movimientos) {
      // Salto de página con la cabecera repetida: una tabla que sigue en la
      // hoja siguiente sin encabezados obliga a volver atrás para leerla.
      if (doc.y > doc.page.height - MARGEN - 40) {
        doc.addPage();
        cabeceraTabla(doc, ["Fecha", "Descripción", "Monto"], [colFecha, colDesc, derecha - 95], [60, anchoDesc, 95]);
      }

      const y = doc.y;
      const esIngreso = m.tipo === "ingreso";
      const esCompromiso = m.tipo === "compromiso";

      doc.fillColor(GRIS).font("Helvetica").fontSize(9).text(m.fecha, colFecha, y, { width: 62 });
      doc
        .fillColor("#07132a")
        .fontSize(9.5)
        .text(
          // El compromiso se rotula en la misma línea: sin eso, un renglón con
          // cifra en gris se lee como un gasto cualquiera mal impreso.
          (m.descripcion ?? "(sin descripción)") + (esCompromiso ? "  (compromiso)" : ""),
          colDesc,
          y,
          { width: anchoDesc, ellipsis: true, height: 12 },
        );

      // Sin signo cuando es compromiso: la plata todavía no se movió, y un
      // "-" ahí contradice al resumen, que dice que no está restado.
      const signo = esCompromiso ? "" : esIngreso ? "+" : "-";

      doc
        .fillColor(esCompromiso ? GRIS : esIngreso ? VERDE : "#07132a")
        .font(esCompromiso ? "Helvetica" : "Helvetica-Bold")
        .fontSize(9.5)
        .text(`${signo}${plata(m.monto, informe.moneda)}`, derecha - 95, y, {
          width: 95,
          align: "right",
        });

      doc.y = y + 15;
    }

    // ---------- Deudas ----------
    if (informe.deudas.length > 0) {
      doc.addPage();
      seccion(doc, "Deudas declaradas");
      doc.moveDown(0.3);

      for (const d of informe.deudas) {
        const y = doc.y;
        doc.fillColor("#07132a").font("Helvetica-Bold").fontSize(11).text(d.acreedor, MARGEN, y);
        doc
          .font("Helvetica-Bold")
          .text(plata(d.saldo_declarado, d.moneda), MARGEN, y, { width: ancho, align: "right" });
        doc
          .fillColor(GRIS)
          .font("Helvetica")
          .fontSize(9)
          .text(
            `${d.tipo} · ${d.estado.replace(/_/g, " ")} · declarado el ${d.saldo_declarado_el}` +
              (d.cuota_monto !== null ? ` · cuota ${plata(d.cuota_monto, d.moneda)}` : ""),
            MARGEN,
            doc.y + 1,
          );
        doc.moveDown(0.9);
      }
    }

    // ---------- Advertencias ----------
    // Van al final y en su propio recuadro, pero SIEMPRE van. Un balance que
    // se presenta como completo sin serlo es peor que no tener balance.
    if (informe.advertencias.length > 0) {
      doc.moveDown(1.2);
      if (doc.y > doc.page.height - MARGEN - 140) doc.addPage();

      const yCaja = doc.y;
      seccion(doc, "Lo que este informe no incluye");
      doc.moveDown(0.2);

      for (const aviso of informe.advertencias) {
        doc.fillColor(GRIS).font("Helvetica").fontSize(9).text(`•  ${aviso}`, MARGEN + 4, doc.y, {
          width: ancho - 8,
          align: "left",
        });
        doc.moveDown(0.35);
      }

      doc
        .rect(MARGEN - 6, yCaja - 6, ancho + 12, doc.y - yCaja + 10)
        .lineWidth(0.8)
        .stroke(LINEA);
    }

    doc.end();
  });
}

type Doc = InstanceType<typeof PDFDocument>;

function linea(doc: Doc, ancho: number) {
  doc
    .moveTo(MARGEN, doc.y)
    .lineTo(MARGEN + ancho, doc.y)
    .lineWidth(0.8)
    .stroke(LINEA);
}

function seccion(doc: Doc, texto: string) {
  doc.fillColor(AZUL).font("Helvetica-Bold").fontSize(12).text(texto, MARGEN, doc.y);
  doc.moveDown(0.5);
}

function cabeceraTabla(doc: Doc, textos: string[], xs: number[], anchos: number[]) {
  const y = doc.y;
  textos.forEach((t, i) => {
    doc
      .fillColor(GRIS)
      .font("Helvetica-Bold")
      .fontSize(8)
      .text(t.toUpperCase(), xs[i], y, {
        width: anchos[i],
        align: i === textos.length - 1 ? "right" : "left",
      });
  });
  doc.y = y + 12;
  doc
    .moveTo(MARGEN, doc.y)
    .lineTo(xs[xs.length - 1] + anchos[anchos.length - 1], doc.y)
    .lineWidth(0.8)
    .stroke(LINEA);
  doc.y += 6;
}
