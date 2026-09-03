import type { TasaIva } from "../erp/impuestos.ts";

/**
 * El motor de KPIs: un catálogo de definiciones, no indicadores sueltos.
 *
 * ============================================================
 * POR QUÉ UN MOTOR Y NO UNA RUTA POR INDICADOR
 * ============================================================
 *
 * `lib/erp/indicadores.ts` calcula ROI, margen, punto de equilibrio y el resto
 * en una sola función que devuelve un tipo cerrado. Funciona, y sigue
 * funcionando: este módulo no lo reemplaza, lo rodea. El problema que resuelve
 * el motor es otro: agregar un indicador nuevo (pipeline de CRM, capital
 * inmovilizado en stock, lo que sea) no debería significar tocar una ruta,
 * inventar su propio criterio de "sin datos" y esperar que a nadie se le
 * olvide filtrar por moneda.
 *
 * Una `DefinicionKPI` declara qué necesita (`necesita: ClaveHecho[]`) y sabe
 * calcularse a partir de un único paquete de datos leído una vez —`Hechos`—,
 * en vez de cada indicador haciendo su propia consulta. Agregar un indicador es
 * agregar una definición al registro; ninguna ruta cambia.
 *
 * ============================================================
 * `Hechos` SE LEE UNA VEZ, MUCHOS INDICADORES CUELGAN DE AHÍ
 * ============================================================
 *
 * Es la misma idea de `lib/finanzas/panorama.ts`: una función que arma un
 * paquete de datos ya filtrados, y todo lo que se calcula sobre él usa
 * exactamente esos mismos arrays. Dos indicadores que leyeran la base cada uno
 * por su cuenta podrían, en teoría, ver el negocio en dos instantes distintos.
 *
 * ============================================================
 * `confianza` NO ES UN ADORNO
 * ============================================================
 *
 * Es la generalización de `ventas_sin_costo` y `loQueFalta()`, que ya existen
 * en `indicadores.ts` y ya tienen tests. Un margen calculado con 9 de 15
 * ventas porque las otras no tienen costo cargado no es un margen completo, y
 * el resultado lo dice: `nivel: 0.6`, `motivos: ["6 de 15 ventas no tienen
 * costo cargado"]`. Un tablero que admite lo que no sabe vale más que uno que
 * llena todos los casilleros.
 *
 * ============================================================
 * TODO NETO DE IVA, TODO POR MONEDA
 * ============================================================
 *
 * Las dos reglas que ya le costaron caro a este proyecto (ver
 * `lib/erp/margen.ts` y `lib/finanzas/monedas.ts`) valen acá exactamente
 * igual. `Hechos` guarda los montos tal como están en la base —con IVA
 * incluido, que es como se cargan— y cada definición neta lo que corresponda
 * antes de sumar. Y un `ResultadoKPI` es siempre de UNA moneda.
 */

export type Periodo = { desde: string; hasta: string };

// ---------------------------------------------------------------------------
// Hechos: lo que el motor lee una sola vez
// ---------------------------------------------------------------------------

export type ItemVentaHecho = {
  /** Con IVA incluido. */
  total: number;
  iva: TasaIva;
  cantidad: number;
  /** Con IVA incluido, si se conoce. */
  costo_unitario: number | null;
  producto_id: string | null;
};

export type EstadoVenta = "borrador" | "emitida" | "cobrada" | "anulada";

export type VentaHecho = {
  id: string;
  fecha: string;
  moneda: string | null;
  estado: EstadoVenta;
  contacto_id: string | null;
  contacto_nombre: string | null;
  /**
   * El total de la cabecera, con IVA incluido — el mismo número que la suma
   * de `items[].total`, pero ya calculado por la base. Para indicadores que
   * no necesitan desglose por línea (como cobros demorados) no hace falta
   * recorrer los ítems para llegar a un número que la base ya tiene.
   */
  total: number;

  /** Cuándo vence, si se pactó plazo. Null no es lo mismo que vencido. */
  vence_el: string | null;

  /**
   * Lo ya cobrado contra esta venta (v107).
   *
   * Con pagos parciales, `estado` ya no alcanza para saber qué falta: una
   * venta con la mitad abonada sigue en 'emitida'. El saldo es
   * `total - cobrado`.
   */
  cobrado: number;

  items: ItemVentaHecho[];
};

export type MovimientoHecho = {
  fecha: string;
  moneda: string | null;
  monto: number;
  tipo: "ingreso" | "gasto";
};

export type FijoHecho = {
  moneda: string | null;
  monto: number;
  tipo: "ingreso" | "gasto";
};

export type ProductoHecho = {
  id: string;
  nombre: string;
  moneda: string | null;
  activo: boolean;
  controla_stock: boolean;
  stock_actual: number;
  stock_minimo: number;

  /** Con IVA incluido, si se conoce. Es el ÚLTIMO costo pagado. */
  costo: number | null;

  /**
   * El promedio ponderado de lo que hay en stock (v108), con IVA incluido.
   *
   * Distinto de `costo` a propósito: aquel es el último que se pagó y sirve
   * para decidir precios y para congelar en la venta; este es con el que se
   * VALORIZA el inventario. Valorizar al último costo dice que las diez
   * unidades valen lo que costó la décima.
   */
  costo_promedio: number | null;

  iva: TasaIva;
};

