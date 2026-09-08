import type { MovimientoProyectado } from "./recurrencia.ts";

/**
 * Tarjetas de crédito: el ciclo, lo que se debe y cuándo hay que pagarlo.
 *
 * ============================================================
 * EL PROBLEMA CENTRAL ES CONTAR LA MISMA PLATA DOS VECES
 * ============================================================
 *
 * Una compra con tarjeta puede aparecer en tres lugares a la vez: como gasto
 * del día que se hizo, como saldo de la tarjeta, y como pago del resumen el
 * mes siguiente. Contarla en los tres deja a la persona con el triple de gasto
 * del que tuvo, y encima un disponible real que le dice que está peor de lo
 * que está.
 *
 * La regla que sigue todo este módulo es una sola:
 *
 *   **LO QUE SALE DEL BOLSILLO ES EL PAGO DEL RESUMEN, NO LA COMPRA.**
 *
 * La compra crea una DEUDA; el pago mueve PLATA. El flujo de caja —el
 * calendario, el presupuesto, el disponible real— solo mira lo segundo. Las
 * compras en cuotas viven acá adentro y sirven para explicar de qué está hecha
 * la obligación del mes, no para sumarse aparte.
 *
 * Por eso `obligacionesDe` devuelve UNA línea por tarjeta y por vencimiento, y
 * nunca una por compra.
 *
 * ============================================================
 * NO SE INVENTAN INTERESES, NI TASAS, NI CARGOS
 * ============================================================
 *
 * Dependen del contrato, del plazo y de la promoción de turno, y EOS no los
 * conoce. Un interés estimado se ve idéntico a uno real y se decide sobre él.
 *
 * De la misma manera, `cuota × cuotas` NO es lo que costó la compra cuando
 * hubo financiación: por eso `monto_total` es un dato aparte y opcional, y no
 * se deduce.
 *
 * ============================================================
 * EL RESUMEN MANDA; SIN RESUMEN, LAS CUOTAS SON UN PISO
 * ============================================================
 *
 * Si la persona pasó el total del resumen, esa es la obligación: incluye
 * consumos que EOS no vio.
 *
 * Sin resumen, se suman las cuotas conocidas — y el número se marca como PISO,
 * porque en el mes hubo casi con seguridad compras de un solo pago que no
 * están cargadas. Presentar un piso como si fuera el total haría que alguien
 * pague de menos.
 *
 * Es puro: recibe filas ya leídas y no toca la base.
 */

/** Confianza de una obligación que sale del resumen: es un número cerrado. */
const CONFIANZA_RESUMEN = 1;

/** Confianza de la que sale de sumar cuotas: sabemos que le faltan consumos. */
const CONFIANZA_PISO = 0.7;

/** Tope de seguridad al proyectar vencimientos. Nunca un bucle sin fin. */
const MAX_VENCIMIENTOS = 24;

/**
 * A partir de qué utilización una tarjeta empieza a apretar.
 *
 * No es una regla financiera universal: es el punto donde la tarjeta deja de
 * ser un medio de pago y pasa a ser una fuente de financiación, y desde donde
 * un imprevisto ya no entra. Se declara acá para que se pueda discutir.
 */
export const UTILIZACION_QUE_APRIETA = 0.75;

/** A partir de cuántos días un resumen deja de describir el ciclo actual. */
const DIAS_HASTA_QUE_EL_RESUMEN_ENVEJECE = 45;

export type Tarjeta = {
  id: string;
  emisor: string;
  nombre: string | null;
  moneda: string;
  linea_total: number | null;
  saldo_utilizado: number | null;
  saldo_al: string | null;
  dia_cierre: number | null;
  dia_vencimiento: number | null;
  pago_minimo: number | null;
  pago_total: number | null;
  resumen_al: string | null;
};

export type CompraEnCuotas = {
  id: string;
  tarjeta_id: string;
  descripcion: string;
  moneda: string;
  monto_total: number | null;
  monto_cuota: number;
  cuotas_totales: number;
  cuotas_pagadas: number;
  primera_cuota: string;
};

export type CompraViva = CompraEnCuotas & {
  cuotas_restantes: number;
  /** En qué número de cuota va, contando desde 1. */
  cuota_actual: number;
  /** Lo que todavía falta pagar de esta compra. */
  falta: number;
  /** El mes en que se termina de pagar. */
  ultima_cuota: string;
};

