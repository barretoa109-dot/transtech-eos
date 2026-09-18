/**
 * Cuándo se le acaba un producto, según cómo se viene vendiendo.
 *
 * ============================================================
 * QUÉ RESPONDE, Y QUÉ NO
 * ============================================================
 *
 * `inventario_bajo` (lib/erp/riesgos-negocio.ts) avisa cuando el stock ya cayó
 * bajo el mínimo que declaró la persona. Es una foto: llega tarde para el
 * producto que se vende rápido y molesta de más con el que casi no se mueve.
 *
 * Esto mira el ritmo. Un producto con 40 unidades y mínimo 5 no dispara nada
 * ahí; pero si viene vendiendo 4 por día, se acaba en diez días, y ese es el
 * aviso útil. El que tiene 4 unidades y no vende hace un mes NO se acaba, y
 * no se lo avisa.
 *
 * ============================================================
 * CERO INVENCIÓN
 * ============================================================
 *
 *   · El ritmo sale SOLO de salidas reales del kardex de los últimos
 *     `ventanaDias` días. Nada de estacionalidad ni de tendencias supuestas.
 *
 *   · Con menos de `MIN_SALIDAS` movimientos no hay ritmo que afirmar: un
 *     producto que se vendió una sola vez el mes pasado no tiene "ritmo".
 *     Se calla en vez de proyectar sobre un punto.
 *
 *   · Se divide por la ventana ENTERA y no por los días desde la primera
 *     venta. Es la elección conservadora: un producto nuevo se ve más lento
 *     de lo que va y se avisa un poco más tarde, en vez de gritar "se acaba"
 *     por dos ventas del primer día.
 *
 *   · Lo que ya está en o bajo el mínimo NO entra: eso es `inventario_bajo`, y
 *     dos avisos por el mismo producto son ruido.
 *
 * Todo lo que necesita entra por parámetro: no lee la base, no mira la hora.
 */

export type ProductoAgotable = {
  id: string;
  nombre: string;
  stock_actual: number;
  stock_minimo: number;
  controla_stock: boolean;
  activo: boolean;
};

/** Una salida del kardex: cantidad positiva, como se guarda. */
export type SalidaDeStock = {
  producto_id: string;
  fecha: string;
  cantidad: number;
};

export type ProyeccionStock = {
  id: string;
  nombre: string;
  stock: number;
  /** Unidades por día, sobre la ventana entera. */
  ritmo_diario: number;
  /** Días que alcanza al ritmo actual, redondeado y nunca menos de 1. */
  dias_restantes: number;
};

/** Cuánta historia mira. Un mes: alcanza para ver un ritmo sin arrastrar el del trimestre pasado. */
export const VENTANA_DIAS = 30;

/** A cuántos días de acabarse es una noticia. Dos semanas: lo que tarda en llegar una reposición razonable. */
export const HORIZONTE_DIAS = 14;

/** Movimientos mínimos para hablar de ritmo. */
export const MIN_SALIDAS = 3;

function diasEntre(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

export function proyectarAgotamiento(datos: {
  hoy: string;
  productos: ProductoAgotable[];
  salidas: SalidaDeStock[];
  ventanaDias?: number;
  horizonteDias?: number;
}): ProyeccionStock[] {
  const ventana = datos.ventanaDias ?? VENTANA_DIAS;
  const horizonte = datos.horizonteDias ?? HORIZONTE_DIAS;

  const porProducto = new Map<string, { unidades: number; movimientos: number }>();

  for (const s of datos.salidas) {
    const fecha = String(s.fecha ?? "").slice(0, 10);
    const cantidad = Number(s.cantidad);
    if (!fecha || !Number.isFinite(cantidad) || cantidad <= 0) continue;

    const atras = diasEntre(fecha, datos.hoy);
    // Fuera de la ventana, o del futuro: no cuenta.
    if (atras < 0 || atras >= ventana) continue;

    const acc = porProducto.get(s.producto_id) ?? { unidades: 0, movimientos: 0 };
    acc.unidades += cantidad;
    acc.movimientos += 1;
    porProducto.set(s.producto_id, acc);
  }

  const proyecciones: ProyeccionStock[] = [];

  for (const p of datos.productos) {
    if (!p.controla_stock || !p.activo) continue;

    // Ya en o bajo el mínimo: lo cubre `inventario_bajo`.
    if (p.stock_actual <= p.stock_minimo) continue;
    if (p.stock_actual <= 0) continue;

    const acc = porProducto.get(p.id);
    if (!acc || acc.movimientos < MIN_SALIDAS) continue;

    const ritmo = acc.unidades / ventana;
    if (ritmo <= 0) continue;

    const dias = Math.max(1, Math.round(p.stock_actual / ritmo));
    if (dias > horizonte) continue;

    proyecciones.push({
      id: p.id,
      nombre: p.nombre,
      stock: p.stock_actual,
      ritmo_diario: Math.round(ritmo * 100) / 100,
      dias_restantes: dias,
    });
  }

  // Lo más urgente primero; el id desempata para que el orden sea estable.
  return proyecciones.sort(
    (a, b) => a.dias_restantes - b.dias_restantes || a.id.localeCompare(b.id),
  );
}
