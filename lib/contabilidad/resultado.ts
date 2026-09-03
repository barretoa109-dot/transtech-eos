/**
 * El estado de resultados: qué entró, qué costó y qué quedó.
 *
 * ============================================================
 * ESTO NO ES CONTABILIDAD, Y LA DIFERENCIA IMPORTA
 * ============================================================
 *
 * `docs/erp-profesional-arquitectura.md` deja la contabilidad de libro mayor
 * completa FUERA del alcance, y agrega una regla que acá se respeta al pie:
 * *"EOS no debe inventar equivalencias tributarias"*.
 *
 * Así que esto no es un estado de resultados contable. Es el resultado
 * OPERATIVO: se arma con los documentos que el negocio ya cargó —ventas,
 * costo de lo vendido salido del kardex, gastos anotados y fijos— sin plan de
 * cuentas, sin asientos y sin criterios de devengamiento.
 *
 * Sirve para manejar el negocio. NO sirve para presentar a la SET, y el
 * resultado lo dice con todas las letras en `advertencias` para que nadie lo
 * confunda ni lo mande a un contador como si fuera un balance.
 *
 * ============================================================
 * DÓNDE SE CORTA, Y POR QUÉ AHÍ
 * ============================================================
 *
 * Se llega hasta el RESULTADO OPERATIVO y no más:
 *
 *   Ventas netas
 *   − Costo de lo vendido
 *   = Resultado bruto
 *   − Gastos operativos
 *   = Resultado operativo          ← acá se corta
 *
 * Lo que sigue —intereses, impuestos, depreciación— necesita datos que este
 * sistema no tiene, y cada uno por un motivo estructural, no por falta de
 * código:
 *
 *   · INTERESES: `eos_finanzas_deudas` guarda el monto de la cuota, no su
 *     composición. Separar interés de capital exige la tasa y el sistema de
 *     amortización, que nadie carga.
 *   · DEPRECIACIÓN: no existe registro de activos fijos. Sin él no hay
 *     EBITDA, porque EBITDA es justamente el resultado ANTES de depreciar.
 *   · IMPUESTOS: son equivalencias tributarias. Ver la regla de arriba.
 *
 * Por eso `EBITDA`, `utilidad neta`, `ROE` y `ROA` no aparecen en ningún lado.
 * Un ROE inventado se ve exactamente igual que uno verdadero, y alguien
 * decide sobre él.
 *
 * Todo acá es puro.
 */

import { sinIva } from "../erp/margen.ts";
import { costoDeLoVendido, type MovimientoKardex } from "../erp/kardex.ts";
import { monedaConocida } from "../finanzas/monedas.ts";
import { dentroDe } from "../kpi/periodo.ts";
import type { Hechos, Periodo } from "../kpi/tipos.ts";

export type LineaResultado = {
  concepto: string;
  monto: number;
  /** Un subtotal se muestra distinto de una partida. */
  es_subtotal: boolean;
};

export type Resultado = {
  moneda: string;
  periodo: Periodo;

  ventas_netas: number;
  /** Null cuando el kardex no alcanza para costear las salidas del período. */
  costo_vendido: number | null;
  resultado_bruto: number | null;

  gastos_operativos: number;
  /** Null cuando no se pudo costear: sin costo no hay resultado. */
  resultado_operativo: number | null;

  lineas: LineaResultado[];

  /** Qué no se pudo calcular y por qué. */
  faltantes: string[];
  /** Lo que hay que leer antes de usar este número para algo. */
  advertencias: string[];
  /** De 0 a 1. Baja cuando falta costo o cuando falta el kardex. */
  confianza: number;
};

/** Los estados de venta que representan plata facturada. */
const VENTAS_VIVAS = new Set(["emitida", "cobrada"]);

export const NO_ES_PARA_LA_SET =
  "Este es el resultado operativo del negocio, no un estado contable: no tiene asientos, ni plan de cuentas, ni impuestos. No sirve para presentar ante la SET.";

/**
 * Arma el estado de resultados, uno por moneda.
 *
 * Nunca convierte: un resultado pertenece a una moneda. Sumar guaraníes con
 * dólares exigiría un tipo de cambio que el sistema no tiene, y el número que
 * saldría no sería el resultado de nada.
 */
export function estadoDeResultados(hechos: Hechos, periodo: Periodo): Resultado[] {
  const ventas = (hechos.ventas ?? []).filter(
    (v) => VENTAS_VIVAS.has(v.estado) && dentroDe(v.fecha, periodo),
  );
  const movimientos = (hechos.movimientos ?? []).filter(
    (m) => m.tipo === "gasto" && dentroDe(m.fecha, periodo),
  );
  const fijos = (hechos.fijos ?? []).filter((f) => f.tipo === "gasto");
  const stock = hechos.movimientos_stock ?? [];

  const monedas = new Set<string>();
  for (const v of ventas) monedas.add(monedaConocida(v.moneda));
  for (const m of movimientos) monedas.add(monedaConocida(m.moneda));
  for (const f of fijos) monedas.add(monedaConocida(f.moneda));

  return [...monedas].sort().map((moneda) => armar(moneda, periodo, { ventas, movimientos, fijos, stock }));
}

