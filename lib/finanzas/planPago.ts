import { cuotasRestantes, type Deuda } from "./deudas.ts";

/**
 * El plan de pago que EOS arma solo.
 *
 * Fase 4 de la hoja de ruta: "EOS prepara la solución completa; el usuario solo
 * aprueba". Este módulo prepara. No mueve un guaraní, y no puede: en Paraguay
 * no hay riel para que una aplicación pague la cuota de un préstamo ajeno. El
 * plan es una propuesta que el usuario ejecuta desde su banco.
 *
 * Decirlo importa porque el resto del sistema promete autonomía, y acá la
 * autonomía llega hasta el borrador. Prometer más sería mentir.
 *
 * ============================================================
 * DOS PREGUNTAS DISTINTAS, DOS CRITERIOS DISTINTOS
 * ============================================================
 *
 * Los planes de pago de manual usan un solo orden para todo, y se equivocan.
 * Cuando la plata no alcanza y cuando sobra no se decide igual:
 *
 *   1. **¿Qué pago primero cuando NO alcanza?** Por consecuencia de no pagar.
 *      No es lo mismo caer en mora con la SET o con un banco —multa, intereses,
 *      Informconf— que atrasarle una semana al tío Ramón. Ordenar por monto o
 *      por tasa acá es un error caro.
 *   2. **¿Dónde pongo lo que sobra?** Por tasa, que es lo que minimiza el
 *      interés total... salvo que el usuario haya marcado una deuda como la que
 *      le preocupa. Esa gana. Pagar un poco más de interés a cambio de que
 *      duerma tranquilo es un buen negocio: la tranquilidad es lo que este
 *      producto vende.
 */

export type PasoPlan = {
  acreedor: string;
  monto: number;
  fecha: string | null;
  /** Por qué está en esta posición. El usuario tiene derecho a entenderlo. */
  motivo: string;
};

export type PlanPago = {
  /** Lo que queda por mes para deudas, después de vivir. */
  capacidad_mensual: number;
  /** La suma de todas las cuotas del mes. */
  total_cuotas: number;
  alcanza: boolean;
  /** Cuánto falta para cubrir todas las cuotas. Cero si alcanza. */
  faltante: number;
  /** Qué pagar y en qué orden, hasta donde llega la capacidad. */
  orden: PasoPlan[];
  /** Acreedores que NO entran en la capacidad de este mes. */
  a_negociar: string[];
  /** Lo que sobra después de cubrir todas las cuotas. */
  excedente: number;
  /** A qué deuda conviene aplicar el excedente. */
  destino_excedente: { acreedor: string; motivo: string } | null;
  /** En cuántos meses quedaría sin deudas, al ritmo actual. */
  meses_para_salir: number | null;
};

/**
 * Costo de no pagar, de mayor a menor.
 *
 * Un impuesto impago corre multa e intereses y puede terminar en una
 * fiscalización. Un banco o una financiera reportan a Informconf, y eso cierra
 * el crédito por años. Un proveedor corta la mercadería, que para un comercio
 * es cortar la facturación. Un familiar es el único que entiende una demora.
 */
const COSTO_DE_NO_PAGAR: Record<Deuda["tipo"], number> = {
  impuesto: 0,
  prestamo: 1,
  tarjeta: 1,
  proveedor: 2,
  otro: 3,
  familiar: 4,
};

const MAX_MESES_SIMULADOS = 600;

