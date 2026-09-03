/**
 * Pronóstico de caja a 30, 60 y 90 días.
 *
 * ============================================================
 * ESTO NO ADIVINA NADA
 * ============================================================
 *
 * Un pronóstico de caja no es un modelo estadístico: es la suma de lo que ya
 * está pactado. Las facturas tienen vencimiento, las compras tienen
 * vencimiento y los gastos fijos se repiten todos los meses. Con esas tres
 * cosas se arma la proyección sin inventar ninguna.
 *
 * Por eso cada peso proyectado viaja con su grado de certeza, y son distintos
 * que no se pueden mezclar en un mismo número:
 *
 *   · COMPROMETIDO — hay un documento con monto y fecha. Es un HECHO.
 *   · ESPERADO     — un fijo que se repite todos los meses. Es una HIPÓTESIS
 *                    razonable, pero sigue siendo una hipótesis.
 *   · ESTIMADO     — sale de una tendencia. No se usa acá: vive en
 *                    `tendencia.ts`, porque mezclarlo con lo pactado haría que
 *                    una proyección estadística se lea como una factura.
 *
 * ============================================================
 * LO VENCIDO Y NO COBRADO NO SE CUENTA
 * ============================================================
 *
 * Esta es la decisión que hace que el número sirva para algo.
 *
 * Una factura que venció hace 40 días y sigue sin cobrarse YA DEMOSTRÓ que no
 * entra cuando debería. Meterla en el tramo de 30 días —o peor, tratarla como
 * si venciera hoy— produce exactamente el pronóstico que funde a un negocio:
 * uno que dice que la plata alcanza porque cuenta cobros que no van a ocurrir.
 *
 * Se reporta aparte, en `vencido_sin_cobrar`, con esta lectura: puede entrar,
 * y ojalá entre, pero no se puede planificar sobre eso.
 *
 * No se le aplica ninguna probabilidad de cobro. Decir "el 70% de lo vencido
 * se termina cobrando" exigiría una tasa histórica de incobrabilidad que este
 * sistema todavía no tiene, y un porcentaje inventado se ve idéntico a uno
 * medido.
 *
 * ============================================================
 * SIN SALDO INICIAL NO HAY SALDO PROYECTADO
 * ============================================================
 *
 * El FLUJO —cuánto entra menos cuánto sale— se puede proyectar siempre. Pero
 * "vas a quedar en rojo el 12 de octubre" exige saber con cuánto se arranca.
 * Si no se conoce el disponible, `saldo_proyectado` queda en null y la
 * pantalla muestra el flujo sin fabricar un nivel de caja.
 *
 * Todo acá es puro: recibe filas ya leídas y no consulta nada.
 */

import type { CompraHecho, FijoHecho, VentaHecho } from "../kpi/tipos.ts";
import { estaPendiente, saldoDe, type DocumentoCartera } from "../erp/cartera.ts";

/** Los grados de certeza. No se suman entre sí sin decir cuál es cuál. */
export type Certeza = "comprometido" | "esperado" | "estimado";

export type Partida = {
  /** Cuándo se espera que ocurra. */
  fecha: string;
  /** Positivo entra, negativo sale. En la moneda del tramo, sin convertir. */
  monto: number;
  concepto: string;
  certeza: Certeza;
  origen: "venta" | "compra" | "fijo";
  documento_id: string | null;
};

export type TramoProyeccion = {
  /** 30, 60 o 90. */
  dias: number;
  hasta: string;
  /** Acumuladas desde hoy hasta el cierre del tramo. */
  entradas: number;
  salidas: number;
  neto: number;
  /** Null cuando no se conoce el disponible de hoy. */
  saldo_proyectado: number | null;
  /** Solo las de ESTE tramo, no las acumuladas. */
  partidas: Partida[];
};

export type ProyeccionCaja = {
  moneda: string;
  saldo_inicial: number | null;
  tramos: TramoProyeccion[];
  /**
   * Lo que ya venció y sigue sin cobrarse. Queda FUERA de los tramos a
   * propósito: ver el encabezado.
   */
  vencido_sin_cobrar: number;
  vencido_documentos: number;
  /** Lo mismo del lado de lo que se debe. */
  vencido_sin_pagar: number;
  /** Qué se dio por cierto para llegar a estos números. */
  supuestos: string[];
  /** Qué impide que el número sea completo. */
  faltantes: string[];
};

export const TRAMOS = [30, 60, 90] as const;