export type EstadoTarjeta = {
  id: string;
  emisor: string;
  nombre: string | null;
  moneda: string;

  linea_total: number | null;
  saldo_utilizado: number | null;
  saldo_al: string | null;
  /** Línea menos saldo. `null` sin una de las dos. */
  disponible: number | null;
  /** De 0 a 1. `null` sin línea declarada. */
  utilizacion: number | null;
  aprieta: boolean;

  /*
   * Los días declarados, además de las fechas calculadas.
   *
   * La pantalla de edición necesita el DÍA para poder mostrarlo tal como lo
   * escribió la persona. Sacarlo de `proximo_vencimiento` daría 30 cuando
   * alguien puso 31 y el mes que viene es noviembre.
   */
  dia_cierre: number | null;
  dia_vencimiento: number | null;
  proximo_cierre: string | null;
  proximo_vencimiento: string | null;
  /** Cuántos días faltan para el vencimiento. */
  dias_para_vencer: number | null;

  pago_minimo: number | null;
  pago_total: number | null;
  resumen_al: string | null;

  /** Lo que hay que pagar en el próximo vencimiento. */
  a_pagar: number | null;
  /** De dónde salió ese número. */
  a_pagar_origen: "resumen" | "cuotas" | null;
  /** Si es un piso y no el total: faltan los consumos que EOS no vio. */
  a_pagar_es_piso: boolean;

  compras: CompraViva[];
  /** Lo que se lleva por mes en cuotas ya comprometidas. */
  cuotas_por_mes: number;
  /** El mes en que se libera la última cuota. `null` si no hay compras. */
  libre_desde: string | null;

  confianza: { nivel: number; motivos: string[] };
};

export function estadoDeTarjeta(
  tarjeta: Tarjeta,
  compras: CompraEnCuotas[],
  hoy: string,
): EstadoTarjeta {
  const propias = compras.filter((c) => c.tarjeta_id === tarjeta.id);
  const vivas = propias.filter((c) => c.cuotas_pagadas < c.cuotas_totales).map((c) => vivificar(c));

  const disponible =
    tarjeta.linea_total !== null && tarjeta.saldo_utilizado !== null
      ? redondear(tarjeta.linea_total - tarjeta.saldo_utilizado)
      : null;

  const utilizacion =
    tarjeta.linea_total !== null && tarjeta.linea_total > 0 && tarjeta.saldo_utilizado !== null
      ? redondear(tarjeta.saldo_utilizado / tarjeta.linea_total, 4)
      : null;

  const proximoCierre =
    tarjeta.dia_cierre === null ? null : proximaFechaDelMes(tarjeta.dia_cierre, hoy);

  const proximoVencimiento =
    tarjeta.dia_vencimiento === null ? null : proximaFechaDelMes(tarjeta.dia_vencimiento, hoy);

  const cuotasPorMes = redondear(vivas.reduce((t, c) => t + c.monto_cuota, 0));

  /*
   * Qué hay que pagar. El resumen manda cuando existe y es de este ciclo: es
   * un número cerrado que incluye consumos que EOS nunca vio.
   *
   * Sin resumen se usan las cuotas conocidas, y queda marcado como PISO. Casi
   * siempre falta algo —las compras de un solo pago no están cargadas— y
   * presentar un piso como total haría que alguien pague de menos.
   */
  const resumenFresco =
    tarjeta.pago_total !== null &&
    tarjeta.resumen_al !== null &&
    diasEntre(tarjeta.resumen_al, hoy) <= DIAS_HASTA_QUE_EL_RESUMEN_ENVEJECE;

  const aPagar = resumenFresco ? tarjeta.pago_total : cuotasPorMes > 0 ? cuotasPorMes : null;

  const origen: EstadoTarjeta["a_pagar_origen"] = resumenFresco
    ? "resumen"
    : cuotasPorMes > 0
      ? "cuotas"
      : null;

  const ultimas = vivas.map((c) => c.ultima_cuota).sort();

  return {
    id: tarjeta.id,
    emisor: tarjeta.emisor,
    nombre: tarjeta.nombre,
    moneda: tarjeta.moneda,
    linea_total: tarjeta.linea_total,
    saldo_utilizado: tarjeta.saldo_utilizado,
    saldo_al: tarjeta.saldo_al,
    disponible,
    utilizacion,
    aprieta: utilizacion !== null && utilizacion >= UTILIZACION_QUE_APRIETA,
    dia_cierre: tarjeta.dia_cierre,
    dia_vencimiento: tarjeta.dia_vencimiento,
    proximo_cierre: proximoCierre,
    proximo_vencimiento: proximoVencimiento,
    dias_para_vencer: proximoVencimiento === null ? null : diasEntre(hoy, proximoVencimiento),
    pago_minimo: tarjeta.pago_minimo,
    pago_total: tarjeta.pago_total,
    resumen_al: tarjeta.resumen_al,
    a_pagar: aPagar,
    a_pagar_origen: origen,
    a_pagar_es_piso: origen === "cuotas",
    compras: vivas,
    cuotas_por_mes: cuotasPorMes,
    libre_desde: ultimas.length > 0 ? ultimas[ultimas.length - 1] : null,
    confianza: confianzaDe(tarjeta, hoy, resumenFresco, vivas.length),
  };
}