function redondear(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Orden de pago cuando hay que elegir: primero lo que más cuesta no pagar. */
export function ordenarPorConsecuencia(deudas: Deuda[]): Deuda[] {
  return [...deudas].sort((a, b) => {
    // Lo ya atrasado va antes que lo que está al día, sin importar el tipo:
    // el daño ya empezó a correr.
    const atrasoA = a.estado === "atrasada" ? 0 : 1;
    const atrasoB = b.estado === "atrasada" ? 0 : 1;
    if (atrasoA !== atrasoB) return atrasoA - atrasoB;

    const costoA = COSTO_DE_NO_PAGAR[a.tipo] ?? 3;
    const costoB = COSTO_DE_NO_PAGAR[b.tipo] ?? 3;
    if (costoA !== costoB) return costoA - costoB;

    // A igual consecuencia, primero la cuota más chica: cubre más deudas con
    // la misma plata y deja menos frentes abiertos.
    return (a.cuota_monto ?? 0) - (b.cuota_monto ?? 0);
  });
}

function motivoDe(deuda: Deuda): string {
  if (deuda.estado === "atrasada") return "ya está atrasada y el daño corre";
  if (deuda.tipo === "impuesto") return "un impuesto impago suma multa e intereses";
  if (deuda.tipo === "prestamo" || deuda.tipo === "tarjeta") {
    return "caer en mora te deja reportado y te cierra el crédito";
  }
  if (deuda.tipo === "proveedor") return "sin proveedor no hay mercadería que vender";
  if (deuda.tipo === "familiar") return "es la que más margen de conversación tiene";
  return "queda dentro de lo que podés cubrir";
}

/**
 * A dónde va lo que sobra.
 *
 * Manda lo que el usuario marcó como preocupante; si no marcó nada, la tasa
 * más alta, que es lo que minimiza el interés total.
 */
export function destinoDelExcedente(
  deudas: Deuda[],
): { acreedor: string; motivo: string } | null {
  const vivas = deudas.filter((d) => d.estado !== "saldada" && d.saldo_declarado > 0);
  if (vivas.length === 0) return null;

  const preocupa = vivas.find((d) => d.preocupa);
  if (preocupa) {
    return {
      acreedor: preocupa.acreedor,
      motivo: "es la que me dijiste que más te preocupa",
    };
  }

  const conTasa = vivas.filter((d) => (d.tasa_anual ?? 0) > 0);
  if (conTasa.length > 0) {
    const cara = conTasa.reduce((peor, d) =>
      (d.tasa_anual ?? 0) > (peor.tasa_anual ?? 0) ? d : peor,
    );
    return {
      acreedor: cara.acreedor,
      motivo: `es la que más interés te cobra (${cara.tasa_anual}% anual)`,
    };
  }

  // Sin tasas declaradas, la más chica: sacarse una deuda de encima entera
  // rinde más que bajarle un poco a todas.
  const chica = vivas.reduce((menor, d) =>
    d.saldo_declarado < menor.saldo_declarado ? d : menor,
  );

  return { acreedor: chica.acreedor, motivo: "es la que podés terminar de pagar antes" };
}

/**
 * Cuántos meses faltan para no deber nada, si todos los meses se destina la
 * misma capacidad.
 *
 * Sin interés compuesto a propósito: las tasas declaradas son opcionales y a
 * menudo faltan, y un número calculado con datos incompletos presentado como
 * exacto es peor que no darlo. Es una estimación de piso, y así se nombra.
 */
export function mesesParaSalir(deudas: Deuda[], capacidadMensual: number): number | null {
  const saldos = deudas
    .filter((d) => d.estado !== "saldada" && d.saldo_declarado > 0)
    .map((d) => d.saldo_declarado);

  if (saldos.length === 0) return 0;
  if (capacidadMensual <= 0) return null;

  const total = saldos.reduce((t, s) => t + s, 0);
  const meses = Math.ceil(total / capacidadMensual);

  return meses > MAX_MESES_SIMULADOS ? null : meses;
}

export function armarPlan(opciones: {
  deudas: Deuda[];
  /** Lo que queda por mes después de vivir: ingresos menos gastos y reserva. */
  capacidadMensual: number;
  /** Fecha de la próxima cuota de cada acreedor, si se conoce. */
  fechas?: Record<string, string>;
}): PlanPago {
  const { capacidadMensual, fechas = {} } = opciones;

  const vivas = opciones.deudas.filter(
    (d) => d.estado !== "saldada" && (d.cuota_monto ?? 0) > 0 && (cuotasRestantes(d) ?? 1) > 0,
  );

  const totalCuotas = redondear(vivas.reduce((t, d) => t + (d.cuota_monto ?? 0), 0));
  const ordenadas = ordenarPorConsecuencia(vivas);

  const orden: PasoPlan[] = [];
  const aNegociar: string[] = [];
  let restante = capacidadMensual;

  for (const deuda of ordenadas) {
    const cuota = deuda.cuota_monto ?? 0;

    if (cuota <= restante) {
      orden.push({
        acreedor: deuda.acreedor,
        monto: cuota,
        fecha: fechas[deuda.acreedor] ?? null,
        motivo: motivoDe(deuda),
      });
      restante = redondear(restante - cuota);
      continue;
    }

    // No entra. Y NO se paga a medias: pagar la mitad de una cuota no evita la
    // mora, así que solo gastaría plata que sirve para cubrir otra entera.
    aNegociar.push(deuda.acreedor);
  }

  const alcanza = aNegociar.length === 0;
  const faltante = alcanza ? 0 : redondear(Math.max(0, totalCuotas - capacidadMensual));
  const excedente = alcanza ? redondear(Math.max(0, restante)) : 0;

  return {
    capacidad_mensual: redondear(capacidadMensual),
    total_cuotas: totalCuotas,
    alcanza,
    faltante,
    orden,
    a_negociar: aNegociar,
    excedente,
    destino_excedente: excedente > 0 ? destinoDelExcedente(opciones.deudas) : null,
    meses_para_salir: mesesParaSalir(opciones.deudas, capacidadMensual),
  };
}
