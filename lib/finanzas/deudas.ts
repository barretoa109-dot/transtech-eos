import { proximaFechaDelMes } from "./fijos.ts";
import type { MovimientoProyectado } from "./recurrencia.ts";

/**
 * Deudas declaradas: a quién le debe el usuario y qué cuota va a salir cuándo.
 *
 * Por qué esto NO pasa por el detector de series de `recurrencia.ts`: una serie
 * inferida no sabe cuándo termina, y un préstamo sí. Un crédito de 12 cuotas
 * con 10 pagadas tiene que descontar DOS cuotas más y después dejar de
 * descontar. Proyectarlo para siempre le muestra al usuario menos plata de la
 * que tiene, todos los meses, hasta que alguien se dé cuenta.
 *
 * Por eso acá se generan movimientos con fecha directamente, en vez de una
 * `SerieRecurrente`.
 *
 * **El saldo de una deuda es declarado, nunca calculado.** EOS no ve los pagos
 * al préstamo salvo que lleguen por correo, y un saldo que se recalcula solo
 * se desincroniza en silencio. En una deuda eso es peor que no saber: el
 * usuario toma decisiones creyendo que debe menos. Siempre se muestra como
 * "según lo que declaraste el <fecha>".
 */

export type EstadoDeuda = "al_dia" | "atrasada" | "en_negociacion" | "saldada";

export type Deuda = {
  id?: string;
  acreedor: string;
  tipo: "prestamo" | "tarjeta" | "proveedor" | "familiar" | "impuesto" | "otro";
  moneda: "PYG" | "USD";
  saldo_declarado: number;
  saldo_declarado_el: string;
  cuota_monto: number | null;
  cuota_dia: number | null;
  cuotas_totales: number | null;
  cuotas_pagadas: number;
  vence_el: string | null;
  estado: EstadoDeuda;
  preocupa: boolean;
};

/**
 * Confianza de una cuota declarada.
 *
 * Más alta que la de un fijo declarado (0,7) porque una cuota tiene fecha y
 * monto pactados por contrato, no estimados. Sigue por debajo de 1: el usuario
 * pudo haber refinanciado y no habérselo contado a nadie.
 */
const CONFIANZA_CUOTA = 0.9;

/** Tope de seguridad, igual que en `proyectar`: nunca un bucle sin fin. */
const MAX_CUOTAS = 60;

/** Mismo día del mes siguiente, anclado al último día si el mes es más corto. */
function mesSiguiente(iso: string, dia: number): string {
  const [anio, mes] = iso.slice(0, 10).split("-").map(Number);
  const siguienteMes = mes === 12 ? 1 : mes + 1;
  const siguienteAnio = mes === 12 ? anio + 1 : anio;
  const primero = `${siguienteAnio}-${String(siguienteMes).padStart(2, "0")}-01`;

  return proximaFechaDelMes(dia, primero);
}

/** Cuántas cuotas quedan por pagar. `null` = no se sabe, o sea sin límite. */
export function cuotasRestantes(deuda: Deuda): number | null {
  if (deuda.cuotas_totales === null) return null;
  return Math.max(0, deuda.cuotas_totales - deuda.cuotas_pagadas);
}

/** ¿Esta deuda todavía produce salidas de plata? */
export function estaViva(deuda: Deuda): boolean {
  if (deuda.estado === "saldada") return false;
  if (deuda.cuota_monto === null || deuda.cuota_dia === null) return false;
  if (deuda.cuota_monto <= 0) return false;

  const restantes = cuotasRestantes(deuda);
  return restantes === null || restantes > 0;
}

/**
 * Las cuotas que van a salir entre dos fechas.
 *
 * Se corta por tres motivos distintos, y los tres importan: se acabaron las
 * cuotas del crédito, la deuda venció, o se llegó al horizonte pedido.
 */
export function cuotasPendientes(
  deudas: Deuda[],
  opciones: { desde: string; hasta: string },
): MovimientoProyectado[] {
  const { desde, hasta } = opciones;
  const salida: MovimientoProyectado[] = [];

  for (const deuda of deudas) {
    if (!estaViva(deuda)) continue;

    const restantes = cuotasRestantes(deuda);
    const tope = Math.min(restantes ?? MAX_CUOTAS, MAX_CUOTAS);

    let fecha = proximaFechaDelMes(deuda.cuota_dia as number, desde);
    let emitidas = 0;

    while (fecha <= hasta && emitidas < tope) {
      // Una deuda con fecha de vencimiento no genera cuotas más allá de ella.
      if (deuda.vence_el !== null && fecha > deuda.vence_el) break;

      salida.push({
        tipo: "gasto",
        descripcion: describirCuota(deuda),
        monto: deuda.cuota_monto as number,
        fecha,
        periodicidad: "mensual",
        confianza: CONFIANZA_CUOTA,
      });

      fecha = mesSiguiente(fecha, deuda.cuota_dia as number);
      emitidas += 1;
    }
  }

  return salida.sort((a, b) => a.fecha.localeCompare(b.fecha));
}

