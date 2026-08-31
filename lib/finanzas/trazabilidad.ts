import type { EgresoPanorama, Panorama } from "./panorama.ts";

/**
 * De dónde sale cada número del panel.
 *
 * ============================================================
 * POR QUÉ ESTO ES UNA FUNCIÓN Y NO UNA PANTALLA
 * ============================================================
 *
 * "El usuario debe poder seleccionar cualquier total y llegar hasta los
 * movimientos que lo componen." Suena a trabajo de interfaz, y no lo es: si el
 * detalle se arma aparte del total —con el mismo filtro escrito dos veces— un
 * día no van a cuadrar. Y un detalle que no cuadra con su total es PEOR que no
 * tener detalle: el usuario descubre que uno de los dos miente y no sabe cuál,
 * así que deja de creerle a los dos.
 *
 * Por eso el detalle sale de los MISMOS arrays que se sumaron para obtener el
 * total. No se vuelve a filtrar nada acá.
 *
 * ============================================================
 * HAY DOS CLASES DE NÚMERO, Y SE ABREN DISTINTO
 * ============================================================
 *
 * 1. **Suma.** "Ingresos del mes" es la suma de una lista de movimientos.
 *    Abrirlo es mostrar la lista.
 *
 * 2. **Cuenta.** "Disponible real" no es la suma de nada: es
 *    `saldo − comprometido − reserva − ahorro`. Mostrar una lista ahí sería
 *    inventar. Abrirlo es mostrar la operación, con cada término apuntando a
 *    su propia traza — y así, tirando del hilo, se llega igual a los
 *    movimientos.
 *
 * Confundir las dos es lo que hace que un panel "explicable" no explique nada:
 * poner una lista debajo de un número que no salió de esa lista.
 *
 * ============================================================
 * CADA TRAZA SE COMPRUEBA A SÍ MISMA
 * ============================================================
 *
 * `cuadra` no es decorativo. Recalcula el total desde sus partes y lo compara
 * con el que muestra el panel. Si alguna vez la aritmética de la ruta cambia y
 * el desglose queda viejo, esto lo delata en el acto en vez de dejar que el
 * usuario lo descubra.
 */

export type Partida = {
  fecha: string;
  descripcion: string;
  monto: number;
};

export type Termino = {
  etiqueta: string;
  monto: number;
  signo: "+" | "-";
  /** La cifra que se puede abrir a su vez, si tiene traza propia. */
  cifra?: ClaveCifra;
};

export type ClaveCifra =
  | "ingresos"
  | "gastos"
  | "saldo_estimado"
  | "compromisos"
  | "gastos_previsibles"
  | "cuotas"
  | "comprometido"
  | "disponible_real";

type Comun = {
  cifra: ClaveCifra;
  etiqueta: string;
  total: number;
  /** Recalculado desde las partes. Si es false, el panel y el detalle no coinciden. */
  cuadra: boolean;
};

export type Trazado =
  | (Comun & {
      tipo: "suma";
      /** Exclusivo: el punto de partida no se cuenta a sí mismo. */
      desde: string;
      /** Inclusivo. */
      hasta: string;
      partidas: Partida[];
    })
  | (Comun & { tipo: "cuenta"; terminos: Termino[] });

/**
 * PYG no lleva decimales y el panel redondea antes de mostrar. Comparar con
 * igualdad exacta marcaría como "no cuadra" una diferencia de medio guaraní
 * que no existe para nadie.
 */
const TOLERANCIA = 1;

function comoPartida(m: { fecha: string; descripcion: string | null; monto: number }): Partida {
  return {
    fecha: m.fecha,
    descripcion: m.descripcion?.trim() || "Sin descripción",
    monto: m.monto,
  };
}

function sumarPartidas(partidas: Partida[]): number {
  return partidas.reduce((t, p) => t + p.monto, 0);
}

function suma(
  cifra: ClaveCifra,
  etiqueta: string,
  total: number,
  ventana: { desde: string; hasta: string },
  origen: { fecha: string; descripcion: string | null; monto: number }[],
): Trazado {
  const partidas = origen.map(comoPartida);

  return {
    cifra,
    etiqueta,
    total,
    tipo: "suma",
    desde: ventana.desde,
    hasta: ventana.hasta,
    partidas,
    cuadra: Math.abs(sumarPartidas(partidas) - total) <= TOLERANCIA,
  };
}

