import PDFDocument from "pdfkit";

import {
  esColumnaNumerica,
  formatearCelda,
  totalesDeTabla,
  type Bloque,
  type Documento,
} from "./especificacion.ts";

/**
 * Cualquier documento de EOS, en PDF.
 *
 * Es el formato para imprimir o mandar: nadie edita un PDF, y por eso es el que
 * se le pasa a un contador, a un banco o a un cliente. Se arma con pdfkit, sin
 * navegador headless, por lo mismo que `lib/informes/pdf.ts`: un Chromium en el
 * servidor para dibujar una tabla es kilómetros de infraestructura de más.
 *
 * ============================================================
 * ACÁ DICE "Gs." Y EN LA PANTALLA "₲"
 * ============================================================
 *
 * Las fuentes base del PDF (Helvetica y compañía) usan WinAnsi, que no tiene el
 * signo del guaraní (U+20B2): escribirlo saldría como un cuadrito. Por eso
 * `formatearCelda` recibe `simboloGuarani = false` en todo este archivo y sale
 * "Gs.", que es como se escribe en las facturas paraguayas de siempre.
 *
 * ============================================================
 * LO QUE HACE QUE UNA TABLA LARGA SIRVA
 * ============================================================
 *
 * El corte de página. Una tabla de trescientas filas ocupa seis carillas, y si
 * el encabezado queda solo en la primera, de la segunda en adelante el lector
 * tiene que acordarse de qué columna era cada número. Por eso `dibujarTabla`
 * repite el encabezado en cada página nueva.
 */

/**
 * El filtro que todo texto cruza antes de dibujarse.
 *
 * `formatearCelda` ya sabe escribir "Gs." en las columnas de dinero, pero el
 * resto del documento lo redacta EOS en texto libre: un indicador que diga
 * "₲ 18.400.000", un párrafo que mencione un importe. Ese ₲ no existe en
 * WinAnsi y pdfkit lo dibuja como "²" —no falla, MIENTE, que es peor—, así
 * que la conversión tiene que pasar por acá y no por quien llama.
 *
 * Lo mismo con cualquier otro carácter fuera de la codificación: se
 * transcribe a su equivalente sin acentos si lo tiene, y si no se descarta.
 * Un cuadrito perdido en un informe impreso hace dudar del resto del informe.
 */
function paraPdf(texto: string): string {
  const conGuarani = texto.replace(/₲/g, "Gs.");

  if (!/[^\u0020-\u00FF]/.test(conGuarani)) return conGuarani;

  return Array.from(conGuarani)
    .map((caracter) => {
      if (caracter.codePointAt(0)! <= 0xff) return caracter;

      // Las comillas y rayas tipográficas sí están en WinAnsi, pero arriba de
      // 0x00FF; se las deja pasar por su equivalente simple, que imprime igual
      // de bien y no depende de la tabla de códigos.
      const simples: Record<string, string> = {
        "‘": "'",
        "’": "'",
        "“": '"',
        "”": '"',
        "–": "-",
        "—": "—",
        "…": "...",
        "•": "•",
        "€": "EUR",
      };

      if (simples[caracter]) return simples[caracter];

      const sinTilde = caracter.normalize("NFKD").replace(/[^\u0020-\u00FF]/g, "");
      return sinTilde || "";
    })
    .join("");
}

const AZUL = "#113f8c";
const AZUL_CLARO = "#1656bd";
const GRIS = "#6b7280";
const LINEA = "#e5e7eb";
const AMBAR = "#b45309";
const NEGRO = "#111827";

const MARGEN = 48;

/** Alto reservado al pie: si se escribe encima, el número de página tapa datos. */
const PIE = 34;

type Contexto = {
  doc: PDFKit.PDFDocument;
  documento: Documento;
  ancho: number;
};

