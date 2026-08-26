import type { MovimientoProyectado } from "./recurrencia.ts";

/**
 * La curva del saldo, día por día, hacia adelante.
 *
 * EOS ya sabía todo esto: `detectarRiesgo` recorre exactamente esta línea de
 * tiempo para encontrar el día en que la plata no alcanza. Lo que no existía
 * era una forma de MOSTRARLA. El usuario recibía "el 28 te va a faltar
 * 500.000" por notificación y no tenía dónde ir a ver por qué, ni qué pasa
 * después del 28, ni cuán cerca del borde viene pasando todos los meses.
 *
 * ============================================================
 * POR QUÉ ESTE MÓDULO NO PUEDE DIVERGIR DE `riesgo.ts`
 * ============================================================
 *
 * Si el gráfico dibujara la curva con una regla distinta a la que usa el
 * detector, habría días en que el aviso dice "vas a cruzar" y la pantalla
 * muestra la línea cómodamente arriba de la reserva. Eso no es un detalle
 * cosmético: es el producto contradiciéndose a sí mismo delante del usuario,
 * y después de eso ninguno de los dos números vuelve a creerse.
 *
 * Por eso se replica la regla exacta de `detectarRiesgo`: **dentro de un mismo
 * día, los egresos van primero**. Y por eso cada punto guarda el `piso` del
 * día —el punto más bajo que tocó el saldo— además del cierre: el detector
 * mira después de cada egreso, no al final del día. Hay un test que ata las
 * dos funciones justamente para que nadie las separe sin darse cuenta.
 */

export type PuntoTrayectoria = {
  fecha: string;
  /** El saldo al terminar el día, con todo aplicado. */
  saldo: number;
  /** El punto más bajo que tocó el saldo ese día. Es el que decide el riesgo. */
  piso: number;
  /** Qué pasó ese día. Vacío en la enorme mayoría de los días. */
  eventos: { descripcion: string; monto: number; tipo: "ingreso" | "egreso" }[];
};

export type Trayectoria = {
  puntos: PuntoTrayectoria[];
  reservaMinima: number;
  /** El día más flaco del horizonte. Es el que hay que mirar. */
  valle: { fecha: string; saldo: number };
  /** El primer día en que el saldo perfora la reserva. `null` si nunca pasa. */
  cruce: string | null;
};

function sumarDias(iso: string, dias: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + dias * 86_400_000).toISOString().slice(0, 10);
}

function redondear(valor: number): number {
  return Math.round(valor * 100) / 100;
}

/**
 * Arma la curva entre `hoy` y `hasta`.
 *
 * Devuelve un punto por día, incluidos los días en que no pasa nada: una
 * curva con huecos se dibuja con los tramos comprimidos y hace parecer que un
 * gasto del día 30 está a la vuelta de la esquina.
 */
export function trazarTrayectoria(opciones: {
  hoy: string;
  hasta: string;
  saldoActual: number;
  reservaMinima: number;
  egresos: MovimientoProyectado[];
  ingresos: MovimientoProyectado[];
}): Trayectoria {
  const { hoy, hasta, saldoActual, reservaMinima } = opciones;

  const enVentana = (m: MovimientoProyectado) => m.fecha >= hoy && m.fecha <= hasta;

  // Misma regla que `detectarRiesgo`: el egreso del día se aplica antes que el
  // ingreso del mismo día. Si el sueldo entra el 5 y la cuota se debita el 5,
  // no se puede dar por sentado que la acreditación gane la carrera.
  const eventos = [
    ...opciones.egresos.filter(enVentana).map((m) => ({ ...m, orden: 0, signo: -1 as const })),
    ...opciones.ingresos.filter(enVentana).map((m) => ({ ...m, orden: 1, signo: 1 as const })),
  ].sort((a, b) => a.fecha.localeCompare(b.fecha) || a.orden - b.orden);

  const porDia = new Map<string, typeof eventos>();
  for (const e of eventos) {
    const delDia = porDia.get(e.fecha) ?? [];
    delDia.push(e);
    porDia.set(e.fecha, delDia);
  }

  const puntos: PuntoTrayectoria[] = [];
  let saldo = saldoActual;
  let cruce: string | null = null;

  for (let fecha = hoy; fecha <= hasta; fecha = sumarDias(fecha, 1)) {
    const delDia = porDia.get(fecha) ?? [];
    let piso = saldo;

    for (const e of delDia) {
      saldo += e.signo * e.monto;
      // El piso se mide después de cada movimiento, no al cierre: un día que
      // empieza con un egreso grande y termina con un ingreso mayor igual
      // pasó por abajo, y es ahí donde el banco rechaza el débito.
      if (saldo < piso) piso = saldo;
    }

    if (cruce === null && piso < reservaMinima) cruce = fecha;

    puntos.push({
      fecha,
      saldo: redondear(saldo),
      piso: redondear(piso),
      eventos: delDia.map((e) => ({
        descripcion: e.descripcion,
        monto: redondear(e.monto),
        tipo: e.signo === 1 ? ("ingreso" as const) : ("egreso" as const),
      })),
    });
  }

  // El valle se busca sobre el piso y no sobre el cierre, por la misma razón:
  // el peor momento del horizonte es el peor momento, no el peor cierre.
  const valle = puntos.reduce(
    (peor, p) => (p.piso < peor.saldo ? { fecha: p.fecha, saldo: p.piso } : peor),
    { fecha: hoy, saldo: puntos[0]?.piso ?? redondear(saldoActual) },
  );

  return { puntos, reservaMinima: redondear(reservaMinima), valle, cruce };
}
