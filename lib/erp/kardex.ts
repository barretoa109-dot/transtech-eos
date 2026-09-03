/**
 * Los números del inventario: cuánto vale, cuánto rota, qué no se mueve.
 *
 * ============================================================
 * POR QUÉ ESTO NO SE PODÍA CALCULAR ANTES
 * ============================================================
 *
 * `lib/erp/indicadores.ts` lo decía en `loQueFalta()`: "Rotación de inventario
 * necesita el stock valorizado al inicio y al final del período. Hoy el stock
 * es un saldo del momento, sin historia."
 *
 * La v108 agregó el valor a cada movimiento del kardex, así que ahora sí hay
 * con qué. Todo lo de acá es puro: recibe filas ya leídas.
 *
 * ============================================================
 * LA ROTACIÓN NECESITA COSTO, NO PRECIO
 * ============================================================
 *
 * Rotación = costo de lo vendido / inventario promedio. Con el PRECIO de venta
 * arriba y el COSTO abajo, el número sale inflado por todo el margen y deja de
 * significar "cuántas veces se dio vuelta el stock". Es el error más común de
 * este indicador, y por eso `costoDeLoVendido` se pide aparte y explícito.
 */

export type MovimientoKardex = {
  fecha: string;
  tipo: "entrada" | "salida" | "ajuste";
  cantidad: number;
  /** Con IVA incluido, si se conoce. */
  costo_unitario: number | null;
  /** Cuánto valía el stock del producto después de este movimiento. */
  valor_resultante: number | null;
  producto_id: string;
  moneda: string;
};

export type ProductoStock = {
  id: string;
  nombre: string;
  moneda: string;
  stock_actual: number;
  /** El promedio ponderado (v108). Null cuando nunca entró con costo. */
  costo_promedio: number | null;
  activo: boolean;
  controla_stock: boolean;
};

/**
 * El valor del inventario hoy, por moneda.
 *
 * `sin_costo` no es un detalle: un inventario de cien productos donde ochenta
 * no tienen costo cargado vale mucho más de lo que dice el número, y quien lo
 * lea tiene que saberlo.
 */
export type ValorInventario = {
  moneda: string;
  valor: number;
  productos: number;
  sin_costo: number;
};

export function valorInventario(productos: ProductoStock[]): ValorInventario[] {
  const vivos = productos.filter((p) => p.activo && p.controla_stock);
  const monedas = [...new Set(vivos.map((p) => p.moneda))].sort();

  return monedas.map((moneda) => {
    const suyos = vivos.filter((p) => p.moneda === moneda);
    return {
      moneda,
      valor: suyos
        .filter((p) => p.costo_promedio !== null)
        .reduce((s, p) => s + p.stock_actual * (p.costo_promedio as number), 0),
      productos: suyos.length,
      sin_costo: suyos.filter((p) => p.costo_promedio === null).length,
    };
  });
}

const dentro = (fecha: string, desde: string, hasta: string) => fecha >= desde && fecha <= hasta;

/**
 * El costo de lo que salió en el período, valorizado al costo de cada salida.
 *
 * Solo las salidas por VENTA: un ajuste por rotura también saca mercadería
 * pero no es costo de ventas, y meterlo adentro haría que romper cosas
 * pareciera vender más.
 */
export function costoDeLoVendido(
  movimientos: MovimientoKardex[],
  moneda: string,
  desde: string,
  hasta: string,
): number | null {
  const salidas = movimientos.filter(
    (m) => m.moneda === moneda && m.tipo === "salida" && dentro(m.fecha, desde, hasta),
  );

  if (salidas.length === 0) return null;

  const conCosto = salidas.filter((m) => m.costo_unitario !== null);
  if (conCosto.length === 0) return null;

  return conCosto.reduce((s, m) => s + m.cantidad * (m.costo_unitario as number), 0);
}

/**
 * El inventario promedio del período: (valor al inicio + valor al final) / 2.
 *
 * Es la fórmula estándar y la más simple de reproducir a mano, que es lo que
 * importa para que alguien le crea. Un promedio diario sería más exacto y
 * nadie podría verificarlo.
 *
 * `null` cuando falta cualquiera de los dos extremos: promediar con un
 * extremo desconocido daría un número que parece medido y no lo es.
 */
export function inventarioPromedio(
  movimientos: MovimientoKardex[],
  moneda: string,
  desde: string,
  hasta: string,
  valorHoy: number,
): number | null {
  const suyos = movimientos
    .filter((m) => m.moneda === moneda && m.valor_resultante !== null)
    .sort((a, b) => a.fecha.localeCompare(b.fecha));

  // El valor al inicio es el del último movimiento ANTERIOR al período. Sin
  // ninguno, no se sabe con qué stock arrancó y no se inventa un cero: cero
  // diría que el negocio empezó el período sin nada.
  const previos = suyos.filter((m) => m.fecha < desde);
  if (previos.length === 0) return null;

  const alInicio = previos[previos.length - 1].valor_resultante as number;

  // El valor al final: el del último movimiento dentro del período, o el de
  // hoy si no hubo ninguno.
  const enPeriodo = suyos.filter((m) => dentro(m.fecha, desde, hasta));
  const alFinal =
    enPeriodo.length > 0 ? (enPeriodo[enPeriodo.length - 1].valor_resultante as number) : valorHoy;

  return (alInicio + alFinal) / 2;
}

/**
 * Cuántas veces se dio vuelta el stock en el período.
 *
 * `null` cuando falta el costo de lo vendido o el inventario promedio, y
 * también cuando el promedio es cero: dividir por cero daría infinito, y
 * "tu stock rotó ∞ veces" no es una respuesta.
 */
export function rotacion(costoVendido: number | null, promedio: number | null): number | null {
  if (costoVendido === null || promedio === null || promedio <= 0) return null;
  return Math.round((costoVendido / promedio) * 100) / 100;
}

/**
 * Días de inventario (DIO): cuántos días dura el stock al ritmo del período.
 *
 * Se calcula desde la rotación y el largo real del período, no dividiendo 365
 * por la rotación: con un período de dos semanas, esa cuenta daría un número
 * anualizado que nadie pidió.
 */
export function diasDeInventario(rot: number | null, diasDelPeriodo: number): number | null {
  if (rot === null || rot <= 0 || diasDelPeriodo <= 0) return null;
  return Math.round((diasDelPeriodo / rot) * 10) / 10;
}

/**
 * Lo que no se movió en todo el período, con su valor.
 *
 * Es plata quieta: mercadería comprada que no volvió a salir. Solo entran
 * productos CON stock — uno agotado no se movió porque no había, que es lo
 * contrario del problema.
 */
export type Quieto = { id: string; nombre: string; valor: number | null; stock: number };

export function stockQuieto(
  productos: ProductoStock[],
  movimientos: MovimientoKardex[],
  desde: string,
  hasta: string,
  moneda: string,
): Quieto[] {
  const seMovieron = new Set(
    movimientos
      .filter((m) => m.tipo === "salida" && dentro(m.fecha, desde, hasta))
      .map((m) => m.producto_id),
  );

  return productos
    .filter(
      (p) =>
        p.activo &&
        p.controla_stock &&
        p.moneda === moneda &&
        p.stock_actual > 0 &&
        !seMovieron.has(p.id),
    )
    .map((p) => ({
      id: p.id,
      nombre: p.nombre,
      stock: p.stock_actual,
      valor: p.costo_promedio === null ? null : p.stock_actual * p.costo_promedio,
    }))
    // Lo más caro primero: es donde está la plata quieta.
    .sort((a, b) => (b.valor ?? 0) - (a.valor ?? 0));
}
