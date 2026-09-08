/**
 * Lo que viene, con el saldo que va quedando después de cada cosa.
 *
 * ============================================================
 * POR QUÉ ES UNA FUNCIÓN Y NO CUENTAS EN LA PANTALLA
 * ============================================================
 *
 * La columna "quedan X" es la que hace todo el trabajo del calendario: ver
 * "alquiler 2.000.000" no dice nada por sí solo, y ver que después del
 * alquiler quedan 180.000 con la cuota del auto tres días más tarde lo dice
 * todo, sin que la persona sume nada.
 *
 * Es una cuenta acumulada sobre una lista ordenada, con un corte por horizonte
 * en el medio: el tipo de cálculo donde un error se ve razonable. Si el saldo
 * se acumulara solo sobre los eventos VISIBLES, alguien que mira 7 días vería
 * el saldo de una cuenta que empieza hoy, no el suyo — y sería creíble.
 *
 * Acá está separada para poder probar exactamente eso.
 */

export type EventoCalendario = {
  fecha: string;
  descripcion: string;
  monto: number;
  direccion: "entra" | "sale";
  fuente: "anotado" | "previsible" | "cuota";
};

export type FilaCalendario = EventoCalendario & {
  /** El saldo DESPUÉS de este evento. */
  saldo: number;
  /** Si con este evento se cruza el colchón que el usuario pidió mantener. */
  bajoReserva: boolean;
};

/**
 * Corre el saldo evento por evento y corta por horizonte.
 *
 * El corte se aplica DESPUÉS de acumular, no antes: los eventos anteriores al
 * corte ya movieron el saldo, y esconderlos no los deshace.
 */
export function correrSaldo(opciones: {
  eventos: EventoCalendario[];
  saldoInicial: number;
  reservaMinima: number;
  /** Fecha inclusive hasta la que se muestra. Sin ella, todo. */
  hasta?: string;
}): FilaCalendario[] {
  const { eventos, saldoInicial, reservaMinima, hasta } = opciones;

  const ordenados = [...eventos].sort((a, b) =>
    a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0,
  );

  let saldo = saldoInicial;
  const filas: FilaCalendario[] = [];

  for (const e of ordenados) {
    saldo += e.direccion === "entra" ? e.monto : -e.monto;

    if (hasta && e.fecha > hasta) continue;

    filas.push({ ...e, saldo, bajoReserva: saldo < reservaMinima });
  }

  return filas;
}

/**
 * El primer día en que no alcanza.
 *
 * Es lo que la persona vino a saber, y no tiene que encontrarlo leyendo la
 * lista. Devuelve `null` cuando el saldo nunca baja del colchón — que es el
 * resultado esperado la mayoría de los meses.
 */
export function primerApriete(filas: FilaCalendario[]): FilaCalendario | null {
  return filas.find((f) => f.bajoReserva) ?? null;
}