/**
 * Lo que las tarjetas van a sacar del bolsillo, para la línea de tiempo.
 *
 * ============================================================
 * UNA LÍNEA POR VENCIMIENTO, NUNCA UNA POR COMPRA
 * ============================================================
 *
 * Ésta es la función donde se gana o se pierde la batalla contra el doble
 * conteo. Las compras en cuotas ya están DENTRO de lo que se paga en el
 * vencimiento: emitirlas además por separado descontaría cada cuota dos veces.
 *
 * Lo que sale de acá se mezcla en `armarPanorama` con el resto de los egresos
 * y pasa por `sinDuplicar`, así que un movimiento "pagué la tarjeta" ya
 * anotado tampoco la duplica.
 */
export function obligacionesDe(
  tarjetas: EstadoTarjeta[],
  opciones: { desde: string; hasta: string },
): MovimientoProyectado[] {
  const salida: MovimientoProyectado[] = [];

  for (const t of tarjetas) {
    if (t.proximo_vencimiento === null || t.a_pagar === null || t.a_pagar <= 0) continue;

    let fecha = t.proximo_vencimiento;
    let emitidos = 0;

    while (fecha <= opciones.hasta && emitidos < MAX_VENCIMIENTOS) {
      if (fecha >= opciones.desde) {
        /*
         * El primer vencimiento usa lo que hay que pagar ahora —del resumen si
         * lo hay—; los siguientes usan solo las cuotas comprometidas, porque
         * el resumen del mes que viene todavía no existe y suponer que va a
         * ser igual al de éste sería inventar un consumo.
         */
        const monto = emitidos === 0 ? t.a_pagar : t.cuotas_por_mes;
        if (monto > 0) {
          salida.push({
            tipo: "gasto",
            descripcion: `Tarjeta — ${t.nombre ?? t.emisor}`,
            monto,
            fecha,
            periodicidad: "mensual",
            confianza: emitidos === 0 && !t.a_pagar_es_piso ? CONFIANZA_RESUMEN : CONFIANZA_PISO,
          });
        }
      }

      fecha = mesSiguiente(fecha, t.proximo_vencimiento);
      emitidos += 1;
    }
  }

  return salida.sort((a, b) => a.fecha.localeCompare(b.fecha));
}

/**
 * Tarjetas que además están cargadas como deuda: el mismo saldo, dos veces.
 *
 * Antes de la v146 la única forma de cargar una tarjeta era como deuda de tipo
 * `tarjeta`. Quien ya lo hizo y ahora la carga acá termina con la obligación
 * contada dos veces en el calendario y en el presupuesto.
 *
 * No se borra nada sola: se avisa, con los dos nombres, para que la persona
 * elija cuál queda. Borrar el registro de alguien porque un algoritmo creyó
 * que se repetía es peor que el problema.
 */