/** Una línea del kardex (v108). */
export type MovimientoStockHecho = {
  fecha: string;
  tipo: "entrada" | "salida" | "ajuste";
  cantidad: number;
  costo_unitario: number | null;
  /** Cuánto valía el stock del producto DESPUÉS de este movimiento. */
  valor_resultante: number | null;
  producto_id: string;
  moneda: string;
};

export type EtapaOportunidad =
  | "nueva"
  | "contactado"
  | "propuesta"
  | "negociacion"
  | "ganada"
  | "perdida";

export type OportunidadHecho = {
  id: string;
  etapa: EtapaOportunidad;
  monto: number;
  moneda: string | null;
  creado_en: string;
  cerrada_en: string | null;
};

export type ActividadHecho = {
  oportunidad_id: string | null;
  fecha: string;
  hecha: boolean;
};

export type EstadoCompra = "registrada" | "pagada" | "anulada";

export type CompraHecho = {
  id: string;
  fecha: string;
  moneda: string | null;
  estado: EstadoCompra;
  proveedor_id: string | null;
  proveedor_nombre: string | null;
  /** Con IVA incluido. */
  total: number;

  /** Cuándo vence, si se pactó plazo. Null no es lo mismo que vencido. */
  vence_el: string | null;

  /** Lo ya pagado contra esta compra (v107). */
  cobrado: number;
};

/**
 * Todo lo que el motor necesita para calcular cualquier indicador de este
 * catálogo. Cada definición declara en `necesita` qué claves usa; el motor no
 * la llama si a `Hechos` le falta ese insumo (`hechos[clave]` no está o vino
 * vacío no es lo mismo — vacío es "no hay datos todavía", ausente es "esta
 * fuente ni se intentó leer").
 */
export type Hechos = {
  ventas?: VentaHecho[];
  compras?: CompraHecho[];
  movimientos?: MovimientoHecho[];
  fijos?: FijoHecho[];
  productos?: ProductoHecho[];
  movimientos_stock?: MovimientoStockHecho[];
  oportunidades?: OportunidadHecho[];
  actividades?: ActividadHecho[];
};

export type ClaveHecho = keyof Hechos;

// ---------------------------------------------------------------------------
// El resultado de calcular un KPI
// ---------------------------------------------------------------------------

export type Unidad = "moneda" | "porcentaje" | "cantidad" | "dias" | "ratio";
export type Direccion = "mas_es_mejor" | "menos_es_mejor" | "neutro";
export type Familia = "finanzas" | "ventas" | "crm" | "cartera" | "inventario" | "compras";
export type Estado = "bien" | "atencion" | "alerta" | "sin_datos";
export type Tendencia = "sube" | "baja" | "estable" | "desconocida";

/** La calidad del dato detrás del número, no un adorno. */
export type Confianza = {
  /** 1 = con todo el dato que hacía falta. Menos que eso, y por qué. */
  nivel: number;
  motivos: string[];
};

const CONFIANZA_PLENA: Confianza = { nivel: 1, motivos: [] };

/** Lo que una definición calcula para UNA moneda, antes de que el motor le
 * agregue período, tendencia y estado. */
export type ValorKPI = {
  moneda: string;
  valor: number | null;
  confianza: Confianza;
  /** Por qué es null, cuando es null. Ausente si el valor está calculado. */
  falta: string | null;
};

export type ResultadoKPI = {
  id: string;
  nombre: string;
  familia: Familia;
  unidad: Unidad;
  direccion: Direccion;
  moneda: string;
  valor: number | null;
  anterior: number | null;
  variacion: number | null;
  variacion_pct: number | null;
  tendencia: Tendencia;
  estado: Estado;
  periodo: Periodo;
  calculado_en: string;
  confianza: Confianza;
  falta: string | null;
};

export type DefinicionKPI = {
  id: string;
  nombre: string;
  familia: Familia;
  unidad: Unidad;
  direccion: Direccion;
  /** El motor no llama a `calcular` si falta alguna de estas claves. */
  necesita: ClaveHecho[];
  /**
   * Umbrales de ESTADO, en la unidad del propio indicador y ya orientados por
   * `direccion` (para "menos_es_mejor" un umbral más alto es peor, no mejor).
   * Sin umbrales, el estado es "bien" cuando hay valor y "sin_datos" si no.
   */
  umbrales?: { atencion: number; alerta: number };
  /**
   * `true` si `calcular` devuelve una foto del momento —el pipeline que hay
   * HOY, el stock bajo mínimo HOY— y no algo que se suma dentro del período
   * pedido. Una foto no cambia porque se la pida con otro `periodo`: pedirle
   * al motor que la compare contra "el período anterior" daría siempre
   * `anterior === valor` y una tendencia "estable" que no es un dato, es un
   * artefacto de no tener todavía series históricas (esa es la Fase 2 del
   * motor). Con esto en `true`, el motor no compara: `anterior` queda `null`
   * y la tendencia, `"desconocida"` — que es lo que de verdad se sabe.
   */
  instantanea?: boolean;
  /** Uno por moneda; el motor no decide monedas, la definición sabe cuáles hay. */
  calcular(hechos: Hechos, periodo: Periodo): ValorKPI[];
};

export function valorConocido(moneda: string, valor: number): ValorKPI {
  return { moneda, valor, confianza: CONFIANZA_PLENA, falta: null };
}

export function valorDesconocido(moneda: string, falta: string, confianza?: Confianza): ValorKPI {
  return { moneda, valor: null, confianza: confianza ?? { nivel: 0, motivos: [falta] }, falta };
}
