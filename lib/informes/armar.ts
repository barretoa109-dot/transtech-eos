import { desglosarGastos, type LineaDestino } from "../finanzas/destinos.ts";
import type { Periodo } from "./periodo.ts";

/**
 * El contenido del informe, antes de decidir si sale en Excel, PDF o Word.
 *
 * Los tres formatos muestran lo mismo; lo único que cambia es cómo se pinta.
 * Separarlo así no es prolijidad: es la única forma de que el PDF y el Excel
 * no se contradigan cuando alguien arregle un cálculo en uno solo. Y como es
 * puro —recibe filas ya leídas, no toca la base— la matemática del informe se
 * puede probar sin una sesión.
 *
 * ============================================================
 * LO QUE ESTE INFORME ADMITE QUE NO SABE
 * ============================================================
 *
 * Un balance que se presenta como completo cuando no lo es hace más daño que
 * no existir: el usuario lo lleva al contador, o toma una decisión con él, y
 * el hueco aparece después. EOS no ve el efectivo ni la billetera salvo que
 * alguien se lo cuente, así que cada informe sale con sus advertencias
 * adentro, no en una nota al pie que se recorta al imprimir.
 */

export type MovimientoInforme = {
  tipo: "ingreso" | "gasto" | "compromiso";
  monto: number;
  fecha: string;
  descripcion: string | null;
  categoria?: string | null;
};

export type DeudaInforme = {
  acreedor: string;
  tipo: string;
  moneda: string;
  saldo_declarado: number;
  saldo_declarado_el: string;
  cuota_monto: number | null;
  estado: string;
};

export type Informe = {
  titulo: string;
  periodo: Periodo;
  moneda: string;
  /** Fecha en que se generó, para que un archivo viejo se delate solo. */
  generadoEl: string;
  resumen: {
    ingresos: number;
    gastos: number;
    /** Ingresos menos gastos del período. Puede ser negativo, y se muestra. */
    neto: number;
    movimientos: number;
    /** Compromisos con fecha dentro del período que todavía no se pagaron. */
    comprometido: number;
  };
  destinos: LineaDestino[];
  movimientos: MovimientoInforme[];
  deudas: DeudaInforme[];
  /** Lo que EOS no puede garantizar. Va impreso dentro del documento. */
  advertencias: string[];
};

const TITULOS: Record<string, string> = {
  semana: "Balance semanal",
  semana_pasada: "Balance de la semana",
  mes: "Balance del mes",
  mes_pasado: "Balance mensual",
  trimestre: "Balance trimestral",
  anio: "Balance anual",
  personalizado: "Balance",
};

function redondear(valor: number): number {
  return Math.round(valor * 100) / 100;
}

function sumar(movimientos: { monto: number }[]): number {
  return movimientos.reduce((total, m) => total + m.monto, 0);
}

export function armarInforme(datos: {
  periodo: Periodo;
  moneda: string;
  hoy: string;
  movimientos: MovimientoInforme[];
  deudas?: DeudaInforme[];
  /** Si EOS aprendió cuánto se gasta sin verlo, se dice en el informe. */
  gastoInvisible?: number;
}): Informe {
  const { periodo, hoy } = datos;

  const dentro = (m: MovimientoInforme) => m.fecha >= periodo.desde && m.fecha <= periodo.hasta;
  const delPeriodo = datos.movimientos.filter(dentro);

  const ingresos = delPeriodo.filter((m) => m.tipo === "ingreso");
  const gastos = delPeriodo.filter((m) => m.tipo === "gasto");

  // Los compromisos se cuentan aparte y NO entran en el neto: son plata que
  // todavía está en la cuenta. Sumarlos como gasto haría que el balance del
  // período no cierre contra el extracto del banco, que es exactamente contra
  // lo que el usuario lo va a comparar.
  const comprometido = sumar(delPeriodo.filter((m) => m.tipo === "compromiso"));

  const totalIngresos = redondear(sumar(ingresos));
  const totalGastos = redondear(sumar(gastos));

  const advertencias: string[] = [];

  if (datos.gastoInvisible && datos.gastoInvisible > 0) {
    advertencias.push(
      "EOS no ve los pagos en efectivo ni con billetera. Según tu propio ritmo, " +
        "se te van alrededor de " +
        formatear(datos.gastoInvisible, datos.moneda) +
        " por mes que no figuran acá.",
    );
  } else {
    advertencias.push(
      "EOS no ve los pagos en efectivo ni con billetera: lo que no llegó por " +
        "correo ni se cargó a mano no está en este informe.",
    );
  }

  const desglose = desglosarGastos(gastos);

  if (desglose.sin_reconocer > 0 && desglose.total > 0) {
    const parte = Math.round((desglose.sin_reconocer / desglose.total) * 100);
    advertencias.push(
      `${formatear(desglose.sin_reconocer, datos.moneda)} (${parte}% de los gastos) ` +
        "quedaron sin clasificar porque su descripción no alcanzó para saber a qué rubro pertenecen.",
    );
  }

  if (comprometido > 0) {
    advertencias.push(
      formatear(comprometido, datos.moneda) +
        " son compromisos con fecha en el período que todavía no salieron de la cuenta. " +
        "No están restados del neto.",
    );
  }

  // El período que todavía no terminó se avisa: un "balance del mes" pedido un
  // día 3 muestra tres días, y sin esta línea se lee como un mes flojísimo.
  if (periodo.hasta >= hoy && periodo.desde < hoy) {
    advertencias.push(
      "El período todavía no terminó: este informe llega hasta hoy, no hasta el final.",
    );
  }

  return {
    titulo: TITULOS[periodo.clave] ?? "Balance",
    periodo,
    moneda: datos.moneda,
    generadoEl: hoy,
    resumen: {
      ingresos: totalIngresos,
      gastos: totalGastos,
      neto: redondear(totalIngresos - totalGastos),
      movimientos: delPeriodo.length,
      comprometido: redondear(comprometido),
    },
    destinos: desglose.destinos,
    // Del más reciente al más viejo: quien abre el archivo busca lo último.
    movimientos: [...delPeriodo].sort((a, b) => b.fecha.localeCompare(a.fecha)),
    deudas: (datos.deudas ?? []).filter((d) => d.estado !== "saldada"),
    advertencias,
  };
}

/** Igual que el formateador de pantalla, para que el papel no diga otra cosa. */
export function formatear(valor: number, moneda: string): string {
  const simbolo = moneda === "PYG" ? "₲" : moneda === "USD" ? "US$" : "";
  const numero = new Intl.NumberFormat("es-PY", { maximumFractionDigits: 0 }).format(
    Math.round(valor),
  );
  return `${simbolo} ${numero}`.trim();
}