export function tarjetasRepetidasEnDeudas(
  tarjetas: EstadoTarjeta[],
  deudas: { acreedor: string; tipo: string }[],
): { tarjeta: string; acreedor: string }[] {
  const repetidas: { tarjeta: string; acreedor: string }[] = [];

  for (const t of tarjetas) {
    const nombres = [t.emisor, t.nombre ?? ""].map(normalizar).filter((n) => n.length >= 3);

    for (const d of deudas) {
      if (d.tipo !== "tarjeta") continue;
      const acreedor = normalizar(d.acreedor);

      if (nombres.some((n) => acreedor.includes(n) || n.includes(acreedor))) {
        repetidas.push({ tarjeta: t.nombre ?? t.emisor, acreedor: d.acreedor });
        break;
      }
    }
  }

  return repetidas;
}

function vivificar(c: CompraEnCuotas): CompraViva {
  const restantes = c.cuotas_totales - c.cuotas_pagadas;

  return {
    ...c,
    cuotas_restantes: restantes,
    cuota_actual: Math.min(c.cuotas_pagadas + 1, c.cuotas_totales),
    falta: redondear(c.monto_cuota * restantes),
    // La primera cuota más las que faltan: si la primera fue en marzo y son
    // doce, la última cae en febrero del año siguiente.
    ultima_cuota: sumarMeses(c.primera_cuota, c.cuotas_totales - 1),
  };
}

function confianzaDe(
  t: Tarjeta,
  hoy: string,
  resumenFresco: boolean,
  comprasVivas: number,
): { nivel: number; motivos: string[] } {
  const motivos: string[] = [];
  let nivel = 1;

  if (t.dia_vencimiento === null) {
    nivel -= 0.3;
    motivos.push("no sé qué día se vence, así que no puedo ponerla en el calendario");
  }

  if (t.linea_total === null) {
    nivel -= 0.2;
    motivos.push("no sé cuál es tu línea, así que no puedo decirte cuánto te queda disponible");
  }

  if (!resumenFresco) {
    nivel -= 0.2;
    motivos.push(
      t.resumen_al === null
        ? comprasVivas > 0
          ? "todavía no me pasaste un resumen: lo que ves es lo que suman tus cuotas, y en el mes seguro hubo más"
          : "todavía no me pasaste un resumen ni cargaste compras en cuotas"
        : `el último resumen que tengo es del ${t.resumen_al}`,
    );
  }

  if (t.saldo_utilizado !== null && t.saldo_al !== null && diasEntre(t.saldo_al, hoy) > 45) {
    nivel -= 0.2;
    motivos.push(`el saldo que tengo es del ${t.saldo_al}`);
  }

  return { nivel: Math.max(0, redondear(nivel, 2)), motivos };
}

/** El próximo día `dia` del mes que sea igual o posterior a `desde`. */
function proximaFechaDelMes(dia: number, desde: string): string {
  const [anio, mes] = desde.split("-").map(Number);
  const esteMes = conDiaValido(anio, mes, dia);

  return esteMes >= desde ? esteMes : conDiaValido(anio, mes + 1, dia);
}

function mesSiguiente(fecha: string, dia: string): string {
  const [anio, mes] = fecha.split("-").map(Number);
  return conDiaValido(anio, mes + 1, Number(dia.split("-")[2]));
}

/** El día `dia` de ese mes, o el último si ese mes no lo tiene (el 31 en abril). */
function conDiaValido(anio: number, mes: number, dia: number): string {
  const ultimo = new Date(Date.UTC(anio, mes, 0)).getUTCDate();
  return new Date(Date.UTC(anio, mes - 1, Math.min(dia, ultimo))).toISOString().slice(0, 10);
}

function sumarMeses(iso: string, meses: number): string {
  const [anio, mes, dia] = iso.split("-").map(Number);
  return conDiaValido(anio, mes + meses, dia);
}

function diasEntre(desde: string, hasta: string): number {
  return Math.round((enUTC(hasta) - enUTC(desde)) / 86_400_000);
}

function enUTC(iso: string): number {
  const [anio, mes, dia] = iso.split("-").map(Number);
  return Date.UTC(anio, mes - 1, dia);
}

function normalizar(texto: string): string {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\b(tarjeta|banco|financiera|de|la|el)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function redondear(valor: number, decimales = 2): number {
  const factor = 10 ** decimales;
  return Number.isFinite(valor) ? Math.round(valor * factor) / factor : 0;
}