function nuevaPaginaSiHaceFalta(ctx: Contexto, alto: number): boolean {
  const limite = ctx.doc.page.height - MARGEN - PIE;

  if (ctx.doc.y + alto <= limite) return false;

  ctx.doc.addPage();
  return true;
}

function dibujarParrafo(ctx: Contexto, crudo: string, opciones: { nota?: boolean } = {}) {
  const { doc } = ctx;
  const texto = paraPdf(crudo);

  doc.font("Helvetica").fontSize(opciones.nota ? 9 : 10.5);

  const alto = doc.heightOfString(texto, { width: ctx.ancho });
  nuevaPaginaSiHaceFalta(ctx, Math.min(alto, 120));

  if (opciones.nota) {
    // La barra al margen es lo que hace que una advertencia se lea como
    // advertencia sin necesidad de escribir "ATENCIÓN" en mayúsculas.
    const desde = doc.y;
    doc.font("Helvetica-Oblique").fillColor(AMBAR).fontSize(9);
    doc.text(texto, MARGEN + 10, doc.y, { width: ctx.ancho - 10, align: "left" });
    doc
      .save()
      .lineWidth(2)
      .strokeColor(AMBAR)
      .moveTo(MARGEN + 2, desde)
      .lineTo(MARGEN + 2, doc.y - 2)
      .stroke()
      .restore();
  } else {
    doc.fillColor(NEGRO).text(texto, MARGEN, doc.y, { width: ctx.ancho, align: "left" });
  }

  doc.moveDown(0.7);
}

function dibujarTitulo(ctx: Contexto, crudo: string, nivel: 1 | 2 | 3) {
  const { doc } = ctx;
  const texto = paraPdf(crudo);
  const tamanio = nivel === 1 ? 15 : nivel === 2 ? 12.5 : 11;

  nuevaPaginaSiHaceFalta(ctx, tamanio * 3);

  doc.moveDown(0.4);
  doc.font("Helvetica-Bold").fontSize(tamanio).fillColor(AZUL);
  doc.text(texto, MARGEN, doc.y, { width: ctx.ancho });

  if (nivel === 1) {
    const y = doc.y + 3;
    doc.save().lineWidth(1).strokeColor(AZUL_CLARO).moveTo(MARGEN, y).lineTo(MARGEN + 60, y).stroke().restore();
    doc.y = y + 6;
  } else {
    doc.moveDown(0.35);
  }
}

function dibujarLista(ctx: Contexto, crudos: string[], ordenada: boolean) {
  const { doc } = ctx;
  const sangria = 14;
  const items = crudos.map(paraPdf);

  items.forEach((item, i) => {
    doc.font("Helvetica").fontSize(10.5).fillColor(NEGRO);

    const alto = doc.heightOfString(item, { width: ctx.ancho - sangria });
    nuevaPaginaSiHaceFalta(ctx, alto);

    const y = doc.y;
    doc.fillColor(GRIS).text(ordenada ? `${i + 1}.` : "•", MARGEN, y, { width: sangria });
    doc.fillColor(NEGRO).text(item, MARGEN + sangria, y, { width: ctx.ancho - sangria });
    doc.moveDown(0.25);
  });

  doc.moveDown(0.5);
}