function sumarDias(fecha: string, dias: number): string {
  const t = Date.parse(`${fecha}T00:00:00Z`) + dias * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

/** Ventas y compras se leen con la misma forma que la cartera. */
function comoDocumento(v: VentaHecho | CompraHecho): DocumentoCartera {
  return {
    id: v.id,
    fecha: v.fecha,
    vence_el: v.vence_el,
    moneda: v.moneda ?? "PYG",
    total: v.total,
    cobrado: v.cobrado,
    contacto_id: null,
    contacto_nombre: null,
  };
}

/**
 * Qué documentos entran en la proyección y cuáles no.
 *
 * Quedan fuera tres grupos, cada uno por su motivo:
 *
 *   · Anulados y borradores — no son plata.
 *   · Sin vencimiento — no se pueden ubicar en el tiempo. Contar una venta a
 *     plazo abierto "dentro de 30 días" es elegir una fecha al azar.
 *   · Vencidos sin cobrar — ver el encabezado.
 */
function clasificar(docs: DocumentoCartera[], vivos: Set<string>, hoy: string, limite: string) {
  const dentro: DocumentoCartera[] = [];
  let vencido = 0;
  let vencidoDocs = 0;
  let sinVencimiento = 0;

  for (const d of docs) {
    if (!vivos.has(d.id)) continue;
    if (!estaPendiente(d)) continue;

    if (d.vence_el === null) {
      sinVencimiento += 1;
      continue;
    }
    if (d.vence_el < hoy) {
      vencido += saldoDe(d);
      vencidoDocs += 1;
      continue;
    }
    if (d.vence_el <= limite) dentro.push(d);
  }

  return { dentro, vencido, vencidoDocs, sinVencimiento };
}

function plural(n: number, singular: string, prural: string): string {
  return n === 1 ? singular : prural;
}

/**
 * La proyección, una por moneda.
 *
 * `saldos` es el disponible de hoy por moneda; puede venir vacío y entonces
 * solo se proyecta el flujo. Nunca se convierte entre monedas: no existe un
 * tipo de cambio en el sistema, y aplicar uno inventado mezclaría plata que
 * no es la misma.
 */
export function proyectarCaja(args: {
  ventas: VentaHecho[];
  compras: CompraHecho[];
  fijos: FijoHecho[];
  hoy: string;
  saldos?: Record<string, number>;
}): ProyeccionCaja[] {
  const { ventas, compras, fijos, hoy, saldos = {} } = args;
  const horizonte = sumarDias(hoy, Math.max(...TRAMOS));

  // Solo lo que sigue debiéndose: una venta cobrada o una compra pagada no
  // aportan flujo futuro, y las anuladas y los borradores no son plata.
  const ventasVivas = new Set(ventas.filter((v) => v.estado === "emitida").map((v) => v.id));
  const comprasVivas = new Set(compras.filter((c) => c.estado === "registrada").map((c) => c.id));

  const monedas = new Set<string>();
  for (const v of ventas) monedas.add(v.moneda ?? "PYG");
  for (const c of compras) monedas.add(c.moneda ?? "PYG");
  for (const f of fijos) monedas.add(f.moneda ?? "PYG");
  for (const m of Object.keys(saldos)) monedas.add(m);

  const salida: ProyeccionCaja[] = [];

  for (const moneda of [...monedas].sort()) {
    const docsVenta = ventas.filter((v) => (v.moneda ?? "PYG") === moneda).map(comoDocumento);
    const docsCompra = compras.filter((c) => (c.moneda ?? "PYG") === moneda).map(comoDocumento);
    const fijosMoneda = fijos.filter((f) => (f.moneda ?? "PYG") === moneda);

    const cobrar = clasificar(docsVenta, ventasVivas, hoy, horizonte);
    const pagar = clasificar(docsCompra, comprasVivas, hoy, horizonte);

    const partidas: Partida[] = [
      ...cobrar.dentro.map((d) => ({
        fecha: d.vence_el as string,
        monto: saldoDe(d),
        concepto: "Cobro de venta",
        certeza: "comprometido" as const,
        origen: "venta" as const,
        documento_id: d.id,
      })),
      ...pagar.dentro.map((d) => ({
        fecha: d.vence_el as string,
        monto: -saldoDe(d),
        concepto: "Pago de compra",
        certeza: "comprometido" as const,
        origen: "compra" as const,
        documento_id: d.id,
      })),
    ];

    // Los fijos se repiten una vez por cada mes del horizonte. Se ubican al
    // cierre de cada mes de 30 días y no en un día concreto: no se sabe qué
    // día del mes se paga cada uno, y fingir una fecha exacta daría un saldo
    // diario con más precisión de la que realmente hay.
    for (let mes = 1; mes <= TRAMOS.length; mes += 1) {
      const fecha = sumarDias(hoy, mes * 30);
      for (const f of fijosMoneda) {
        if (f.monto === 0) continue;
        partidas.push({
          fecha,
          monto: f.tipo === "ingreso" ? f.monto : -f.monto,
          concepto: f.tipo === "ingreso" ? "Ingreso fijo" : "Gasto fijo",
          certeza: "esperado",
          origen: "fijo",
          documento_id: null,
        });
      }
    }

    partidas.sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0));

    const inicial = Object.hasOwn(saldos, moneda) ? saldos[moneda] : null;

    const tramos: TramoProyeccion[] = TRAMOS.map((dias) => {
      const hasta = sumarDias(hoy, dias);
      // Exclusivo por abajo, salvo en el primer tramo: algo que vence HOY
      // todavía no venció, entra en las entradas, y tiene que aparecer
      // también en el detalle. Si no, el total del tramo no cuadra con lo
      // que se ve al abrirlo.
      const desde = dias === TRAMOS[0] ? sumarDias(hoy, -1) : sumarDias(hoy, dias - 30);
      const acumuladas = partidas.filter((p) => p.fecha <= hasta);
      const entradas = acumuladas.filter((p) => p.monto > 0).reduce((s, p) => s + p.monto, 0);
      const salidas = acumuladas.filter((p) => p.monto < 0).reduce((s, p) => s - p.monto, 0);
      const neto = entradas - salidas;

      return {
        dias,
        hasta,
        entradas,
        salidas,
        neto,
        saldo_proyectado: inicial === null ? null : inicial + neto,
        // El detalle son las partidas DE ESE TRAMO: quien abre "60 días"
        // quiere ver qué pasa entre el día 30 y el 60, no volver a leer el
        // primer mes.
        partidas: acumuladas.filter((p) => p.fecha > desde),
      };
    });

    const supuestos: string[] = ["Cada documento se cobra o se paga el día que vence."];
    if (fijosMoneda.length > 0) {
      supuestos.push(
        `Los ${fijosMoneda.length} ${plural(fijosMoneda.length, "fijo se repite", "fijos se repiten")} cada mes sin cambios.`,
      );
    }

    const faltantes: string[] = [];
    if (inicial === null) {
      faltantes.push("No se conoce el disponible de hoy: se proyecta el flujo, no el saldo.");
    }
    if (cobrar.sinVencimiento > 0) {
      faltantes.push(
        `${cobrar.sinVencimiento} ${plural(cobrar.sinVencimiento, "venta pendiente no tiene vencimiento", "ventas pendientes no tienen vencimiento")} y quedaron fuera.`,
      );
    }
    if (pagar.sinVencimiento > 0) {
      faltantes.push(
        `${pagar.sinVencimiento} ${plural(pagar.sinVencimiento, "compra pendiente no tiene vencimiento", "compras pendientes no tienen vencimiento")} y quedaron fuera.`,
      );
    }
    if (cobrar.vencidoDocs > 0) {
      faltantes.push(
        `${cobrar.vencidoDocs} ${plural(cobrar.vencidoDocs, "documento vencido no se contó", "documentos vencidos no se contaron")}: ya no entró cuando debía.`,
      );
    }

    salida.push({
      moneda,
      saldo_inicial: inicial,
      tramos,
      vencido_sin_cobrar: cobrar.vencido,
      vencido_documentos: cobrar.vencidoDocs,
      vencido_sin_pagar: pagar.vencido,
      supuestos,
      faltantes,
    });
  }

  return salida;
}

/**
 * El primer día en que la caja se pone en rojo, si es que ocurre.
 *
 * Devuelve null en dos casos que no son el mismo: cuando no hay saldo inicial
 * —no se puede saber— y cuando nunca cae por debajo de cero. Quien llama
 * tiene el `saldo_inicial` a mano para distinguirlos, y la pantalla no debe
 * mostrar "no hay riesgo" cuando en realidad es "no se sabe".
 */
export function primerDiaEnRojo(p: ProyeccionCaja): { fecha: string; saldo: number } | null {
  if (p.saldo_inicial === null) return null;

  let saldo = p.saldo_inicial;
  const todas = p.tramos.flatMap((t) => t.partidas).sort((a, b) => (a.fecha < b.fecha ? -1 : 1));

  for (const partida of todas) {
    saldo += partida.monto;
    if (saldo < 0) return { fecha: partida.fecha, saldo };
  }
  return null;
}
