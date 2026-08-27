/**
 * La frontera numérica de ventas y compras.
 *
 * `Number("NaN")`, `Infinity` y los negativos no pueden llegar al RPC: aunque
 * PostgreSQL revierta la transacción, rechazarlos acá permite contestar 400 y
 * evita convertir entrada inválida en un error operativo 503.
 */

export type ItemErp = {
  producto_id: string | null;
  descripcion: string | null;
  cantidad: number;
  precio_unitario: number | null;
  iva: 0 | 5 | 10 | null;
};

type ResultadoItems =
  | { ok: true; items: ItemErp[] }
  | {
      ok: false;
      motivo:
        | "sin-items"
        | "demasiados-items"
        | "item-invalido"
        | "cantidad-invalida"
        | "precio-invalido";
    };

export function normalizarItemsErp(
  valor: unknown,
  tasaValida: (valor: unknown) => 0 | 5 | 10,
  maximo = 200,
): ResultadoItems {
  if (!Array.isArray(valor) || valor.length === 0) return { ok: false, motivo: "sin-items" };
  if (valor.length > maximo) return { ok: false, motivo: "demasiados-items" };
  if (valor.some((item) => typeof item !== "object" || item === null)) {
    return { ok: false, motivo: "item-invalido" };
  }

  const crudos = valor as Record<string, unknown>[];

  const items: ItemErp[] = [];

  for (const item of crudos) {
    const cantidad = Number(item.cantidad ?? 1);
    if (!Number.isFinite(cantidad) || cantidad <= 0) {
      return { ok: false, motivo: "cantidad-invalida" };
    }

    const tienePrecio = item.precio_unitario !== undefined && item.precio_unitario !== null;
    const precio = tienePrecio ? Number(item.precio_unitario) : null;
    if (precio !== null && (!Number.isFinite(precio) || precio < 0)) {
      return { ok: false, motivo: "precio-invalido" };
    }

    items.push({
      producto_id: typeof item.producto_id === "string" ? item.producto_id : null,
      descripcion: String(item.descripcion ?? "").trim().slice(0, 300) || null,
      cantidad,
      precio_unitario: precio,
      iva: item.iva === undefined || item.iva === null ? null : tasaValida(item.iva),
    });
  }

  return { ok: true, items };
}
