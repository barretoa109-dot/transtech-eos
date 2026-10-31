import { formatearMonto } from "../finanzas/formato.ts";
import type { adminSinTipos } from "../supabase/sin-tipos.ts";

/**
 * El detalle de las compras ya cargadas, para cuando EOS arma un documento.
 *
 * Caso real, 31/10/2026: al pedir un Excel del negocio, EOS le preguntaba a
 * la persona cuánto había pagado por cada lechón y si hubo flete — datos que
 * ya estaban en Compras y gastos. El contexto que viaja en CADA mensaje
 * (`eos_contexto_negocio`) solo trae totales del mes: ponerle el detalle
 * línea por línea ahí encarecería y alargaría toda conversación, no solo la
 * que arma un documento. Por eso esto se pide aparte, solo cuando
 * `procesar-mensaje.ts` ve `eleccion.motivo === "documento"`.
 */

export type ClienteComprasRecientes = ReturnType<typeof adminSinTipos>;

type ItemCompra = {
  descripcion?: unknown;
  cantidad?: unknown;
  precio_unitario?: unknown;
  total?: unknown;
};

type FilaCompra = {
  fecha?: unknown;
  proveedor?: unknown;
  moneda?: unknown;
  total?: unknown;
  items?: unknown;
};

function textoItem(item: ItemCompra, moneda: string): string {
  const descripcion = typeof item.descripcion === "string" ? item.descripcion : "ítem";
  const cantidad = Number(item.cantidad ?? 1);
  const precio = Number(item.precio_unitario ?? item.total ?? 0);
  const cantidadTexto = cantidad !== 1 ? `${cantidad} × ` : "";
  return `${cantidadTexto}${descripcion} (${formatearMonto(precio, moneda)} c/u)`;
}

function textoFila(fila: FilaCompra): string | null {
  const fecha = typeof fila.fecha === "string" ? fila.fecha : "";
  if (!fecha) return null;

  const moneda = typeof fila.moneda === "string" && fila.moneda ? fila.moneda : "PYG";
  const proveedor = typeof fila.proveedor === "string" && fila.proveedor ? fila.proveedor : "sin proveedor";
  const total = formatearMonto(Number(fila.total ?? 0), moneda);

  const items = Array.isArray(fila.items) ? fila.items : [];
  const detalle = items.length > 0
    ? items.map((i) => textoItem(i as ItemCompra, moneda)).join(", ")
    : "(sin ítems detallados)";

  return `- ${fecha} · ${proveedor} · ${total} · ${detalle}`;
}

/**
 * Vacío si no hay compras, si el negocio no usa el módulo ERP, o si la
 * consulta falla: un documento sin este contexto sigue sirviendo, solo
 * vuelve a preguntar lo que ya estaba cargado, que es el problema que esto
 * mejora, no uno que pueda romper el documento si no está.
 */
export async function textoComprasRecientes(
  admin: ClienteComprasRecientes,
  usuarioId: string,
  meses = 6,
): Promise<string> {
  try {
    const { data, error } = await admin.rpc("eos_compras_recientes", {
      p_usuario_id: usuarioId,
      p_meses: meses,
    });

    if (error) {
      console.error("EOS: no se pudieron leer las compras recientes:", error);
      return "";
    }

    const filas = Array.isArray(data) ? data : [];
    const lineas = filas.map((f) => textoFila(f as FilaCompra)).filter((l): l is string => l !== null);

    if (lineas.length === 0) return "";

    return (
      `Compras y gastos del negocio YA CARGADOS (últimos ${meses} meses, de Compras y gastos). ` +
      `Usalos para el documento: NO le vuelvas a preguntar a la persona un dato que ya está acá.\n` +
      lineas.join("\n")
    );
  } catch (error) {
    console.error("EOS: error inesperado leyendo las compras recientes:", error);
    return "";
  }
}