function describirCuota(deuda: Deuda): string {
  const restantes = cuotasRestantes(deuda);

  if (restantes !== null && deuda.cuotas_totales !== null) {
    const numero = deuda.cuotas_pagadas + 1;
    return `Cuota ${numero} de ${deuda.cuotas_totales} — ${deuda.acreedor}`;
  }

  return `Cuota — ${deuda.acreedor}`;
}

/**
 * Saca las cuotas que ya están contempladas por otra proyección.
 *
 * Es el error más caro posible en este módulo: si el débito de la cuota además
 * llega por correo todos los meses, el detector de series lo reconoce Y la
 * deuda lo proyecta. La misma plata se descuenta dos veces y el usuario ve un
 * disponible más bajo del real — que es exactamente el problema que EOS existe
 * para no causar.
 *
 * No se comparan por nombre: el banco escribe "DEB.AUT.PRESTAMO" y el usuario
 * declaró "Banco Itaú". Se comparan por PLATA Y FECHA, que es lo que de verdad
 * define si son el mismo egreso: mismo importe dentro del 10% y misma fecha
 * dentro de tres días — el mismo criterio con el que `recurrencia` agrupa.
 */
export function sinDuplicar(
  cuotas: MovimientoProyectado[],
  yaProyectados: MovimientoProyectado[],
): MovimientoProyectado[] {
  const gastos = yaProyectados.filter((m) => m.tipo === "gasto");

  return cuotas.filter((cuota) => {
    const duplicada = gastos.some(
      (otro) =>
        Math.abs(otro.monto - cuota.monto) <= cuota.monto * 0.1 &&
        Math.abs(diasEntre(otro.fecha, cuota.fecha)) <= 3,
    );

    return !duplicada;
  });
}