function dibujarIndicadores(ctx: Contexto, items: { etiqueta: string; valor: string; detalle?: string }[]) {
  const { doc } = ctx;

  // Tres por fila entran cómodos en A4; con cuatro, un importe en guaraníes de
  // ocho cifras ya no cabe y se parte al medio.
  const porFila = items.length <= 2 ? items.length : 3;
  const anchoCaja = (ctx.ancho - (porFila - 1) * 10) / porFila;
  const altoCaja = 52;

  for (let i = 0; i < items.length; i += porFila) {
    const grupo = items.slice(i, i + porFila);
    nuevaPaginaSiHaceFalta(ctx, altoCaja + 8);

    const y = doc.y;

    grupo.forEach((indicador, j) => {
      const x = MARGEN + j * (anchoCaja + 10);

      doc.save().roundedRect(x, y, anchoCaja, altoCaja, 6).fillColor("#f7f9fc").fill().restore();
      doc
        .save()
        .roundedRect(x, y, anchoCaja, altoCaja, 6)
        .lineWidth(0.7)
        .strokeColor(LINEA)
        .stroke()
        .restore();

      doc.font("Helvetica").fontSize(8).fillColor(GRIS);
      doc.text(paraPdf(indicador.etiqueta).toUpperCase(), x + 10, y + 9, {
        width: anchoCaja - 20,
        ellipsis: true,
      });

      doc.font("Helvetica-Bold").fontSize(14).fillColor(AZUL);
      doc.text(paraPdf(indicador.valor), x + 10, y + 21, { width: anchoCaja - 20, ellipsis: true });

      if (indicador.detalle) {
        doc.font("Helvetica").fontSize(7.5).fillColor(GRIS);
        doc.text(paraPdf(indicador.detalle), x + 10, y + 39, {
          width: anchoCaja - 20,
          ellipsis: true,
        });
      }
    });

    doc.y = y + altoCaja + 10;
  }
}

function dibujarTabla(ctx: Contexto, bloque: Extract<Bloque, { tipo: "tabla" }>) {
  const { doc, documento } = ctx;
  const { columnas, filas } = bloque;

  if (bloque.titulo) dibujarTitulo(ctx, bloque.titulo, 2);

  // El reparto del ancho: las columnas de texto piden más que las de números,
  // porque un importe mide lo que mide y una descripción se corta fea.
  const pesos = columnas.map((c) => (esColumnaNumerica(c) ? 1 : c.tipo === "fecha" ? 0.9 : 1.9));
  const suma = pesos.reduce((t, p) => t + p, 0);
  const anchos = pesos.map((p) => (p / suma) * ctx.ancho);
  const x = (i: number) => MARGEN + anchos.slice(0, i).reduce((t, a) => t + a, 0);

  const textos = filas.map((fila) =>
    columnas.map((columna, i) => paraPdf(formatearCelda(fila[i], columna, documento.moneda, false))),
  );

  function encabezado() {
    const y = doc.y;
    doc.save().rect(MARGEN, y, ctx.ancho, 18).fillColor(AZUL_CLARO).fill().restore();

    doc.font("Helvetica-Bold").fontSize(8.5).fillColor("#ffffff");
    columnas.forEach((columna, i) => {
      doc.text(paraPdf(columna.titulo), x(i) + 5, y + 5.5, {
        width: anchos[i] - 10,
        align: esColumnaNumerica(columna) ? "right" : "left",
        ellipsis: true,
      });
    });

    doc.y = y + 18;
  }

  nuevaPaginaSiHaceFalta(ctx, 60);
  encabezado();

  doc.font("Helvetica").fontSize(8.5);

  textos.forEach((fila, indice) => {
    const alto = Math.max(
      14,
      ...fila.map((texto, i) =>
        doc.heightOfString(texto, { width: anchos[i] - 10 }),
      ),
    ) + 5;

    // Repetir el encabezado en la página nueva: ver el comentario de arriba.
    if (nuevaPaginaSiHaceFalta(ctx, alto)) encabezado();

    const y = doc.y;

    if (indice % 2 === 1) {
      doc.save().rect(MARGEN, y, ctx.ancho, alto).fillColor("#fafbfd").fill().restore();
    }

    doc.font("Helvetica").fontSize(8.5).fillColor(NEGRO);
    fila.forEach((texto, i) => {
      doc.text(texto, x(i) + 5, y + 3, {
        width: anchos[i] - 10,
        align: esColumnaNumerica(columnas[i]) ? "right" : "left",
        ellipsis: true,
      });
    });

    doc
      .save()
      .lineWidth(0.4)
      .strokeColor(LINEA)
      .moveTo(MARGEN, y + alto)
      .lineTo(MARGEN + ctx.ancho, y + alto)
      .stroke()
      .restore();

    doc.y = y + alto;
  });

  const totales = totalesDeTabla(bloque);
  if (totales) {
    if (nuevaPaginaSiHaceFalta(ctx, 22)) encabezado();

    const y = doc.y;
    doc.save().rect(MARGEN, y, ctx.ancho, 18).fillColor("#eef3fb").fill().restore();

    doc.font("Helvetica-Bold").fontSize(9).fillColor(AZUL);
    columnas.forEach((columna, i) => {
      const total = totales[i];
      const texto =
        total === null
          ? i === 0
            ? "Total"
            : ""
          : formatearCelda(total, columna, documento.moneda, false);

      doc.text(texto, x(i) + 5, y + 5, {
        width: anchos[i] - 10,
        align: esColumnaNumerica(columna) ? "right" : "left",
        ellipsis: true,
      });
    });

    doc.y = y + 18;
  }

  doc.moveDown(1);
}

