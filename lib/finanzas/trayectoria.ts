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

/**
 * La curva, pero con un rango: qué tan seguro está EOS de ese saldo.
 *
 * ============================================================
 * POR QUÉ ESTO NO ES UN MODELO ESTADÍSTICO
 * ============================================================
 *
 * El punto 17 del documento de visión EOS 2030 pide "intervalos de
 * incertidumbre". La tentación es inventar una distribución —un desvío
 * estándar sobre el historial de gastos— y dibujar una campana. Eso sería
 * fabricar una precisión que no existe: `panorama.ts` ya lo dice en su propio
 * comentario, "un número sin su grado de confianza al lado se lee como
 * certeza", y una campana estadística sobre tres meses de datos de una PyME
 * es exactamente eso, con un disfraz matemático.
 *
 * Lo que SÍ existe, sin inventar nada, es la `confianza` que cada movimiento
 * proyectado ya trae desde `recurrencia.ts`: 1 para lo declarado o ya anotado
 * (un fijo, una cuota, un ingreso que la persona cargó a futuro), y entre 0.6
 * y 0.95 para un patrón que EOS detectó solo. Esa confianza ya está en cada
 * ítem de `Panorama.egresos` / `Panorama.ingresos`; lo único que faltaba era
 * usarla para algo más que filtrar.
 *
 * ============================================================
 * LA REGLA, EN UNA FRASE POR LADO
 * ============================================================
 *
 * - **Piso (peor caso):** los gastos esperados se mantienen TODOS —en el peor
 *   caso, nada deja de pasar—, pero los ingresos que todavía no son seguros
 *   (confianza < 1, un patrón detectado y no declarado) se asumen que NO
 *   entran esta vez.
 * - **Techo (mejor caso):** los ingresos esperados se mantienen TODOS, pero
 *   los gastos que todavía no son un patrón firme (confianza < 1) se asumen
 *   que NO se repiten esta vez.
 *
 * El resultado: `piso.saldo ≤ esperado.saldo ≤ techo.saldo` en cada punto,
 * siempre — nunca al revés, porque cada banda solo le saca certeza a un lado
 * de la cuenta, nunca se la suma al otro.
 */
const CERTEZA = 1;

export type BandaTrayectoria = {
  esperado: Trayectoria;
  /** Peor caso: los ingresos inciertos no entran. */
  piso: Trayectoria;
  /** Mejor caso: los gastos inciertos no se repiten. */
  techo: Trayectoria;
};

export function trazarBanda(opciones: {
  hoy: string;
  hasta: string;
  saldoActual: number;
  reservaMinima: number;
  egresos: MovimientoProyectado[];
  ingresos: MovimientoProyectado[];
}): BandaTrayectoria {
  const base = {
    hoy: opciones.hoy,
    hasta: opciones.hasta,
    saldoActual: opciones.saldoActual,
    reservaMinima: opciones.reservaMinima,
  };

  const esperado = trazarTrayectoria({ ...base, egresos: opciones.egresos, ingresos: opciones.ingresos });

  const piso = trazarTrayectoria({
    ...base,
    egresos: opciones.egresos,
    ingresos: opciones.ingresos.filter((i) => i.confianza >= CERTEZA),
  });

  const techo = trazarTrayectoria({
    ...base,
    egresos: opciones.egresos.filter((e) => e.confianza >= CERTEZA),
    ingresos: opciones.ingresos,
  });

  return { esperado, piso, techo };
}
