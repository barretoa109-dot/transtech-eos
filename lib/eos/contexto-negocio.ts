import { formatearMonto } from "../finanzas/formato.ts";

/**
 * Cómo va el negocio, contado en dos párrafos.
 *
 * ============================================================
 * POR QUÉ TEXTO Y NO JSON
 * ============================================================
 *
 * Esto va dentro de un prompt. Un JSON con llaves y comillas gasta el doble de
 * tokens que la misma información escrita, y obliga al modelo a interpretar una
 * estructura antes de entender un número. Escrito en castellano se lee igual
 * que el resto del prompt y cuesta la mitad.
 *
 * Además obliga a decidir acá el formato de cada monto. Si se mandara el número
 * pelado, el modelo elegiría cómo mostrarlo y escribiría "Gs. 1,250,000" o
 * "1.25M" según el día. Formateado una sola vez, sale siempre igual y sale como
 * se escriben los montos en Paraguay.
 */

export type ContextoNegocio = {
  mes?: string;
  finanzas?: Array<{
    moneda: string;
    ingresos_mes: number;
    gastos_mes: number;
    neto_mes: number;
  }>;
  erp?: {
    ventas_mes?: { cantidad: number; por_moneda?: MontoPorMoneda[] };
    por_cobrar?: MontoPorMoneda[];
    por_pagar?: MontoPorMoneda[];
    bajo_minimo?: Array<{ nombre: string; stock: number }>;
    mas_vendidos?: string[];
  };
  crm?: {
    oportunidades_abiertas?: { cantidad: number; por_moneda?: MontoPorMoneda[] };
    ganadas_mes?: number;
    actividades_pendientes?: number;
  };
};

/**
 * Toda cifra de plata del contexto viene así: una fila por moneda.
 *
 * Antes eran números sueltos que la base sumaba entre monedas y esto imprimía
 * con "PYG" escrito a mano. El resultado era que EOS le contestaba al usuario
 * una cifra que no existe en ninguna moneda — y con la seguridad de una
 * respuesta, que es lo que la vuelve peligrosa. Ver la migración v94.
 */
export type MontoPorMoneda = { moneda: string; total?: number; monto?: number };

/** "Gs. 1.250.000" o, con dos monedas, "Gs. 1.250.000 y USD 300". */
function montos(filas: MontoPorMoneda[] | undefined): string | null {
  const conPlata = (filas ?? [])
    .map((f) => ({ moneda: f.moneda, valor: Number(f.total ?? f.monto ?? 0) }))
    .filter((f) => f.valor > 0);

  if (conPlata.length === 0) return null;

  return conPlata.map((f) => formatearMonto(f.valor, f.moneda)).join(" y ");
}

/*
 * Cuando no hay nada cargado se devuelve cadena vacía y el prompt no lleva
 * sección de negocio.
 *
 * Un bloque que dice "ventas del mes: Gs. 0, por cobrar: Gs. 0" es peor que no
 * mandar nada: el modelo lo lee como un hecho y arranca a hablar de un negocio
 * parado cuando en realidad la persona todavía no cargó nada.
 */
export function textoContexto(contexto: ContextoNegocio | null | undefined): string {
  if (!contexto) return "";

  const partes: string[] = [];

  const finanzas = (contexto.finanzas ?? []).filter(
    (f) => f.ingresos_mes > 0 || f.gastos_mes > 0,
  );

  if (finanzas.length > 0) {
    // Cada moneda en su renglón, sin sumar entre monedas: un total que mezcla
    // guaraníes con dólares a una cotización inventada se ve preciso y está mal.
    const lineas = finanzas.map(
      (f) =>
        `  ${f.moneda}: entró ${formatearMonto(f.ingresos_mes, f.moneda)}, ` +
        `salió ${formatearMonto(f.gastos_mes, f.moneda)}, ` +
        `queda ${formatearMonto(f.neto_mes, f.moneda)}`,
    );

    partes.push(`Movimientos del mes:\n${lineas.join("\n")}`);
  }

  const erp = contexto.erp;

  if (erp) {
    const linea: string[] = [];

    if (erp.ventas_mes && erp.ventas_mes.cantidad > 0) {
      const vendido = montos(erp.ventas_mes.por_moneda);
      const cuantas = `${erp.ventas_mes.cantidad} ${erp.ventas_mes.cantidad === 1 ? "venta" : "ventas"}`;

      linea.push(vendido ? `${cuantas} por ${vendido}` : cuantas);
    }

    const porCobrar = montos(erp.por_cobrar);
    if (porCobrar) linea.push(`le deben ${porCobrar}`);

    const porPagar = montos(erp.por_pagar);
    if (porPagar) linea.push(`debe ${porPagar}`);

    if (linea.length > 0) partes.push(`Negocio este mes: ${linea.join("; ")}.`);

    if (erp.mas_vendidos && erp.mas_vendidos.length > 0) {
      partes.push(`Lo que más sale: ${erp.mas_vendidos.join(", ")}.`);
    }

    if (erp.bajo_minimo && erp.bajo_minimo.length > 0) {
      const items = erp.bajo_minimo.map((p) => `${p.nombre} (${p.stock})`);
      partes.push(`Por faltar: ${items.join(", ")}.`);
    }
  }

  const crm = contexto.crm;

  if (crm) {
    const linea: string[] = [];

    if (crm.oportunidades_abiertas && crm.oportunidades_abiertas.cantidad > 0) {
      const enJuego = montos(crm.oportunidades_abiertas.por_moneda);
      const cuantas = `${crm.oportunidades_abiertas.cantidad} abiertas`;

      linea.push(enJuego ? `${cuantas} por ${enJuego}` : cuantas);
    }

    if (crm.ganadas_mes && crm.ganadas_mes > 0) {
      linea.push(`${crm.ganadas_mes} ganadas este mes`);
    }

    if (crm.actividades_pendientes && crm.actividades_pendientes > 0) {
      // "Para hoy o antes" y no "pendientes": lo de la semana que viene no
      // amerita que el asistente lo mencione sin que se lo pregunten.
      linea.push(
        `${crm.actividades_pendientes} ${
          crm.actividades_pendientes === 1 ? "tarea" : "tareas"
        } de seguimiento para hoy o antes`,
      );
    }

    if (linea.length > 0) partes.push(`Oportunidades: ${linea.join("; ")}.`);
  }

  return partes.join("\n");
}