function cuenta(cifra: ClaveCifra, etiqueta: string, total: number, terminos: Termino[]): Trazado {
  const recalculado = terminos.reduce(
    (t, x) => (x.signo === "+" ? t + x.monto : t - x.monto),
    0,
  );

  return {
    cifra,
    etiqueta,
    total,
    tipo: "cuenta",
    terminos,
    cuadra: Math.abs(recalculado - total) <= TOLERANCIA,
  };
}

/**
 * Recibe los MISMOS arrays y números que el panel ya calculó.
 *
 * No vuelve a filtrar ni a sumar nada por su cuenta: si lo hiciera, sería otra
 * implementación de la misma regla y las dos se separarían con el tiempo.
 */
export function trazarPanel(datos: {
  aplicado: Panorama["aplicado"];
  /** Egresos ya filtrados por horizonte y por fuente, tal como los usa el panel. */
  anotados: EgresoPanorama[];
  previsibles: EgresoPanorama[];
  cuotas: EgresoPanorama[];
  horizonte: string;
  /** El saldo del que se parte, ya corregido por conciliación. */
  saldoBase: number;
  gastoInvisible: number;
  saldoEstimado: number;
  totalCompromisos: number;
  totalPrevisible: number;
  totalCuotas: number;
  reserva: number;
  ahorroComprometido: number;
  disponibleReal: number;
}): Trazado[] {
  const { aplicado } = datos;
  const ventanaAplicada = { desde: aplicado.desde, hasta: aplicado.hasta };

  // Los egresos futuros van desde hoy hasta el horizonte, no desde el punto de
  // partida: son lo que todavía no pasó.
  const ventanaFutura = { desde: aplicado.hasta, hasta: datos.horizonte };

  const comprometido = datos.totalCompromisos + datos.totalPrevisible + datos.totalCuotas;

  return [
    suma("ingresos", "Lo que entró", aplicado.ingresos, ventanaAplicada, aplicado.entradas),
    suma("gastos", "Lo que salió", aplicado.gastos, ventanaAplicada, aplicado.salidas),

    cuenta("saldo_estimado", "Saldo estimado de hoy", datos.saldoEstimado, [
      { etiqueta: "Punto de partida", monto: datos.saldoBase, signo: "+" },
      { etiqueta: "Lo que entró", monto: aplicado.ingresos, signo: "+", cifra: "ingresos" },
      { etiqueta: "Lo que salió", monto: aplicado.gastos, signo: "-", cifra: "gastos" },
      // Billetera y efectivo: plata que se va sin que EOS la vea. Va acá y con
      // su nombre, porque si no el saldo no cierra y no se entiende por qué.
      { etiqueta: "Gasto que EOS no ve", monto: datos.gastoInvisible, signo: "-" },
    ]),

    suma(
      "compromisos",
      "Compromisos anotados",
      datos.totalCompromisos,
      ventanaFutura,
      datos.anotados,
    ),
    suma(
      "gastos_previsibles",
      "Gastos previsibles",
      datos.totalPrevisible,
      ventanaFutura,
      datos.previsibles,
    ),
    suma("cuotas", "Cuotas de tus deudas", datos.totalCuotas, ventanaFutura, datos.cuotas),

    cuenta("comprometido", "Todo lo que ya tiene dueño", comprometido, [
      { etiqueta: "Compromisos anotados", monto: datos.totalCompromisos, signo: "+", cifra: "compromisos" },
      { etiqueta: "Gastos previsibles", monto: datos.totalPrevisible, signo: "+", cifra: "gastos_previsibles" },
      { etiqueta: "Cuotas de tus deudas", monto: datos.totalCuotas, signo: "+", cifra: "cuotas" },
    ]),

    cuenta("disponible_real", "Disponible real", datos.disponibleReal, [
      { etiqueta: "Saldo estimado de hoy", monto: datos.saldoEstimado, signo: "+", cifra: "saldo_estimado" },
      { etiqueta: "Todo lo que ya tiene dueño", monto: comprometido, signo: "-", cifra: "comprometido" },
      { etiqueta: "Tu reserva mínima", monto: datos.reserva, signo: "-" },
      { etiqueta: "Lo que apartás para ahorrar", monto: datos.ahorroComprometido, signo: "-" },
    ]),
  ];
}

/** Las cifras que no cuadran. Vacío es lo esperado; con algo adentro hay un error. */
export function noCuadran(trazados: Trazado[]): Trazado[] {
  return trazados.filter((t) => !t.cuadra);
}