export function crearPdfDocumento(documento: Documento): Promise<Buffer> {
  return new Promise((resolver, rechazar) => {
    const doc = new PDFDocument({
      size: "A4",
      margin: MARGEN,
      bufferPages: true,
      info: { Title: documento.titulo, Author: "TransTech EOS" },
    });

    const trozos: Buffer[] = [];
    doc.on("data", (t: Buffer) => trozos.push(t));
    doc.on("end", () => resolver(Buffer.concat(trozos)));
    doc.on("error", rechazar);

    const ctx: Contexto = { doc, documento, ancho: doc.page.width - MARGEN * 2 };

    doc
      .fillColor(AZUL)
      .font("Helvetica-Bold")
      .fontSize(20)
      .text(paraPdf(documento.titulo), MARGEN, MARGEN, { width: ctx.ancho });

    if (documento.subtitulo) {
      doc
        .fillColor(GRIS)
        .font("Helvetica")
        .fontSize(10)
        .text(paraPdf(documento.subtitulo), { width: ctx.ancho });
    }

    doc
      .fillColor(GRIS)
      .font("Helvetica")
      .fontSize(8.5)
      .text(`TransTech EOS · generado el ${documento.generadoEl}`, { width: ctx.ancho });

    doc.moveDown(1);

    for (const bloque of documento.bloques) {
      if (bloque.tipo === "titulo") dibujarTitulo(ctx, bloque.texto, bloque.nivel);
      else if (bloque.tipo === "parrafo") dibujarParrafo(ctx, bloque.texto);
      else if (bloque.tipo === "nota") dibujarParrafo(ctx, bloque.texto, { nota: true });
      else if (bloque.tipo === "lista") dibujarLista(ctx, bloque.items, bloque.ordenada);
      else if (bloque.tipo === "indicadores") dibujarIndicadores(ctx, bloque.items);
      else if (bloque.tipo === "tabla") dibujarTabla(ctx, bloque);
    }

    // El pie va al final y sobre todas las páginas: "3 de 7" es lo que permite
    // darse cuenta de que faltan hojas cuando el archivo se imprime.
    const rango = doc.bufferedPageRange();
    for (let i = 0; i < rango.count; i++) {
      doc.switchToPage(rango.start + i);

      // Sin esto, escribir el pie DEBAJO del margen inferior hace que pdfkit
      // crea que se acabó la página y agregue otra: el documento termina con el
      // doble de carillas, una de ellas vacía salvo por el número. Anular el
      // margen es el modo estándar de escribir en esa franja.
      doc.page.margins.bottom = 0;

      doc
        .font("Helvetica")
        .fontSize(8)
        .fillColor(GRIS)
        .text(
          `${paraPdf(documento.titulo)} · ${i + 1} de ${rango.count}`,
          MARGEN,
          doc.page.height - MARGEN + 4,
          { width: ctx.ancho, align: "center", lineBreak: false },
        );
    }

    doc.end();
  });
}
