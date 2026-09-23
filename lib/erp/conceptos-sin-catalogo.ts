/**
 * Lo que se compró y todavía no está en el catálogo.
 *
 * Una compra se puede registrar con un concepto escrito a mano ("Lechón",
 * "Balanceado"): no toca el catálogo ni el stock, porque ese texto no es un
 * producto. Quien empieza así se encuentra después con Productos vacío y con
 * la sensación de que lo cargado se perdió.
 *
 * Esto junta esos renglones sueltos por nombre —"Lechón" y "lechon" son lo
 * mismo— para poder ofrecerlos como producto con lo que ya se sabe (el costo
 * y cuánto se compró) y pidiendo solo lo que falta: el precio de venta.
 */

export type RenglonSuelto = {
  producto_id: string | null;
  descripcion: string;
  cantidad: number;
  precio_unitario: number;
  iva: number;
};

export type CompraParaCatalogo = {
  estado?: string | null;
  moneda: string;
  items?: RenglonSuelto[];
};

export type ConceptoSinCatalogo = {
  /** Clave normalizada: la misma para "Lechón" y "lechon ". */
  clave: string;
  nombre: string;
  /** Lo que se compró en total, sumando todas las compras vigentes. */
  cantidad: number;
  /** El costo de la compra más reciente. */
  costo: number;
  iva: 0 | 5 | 10;
  moneda: string;
};

export function claveDeConcepto(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * `compras` viene de la más nueva a la más vieja, como la devuelve la API: el
 * primer renglón de cada concepto es el de la compra más reciente.
 * Las anuladas no cuentan: lo que se anuló no se compró.
 */
export function conceptosSinCatalogo(
  compras: CompraParaCatalogo[],
  nombresDelCatalogo: string[],
): ConceptoSinCatalogo[] {
  const yaEstan = new Set(nombresDelCatalogo.map(claveDeConcepto));
  const grupos = new Map<string, ConceptoSinCatalogo>();

  for (const compra of compras) {
    if (compra.estado === "anulada") continue;

    for (const item of compra.items ?? []) {
      if (item.producto_id) continue;

      const clave = claveDeConcepto(item.descripcion ?? "");
      if (!clave || yaEstan.has(clave)) continue;

      const cantidad = Number(item.cantidad) || 0;
      const previo = grupos.get(clave);

      if (previo) {
        previo.cantidad += cantidad;
        continue;
      }

      const iva = Number(item.iva);

      grupos.set(clave, {
        clave,
        nombre: item.descripcion.trim(),
        cantidad,
        costo: Number(item.precio_unitario) || 0,
        iva: iva === 5 || iva === 10 ? iva : 0,
        moneda: compra.moneda,
      });
    }
  }

  return [...grupos.values()];
}