function armar(
  moneda: string,
  periodo: Periodo,
  datos: {
    ventas: NonNullable<Hechos["ventas"]>;
    movimientos: NonNullable<Hechos["movimientos"]>;
    fijos: NonNullable<Hechos["fijos"]>;
    stock: NonNullable<Hechos["movimientos_stock"]>;
  },
): Resultado {
  const ventas = datos.ventas.filter((v) => monedaConocida(v.moneda) === moneda);

  /*
   * Las ventas van NETAS de IVA, y esto no es un detalle de presentación.
   *
   * El IVA que se cobra no es ingreso del negocio: es plata de la SET que
   * pasa por la caja. Contarlo como venta infla el resultado en un 9,09% y
   * hace que el margen se vea mejor de lo que es. Es exactamente el bug R1
   * que se arregló en la fase 0, y por eso acá se netea línea por línea, con
   * la tasa de cada una: un documento puede mezclar 10%, 5% y exento.
   */
  let ventasNetas = 0;
  let ventasSinItems = 0;

  for (const v of ventas) {
    if (v.items.length === 0) {
      // Sin ítems no se conoce la tasa. Netear al 10% "porque es lo normal"
      // sería inventar el dato más caro del cálculo.
      ventasSinItems += 1;
      continue;
    }
    for (const item of v.items) ventasNetas += sinIva(item.total, item.iva);
  }

  const kardex: MovimientoKardex[] = datos.stock
    .filter((m) => monedaConocida(m.moneda) === moneda)
    .map((m) => ({
      fecha: m.fecha,
      tipo: m.tipo,
      cantidad: m.cantidad,
      costo_unitario: m.costo_unitario,
      valor_resultante: m.valor_resultante,
      producto_id: m.producto_id,
      moneda: monedaConocida(m.moneda),
    }));

  const costo = costoDeLoVendido(kardex, moneda, periodo.desde, periodo.hasta);

  const gastosAnotados = datos.movimientos
    .filter((m) => monedaConocida(m.moneda) === moneda)
    .reduce((s, m) => s + m.monto, 0);

  /*
   * Los fijos se cuentan una vez por el período, no una por mes.
   *
   * El período por defecto es el mes en curso, así que una vez es lo
   * correcto. Si alguien pide un trimestre, este número queda corto y se
   * avisa: multiplicar por los meses del rango daría un gasto que quizás no
   * ocurrió —un fijo dado de alta el mes pasado no se pagó en enero— y una
   * cifra inventada es peor que una declarada incompleta.
   */
  const gastosFijos = datos.fijos
    .filter((f) => monedaConocida(f.moneda) === moneda)
    .reduce((s, f) => s + f.monto, 0);

  const gastosOperativos = gastosAnotados + gastosFijos;

  const resultadoBruto = costo === null ? null : ventasNetas - costo;
  const resultadoOperativo = resultadoBruto === null ? null : resultadoBruto - gastosOperativos;

  const faltantes: string[] = [];
  const advertencias: string[] = [NO_ES_PARA_LA_SET];
  let confianza = 1;

  if (costo === null) {
    faltantes.push(
      "No se puede calcular el costo de lo vendido: falta el kardex valorizado de las salidas del período.",
    );
    confianza -= 0.5;
  }
  if (ventasSinItems > 0) {
    faltantes.push(
      `${ventasSinItems} ${ventasSinItems === 1 ? "venta no tiene detalle" : "ventas no tienen detalle"} y no se ${ventasSinItems === 1 ? "pudo" : "pudieron"} netear de IVA: ${ventasSinItems === 1 ? "quedó" : "quedaron"} fuera.`,
    );
    confianza -= Math.min(0.3, (ventasSinItems / Math.max(ventas.length, 1)) * 0.5);
  }
  if (gastosFijos > 0) {
    advertencias.push(
      "Los gastos fijos se contaron una sola vez. Si el período abarca más de un mes, el gasto real es mayor.",
    );
  }

  faltantes.push(
    "El resultado se corta en el operativo: intereses, depreciación e impuestos necesitan datos que el sistema no guarda.",
  );

  const lineas: LineaResultado[] = [
    { concepto: "Ventas netas", monto: ventasNetas, es_subtotal: false },
    { concepto: "Costo de lo vendido", monto: costo === null ? 0 : -costo, es_subtotal: false },
    { concepto: "Resultado bruto", monto: resultadoBruto ?? 0, es_subtotal: true },
    { concepto: "Gastos operativos", monto: -gastosOperativos, es_subtotal: false },
    { concepto: "Resultado operativo", monto: resultadoOperativo ?? 0, es_subtotal: true },
  ];

  return {
    moneda,
    periodo,
    ventas_netas: ventasNetas,
    costo_vendido: costo,
    resultado_bruto: resultadoBruto,
    gastos_operativos: gastosOperativos,
    resultado_operativo: resultadoOperativo,
    lineas,
    faltantes,
    advertencias,
    confianza: Math.max(0, Math.min(1, confianza)),
  };
}

/**
 * El margen operativo, en porcentaje sobre ventas netas.
 *
 * Se calcula acá y no en la pantalla para que exista un solo lugar donde se
 * decide contra qué se divide. Dividir sobre el total con IVA daría un margen
 * distinto y más lindo, que es justamente el error que ya costó caro.
 */
export function margenOperativo(r: Resultado): number | null {
  if (r.resultado_operativo === null || r.ventas_netas === 0) return null;
  return (r.resultado_operativo / r.ventas_netas) * 100;
}