function diasEntre(a: string, b: string): number {
  const ms = Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

/** Cuánto debe en total, por moneda. Solo lo que sigue vivo. */
export function totalAdeudado(deudas: Deuda[], moneda: "PYG" | "USD" = "PYG"): number {
  return deudas
    .filter((d) => d.estado !== "saldada" && d.moneda === moneda)
    .reduce((total, d) => total + d.saldo_declarado, 0);
}

/**
 * En qué orden hablar de las deudas.
 *
 * NO por monto. Una planilla ordena por monto; una persona que evita mirar sus
 * finanzas necesita que le hablen primero de lo que le quita el sueño. Por eso
 * manda lo que el usuario marcó como preocupante en el onboarding, después lo
 * que está atrasado, y recién al final el tamaño.
 */
export function porPrioridad(deudas: Deuda[]): Deuda[] {
  const peso = (d: Deuda) => {
    if (d.preocupa) return 0;
    if (d.estado === "atrasada") return 1;
    if (d.estado === "en_negociacion") return 2;
    return 3;
  };

  return [...deudas]
    .filter((d) => d.estado !== "saldada")
    .sort((a, b) => peso(a) - peso(b) || b.saldo_declarado - a.saldo_declarado);
}

/** La primera cuota que cae a partir de una fecha. */
export function proximaCuota(deudas: Deuda[], desde: string): MovimientoProyectado | null {
  const hasta = `${Number(desde.slice(0, 4)) + 1}${desde.slice(4, 10)}`;
  return cuotasPendientes(deudas, { desde, hasta })[0] ?? null;
}

/** Se exporta para que los tests puedan fijar el criterio de agrupación. */
export const _internos = { mesSiguiente, diasEntre, describirCuota };

/* =========================================================
   VALIDACIÓN DE ENTRADA

   Vive acá y no en la ruta por dos motivos: un archivo de ruta de Next solo
   puede exportar los verbos HTTP, así que nada de esto sería testeable desde
   ahí; y la regla de qué es una deuda válida es del dominio, no del transporte.
========================================================= */

const TIPOS_DEUDA = ["prestamo", "tarjeta", "proveedor", "familiar", "impuesto", "otro"];
const ESTADOS_DEUDA = ["al_dia", "atrasada", "en_negociacion", "saldada"];
const MAXIMO_RAZONABLE = 999_999_999_999;

export type DeudaValidada = {
  acreedor: string;
  tipo: string;
  moneda: "PYG" | "USD";
  saldo_declarado: number;
  saldo_declarado_el: string;
  cuota_monto: number | null;
  cuota_dia: number | null;
  cuotas_totales: number | null;
  cuotas_pagadas: number;
  tasa_anual: number | null;
  vence_el: string | null;
  estado: string;
  preocupa: boolean;
  notas: string | null;
};

function enteroOpcional(valor: unknown): number | null {
  if (valor === null || valor === undefined || valor === "") return null;
  const n = Math.round(Number(valor));
  return Number.isFinite(n) && n >= 0 && n < 1000 ? n : null;
}

function fechaOpcional(valor: unknown): string | null {
  return typeof valor === "string" && /^\d{4}-\d{2}-\d{2}$/.test(valor) ? valor : null;
}

/**
 * Valida lo que llega del cliente.
 *
 * A diferencia de los fijos —donde una fila incompleta se descarta en silencio
 * porque la pantalla permite renglones vacíos—, acá un dato que no se entiende
 * SÍ devuelve error. El usuario está declarando cuánto debe: quedarse callado
 * lo dejaría creyendo que quedó guardado algo que no se guardó.
 */
export function validarDeuda(
  body: Record<string, unknown>,
  hoy: string,
): { valor: DeudaValidada } | { error: string } {
  const acreedor = typeof body.acreedor === "string" ? body.acreedor.trim() : "";
  if (acreedor.length < 2) return { error: "Falta el nombre de a quién le debés." };

  const tipo = typeof body.tipo === "string" && TIPOS_DEUDA.includes(body.tipo) ? body.tipo : null;
  if (!tipo) return { error: "El tipo de deuda no es válido." };

  const saldo = Number(body.saldo_declarado);
  if (!Number.isFinite(saldo) || saldo < 0 || saldo > MAXIMO_RAZONABLE) {
    return { error: "El saldo no es un importe válido." };
  }

  // La cuota es todo o nada: un monto sin día no se puede proyectar y un día
  // sin monto tampoco. La misma restricción está en la base.
  const cuotaMonto =
    body.cuota_monto === null || body.cuota_monto === undefined || body.cuota_monto === ""
      ? null
      : Number(body.cuota_monto);
  const cuotaDia =
    body.cuota_dia === null || body.cuota_dia === undefined || body.cuota_dia === ""
      ? null
      : Math.round(Number(body.cuota_dia));

  if ((cuotaMonto === null) !== (cuotaDia === null)) {
    return { error: "Para proyectar la cuota necesito el monto y el día del mes." };
  }

  if (cuotaMonto !== null && (!Number.isFinite(cuotaMonto) || cuotaMonto <= 0)) {
    return { error: "El monto de la cuota no es válido." };
  }

  if (cuotaDia !== null && (!Number.isFinite(cuotaDia) || cuotaDia < 1 || cuotaDia > 31)) {
    return { error: "El día de la cuota tiene que estar entre 1 y 31." };
  }

  const totales = enteroOpcional(body.cuotas_totales);
  const pagadas = enteroOpcional(body.cuotas_pagadas) ?? 0;

  if (totales !== null && pagadas > totales) {
    return { error: "No podés tener más cuotas pagadas que cuotas totales." };
  }

  const tasa = body.tasa_anual === null || body.tasa_anual === undefined || body.tasa_anual === ""
    ? null
    : Number(body.tasa_anual);

  return {
    valor: {
      acreedor: acreedor.slice(0, 120),
      tipo,
      moneda: body.moneda === "USD" ? "USD" : "PYG",
      saldo_declarado: Math.round(saldo * 100) / 100,
      saldo_declarado_el: fechaOpcional(body.saldo_declarado_el) ?? hoy,
      cuota_monto: cuotaMonto === null ? null : Math.round(cuotaMonto * 100) / 100,
      cuota_dia: cuotaDia,
      cuotas_totales: totales,
      cuotas_pagadas: pagadas,
      tasa_anual: tasa !== null && Number.isFinite(tasa) ? tasa : null,
      vence_el: fechaOpcional(body.vence_el),
      estado:
        typeof body.estado === "string" && ESTADOS_DEUDA.includes(body.estado)
          ? body.estado
          : "al_dia",
      preocupa: body.preocupa === true,
      notas: typeof body.notas === "string" ? body.notas.slice(0, 500) : null,
    },
  };
}
