import { calcularVenta, tasaValida, type LineaVenta } from "../erp/impuestos.ts";
import type { Documento } from "../documentos/especificacion.ts";

/**
 * El papel que se lleva el cliente.
 *
 * ============================================================
 * POR QUÉ NO ES UN RENDERIZADOR NUEVO
 * ============================================================
 *
 * Devuelve un `Documento` de `lib/documentos`, la misma descripción que usa
 * EOS para cualquier archivo a pedido. Así el comprobante sale en PDF, Word o
 * Excel sin escribir nada más, y el día que mejore el renderizador —un corte de
 * página, una columna mejor alineada— mejoran también los comprobantes viejos,
 * porque se dibujan de nuevo en cada descarga.
 *
 * ============================================================
 * LO QUE ESTE PAPEL DICE DE SÍ MISMO
 * ============================================================
 *
 * Mientras el documento no esté firmado y aprobado por SIFEN, el comprobante
 * sale rotulado como lo que es. No es prolijidad legal: un comprobante que se
 * presenta como factura electrónica sin serlo es un problema tributario para
 * quien lo entrega, y el que lo entrega confía en que el sistema no le mienta.
 */

type Fila = Record<string, unknown>;

function texto(valor: unknown): string {
  return String(valor ?? "").trim();
}

function numero(valor: unknown): number {
  const n = Number(valor);
  return Number.isFinite(n) ? n : 0;
}

/** "80174259-5", que es como se escribe un RUC acá. */
function rucCompleto(ruc: unknown, dv: unknown): string {
  const base = texto(ruc);
  if (!base) return "";

  const digito = texto(dv);
  return digito ? `${base}-${digito}` : base;
}

export function armarComprobante(datos: {
  config: Fila;
  venta: Fila;
  cdc: string;
  numero: string;
  fechaEmision: string;
  esBorrador: boolean;
}): Documento {
  const { config, venta } = datos;

  const contacto = (venta.contacto ?? null) as Fila | null;
  const crudos = Array.isArray(venta.items) ? (venta.items as Fila[]) : [];

  const items: LineaVenta[] = [...crudos]
    .sort((a, b) => numero(a.orden) - numero(b.orden))
    .map((i) => ({
      descripcion: texto(i.descripcion) || "Ítem",
      cantidad: numero(i.cantidad),
      precio_unitario: numero(i.precio_unitario),
      iva: tasaValida(i.iva),
    }));

  // Se recalcula en vez de leer los totales guardados: si alguna vez no
  // coinciden, el que vale es el que sale de las líneas que están impresas
  // arriba. Un papel donde el total no es la suma de sus líneas no lo firma
  // nadie.
  const totales = calcularVenta(items);
  const moneda = texto(venta.moneda) || "PYG";

  const emisor = texto(config.razon_social);
  const fantasia = texto(config.nombre_fantasia);

  const bloques: Documento["bloques"] = [
    {
      tipo: "indicadores",
      items: [
        { etiqueta: "Número", valor: datos.numero },
        { etiqueta: "Fecha", valor: datos.fechaEmision },
        {
          etiqueta: "Total",
          valor: new Intl.NumberFormat("es-PY", { maximumFractionDigits: 0 }).format(totales.total),
          detalle: moneda,
        },
      ],
    },
    {
      tipo: "tabla",
      titulo: "Emisor",
      columnas: [
        { titulo: "Dato", tipo: "texto" },
        { titulo: "Valor", tipo: "texto" },
      ],
      filas: [
        ["Razón social", emisor || "—"],
        ...(fantasia ? [["Nombre de fantasía", fantasia]] : []),
        ["RUC", rucCompleto(config.ruc, config.ruc_dv) || "—"],
        ["Timbrado", texto(config.timbrado_numero) || "—"],
        [
          "Vigencia del timbrado",
          [texto(config.timbrado_inicio), texto(config.timbrado_fin)].filter(Boolean).join(" al ") ||
            "—",
        ],
        ["Dirección", [texto(config.direccion), texto(config.numero_casa)].filter(Boolean).join(" ") || "—"],
        ["Teléfono", texto(config.telefono) || "—"],
      ],
    },
    {
      tipo: "tabla",
      titulo: "Cliente",
      columnas: [
        { titulo: "Dato", tipo: "texto" },
        { titulo: "Valor", tipo: "texto" },
      ],
      filas: [
        ["Nombre", texto(contacto?.nombre) || "Consumidor final"],
        ["RUC", rucCompleto(contacto?.ruc, contacto?.ruc_dv) || "—"],
        ["Dirección", texto(contacto?.direccion) || "—"],
        ["Condición de venta", texto(venta.condicion) === "credito" ? "Crédito" : "Contado"],
      ],
    },
    {
      tipo: "tabla",
      titulo: "Detalle",
      columnas: [
        { titulo: "Descripción", tipo: "texto" },
        { titulo: "Cant.", tipo: "numero" },
        { titulo: "Precio unit.", tipo: "dinero", moneda },
        { titulo: "IVA", tipo: "numero" },
        { titulo: "Total", tipo: "dinero", moneda, total: true },
      ],
      filas: totales.lineas.map((l) => [
        l.descripcion,
        l.cantidad,
        l.precio_unitario,
        l.iva,
        l.total,
      ]),
    },
    {
      tipo: "tabla",
      titulo: "Liquidación del IVA",
      columnas: [
        { titulo: "Tasa", tipo: "texto" },
        { titulo: "Gravado", tipo: "dinero", moneda },
        { titulo: "IVA", tipo: "dinero", moneda, total: true },
      ],
      // El desglose por tasa es lo que pide el pie de una factura paraguaya, y
      // es lo primero que mira un contador.
      filas: totales.por_tasa.map((t) => [
        t.tasa === 0 ? "Exenta" : `${t.tasa}%`,
        t.gravado,
        t.iva,
      ]),
    },
    {
      tipo: "parrafo",
      texto: `Código de control (CDC): ${datos.cdc}`,
    },
  ];

  if (datos.esBorrador) {
    bloques.push({
      tipo: "nota",
      texto:
        "Este comprobante tiene número y código de control, pero todavía no fue firmado " +
        "digitalmente ni enviado a SIFEN. No reemplaza a una factura electrónica aprobada " +
        "por la SET.",
    });
  }

  return {
    titulo: datos.esBorrador ? "Comprobante de venta (borrador)" : "Factura electrónica",
    subtitulo: [emisor, datos.numero].filter(Boolean).join(" · "),
    moneda,
    generadoEl: datos.fechaEmision,
    bloques,
  };
}
