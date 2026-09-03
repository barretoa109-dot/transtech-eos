/**
 * Escenarios: "¿y si…?" sobre el pronóstico de caja.
 *
 * ============================================================
 * UN ESCENARIO NO ESCRIBE NADA, NUNCA
 * ============================================================
 *
 * Esto recibe los mismos hechos que `proyectarCaja`, les aplica una palanca en
 * memoria y vuelve a proyectar. No hay base de datos de por medio, no hay
 * efecto durable, y no existe una versión de estas funciones que guarde algo.
 * Es a propósito: alguien tiene que poder preguntar "¿y si no le cobro a este
 * cliente?" cincuenta veces sin miedo a haber cambiado su contabilidad.
 *
 * ============================================================
 * LA PALANCA SE DECLARA EN LAS PALABRAS DEL DUEÑO
 * ============================================================
 *
 * `"cobro la mitad de lo que está vencido"` es una frase que alguien puede
 * evaluar. `"factor_recuperacion: 0.5"` no lo es. Cada escenario devuelve la
 * frase junto al número, porque un resultado sin la pregunta que lo produjo no
 * se puede discutir con nadie.
 *
 * ============================================================
 * LO QUE UN ESCENARIO NO PUEDE HACER
 * ============================================================
 *
 * No puede volver cobrable lo incobrable ni inventar ventas que no existen.
 * Las palancas mueven plata que ya está identificada —documentos concretos,
 * fijos concretos— o cambian FECHAS. Ninguna crea un ingreso de la nada, y el
 * día que alguien quiera una que sí lo haga, va a tener que escribir de dónde
 * sale.
 */

import { proyectarCaja, type ProyeccionCaja } from "./caja.ts";
import type { CompraHecho, FijoHecho, VentaHecho } from "../kpi/tipos.ts";

export type Entrada = {
  ventas: VentaHecho[];
  compras: CompraHecho[];
  fijos: FijoHecho[];
  hoy: string;
  saldos?: Record<string, number>;
};

/**
 * Las palancas. Cada una mueve una sola cosa: combinarlas es tarea de quien
 * llama, y así el efecto de cada una se puede leer por separado.
 */
export type Palanca =
  /** Cobrar una parte de lo que ya venció. `parte` va de 0 a 1. */
  | { tipo: "cobrar_vencido"; parte: number; en_dias: number }
  /** Estirar el pago a proveedores tantos días. */
  | { tipo: "estirar_pagos"; dias: number }
  /** Recortar los gastos fijos. `parte` va de 0 a 1. */
  | { tipo: "recortar_fijos"; parte: number }
  /** Que los clientes paguen tantos días antes (o después, con negativo). */
  | { tipo: "mover_cobros"; dias: number };

export type Escenario = {
  /** La palanca dicha como la diría el dueño. */
  pregunta: string;
  proyeccion: ProyeccionCaja[];
  /** Qué cambia respecto de no hacer nada, por moneda y a 90 días. */
  diferencia: { moneda: string; neto: number; saldo: number | null }[];
  /** Lo que este escenario da por cierto y no se puede verificar. */
  supuestos: string[];
};

function sumarDias(fecha: string, dias: number): string {
  return new Date(Date.parse(`${fecha}T00:00:00Z`) + dias * 86_400_000).toISOString().slice(0, 10);
}

function pct(parte: number): string {
  return `${Math.round(parte * 100)}%`;
}

/**
 * Aplica la palanca sobre copias de los hechos.
 *
 * Nada se muta: se devuelven arrays nuevos con objetos nuevos. Si esto mutara,
 * comparar dos escenarios seguidos daría resultados distintos según el orden
 * en que se pidieron, que es la clase de error que nadie encuentra mirando la
 * pantalla.
 */
function aplicar(e: Entrada, p: Palanca): { entrada: Entrada; pregunta: string; supuestos: string[] } {
  switch (p.tipo) {
    case "cobrar_vencido": {
      const parte = Math.min(1, Math.max(0, p.parte));
      const ventas = e.ventas.map((v) => {
        const vencido = v.vence_el !== null && v.vence_el < e.hoy;
        const saldo = Math.max(0, v.total - v.cobrado);
        if (!vencido || saldo <= 0 || v.estado !== "emitida") return { ...v };

        // Se cobra una parte, y lo que se cobra pasa a tener fecha futura: eso
        // es lo que lo devuelve al pronóstico, del que lo vencido está excluido
        // justamente por haber fallado su fecha.
        return {
          ...v,
          total: saldo * parte + v.cobrado,
          vence_el: sumarDias(e.hoy, p.en_dias),
        };
      });

      return {
        entrada: { ...e, ventas },
        pregunta: `¿Y si cobro el ${pct(parte)} de lo que está vencido, dentro de ${p.en_dias} días?`,
        supuestos: [
          `Se da por hecho que ese ${pct(parte)} entra, y no hay nada en los datos que lo respalde: es la pregunta, no una previsión.`,
          "Los clientes que no pagaron a tiempo son los mismos que tendrían que pagar ahora.",
        ],
      };
    }

    case "estirar_pagos": {
      const compras = e.compras.map((c) =>
        c.vence_el === null ? { ...c } : { ...c, vence_el: sumarDias(c.vence_el, p.dias) },
      );
      return {
        entrada: { ...e, compras },
        pregunta: `¿Y si le pido ${p.dias} días más a los proveedores?`,
        supuestos: [
          "Se asume que todos los proveedores aceptan, sin recargo ni pérdida de crédito.",
          "Estirar no reduce lo que se debe: la plata sale igual, más tarde.",
        ],
      };
    }

    case "recortar_fijos": {
      const parte = Math.min(1, Math.max(0, p.parte));
      const fijos = e.fijos.map((f) =>
        f.tipo === "gasto" ? { ...f, monto: f.monto * (1 - parte) } : { ...f },
      );
      return {
        entrada: { ...e, fijos },
        pregunta: `¿Y si recorto el ${pct(parte)} de los gastos fijos?`,
        supuestos: [
          "Se recorta parejo sobre todos los fijos. En la vida real algunos no se pueden tocar.",
          "El recorte arranca este mes y no cuesta nada hacerlo.",
        ],
      };
    }

    case "mover_cobros": {
      const ventas = e.ventas.map((v) =>
        v.vence_el === null ? { ...v } : { ...v, vence_el: sumarDias(v.vence_el, -p.dias) },
      );
      return {
        entrada: { ...e, ventas },
        pregunta:
          p.dias >= 0
            ? `¿Y si me pagan ${p.dias} días antes?`
            : `¿Y si me pagan ${-p.dias} días más tarde?`,
        supuestos: [
          p.dias >= 0
            ? "Se asume que los clientes aceptan adelantar sin pedir descuento por pronto pago."
            : "Se asume que el atraso es parejo y que ningún cliente deja de pagar.",
        ],
      };
    }
  }
}

/** Corre un escenario. No escribe nada. */
export function simular(entrada: Entrada, palanca: Palanca): Escenario {
  const base = proyectarCaja(entrada);
  const { entrada: cambiada, pregunta, supuestos } = aplicar(entrada, palanca);
  const proyeccion = proyectarCaja(cambiada);

  const ultimo = (p: ProyeccionCaja) => p.tramos[p.tramos.length - 1];
  const porMoneda = new Map(base.map((b) => [b.moneda, b]));

  const diferencia = proyeccion.map((p) => {
    const b = porMoneda.get(p.moneda);
    const antes = b ? ultimo(b) : null;
    const ahora = ultimo(p);
    return {
      moneda: p.moneda,
      neto: ahora.neto - (antes?.neto ?? 0),
      saldo:
        ahora.saldo_proyectado === null || antes?.saldo_proyectado === undefined || antes.saldo_proyectado === null
          ? null
          : ahora.saldo_proyectado - antes.saldo_proyectado,
    };
  });

  return { pregunta, proyeccion, diferencia, supuestos };
}

/**
 * Los escenarios que vale la pena ofrecer sin que nadie los pida.
 *
 * Son deliberadamente pocos y deliberadamente moderados —la mitad de lo
 * vencido, quince días más, un diez por ciento— porque un escenario optimista
 * sugerido por el sistema se lee como un consejo. Estos están para mostrar de
 * qué tamaño es cada palanca, no para recomendar tirar de ninguna.
 */
export function escenariosSugeridos(entrada: Entrada): Escenario[] {
  const base = proyectarCaja(entrada);
  const hayVencido = base.some((p) => p.vencido_sin_cobrar > 0);
  const hayFijos = entrada.fijos.some((f) => f.tipo === "gasto" && f.monto > 0);
  const hayCompras = entrada.compras.some((c) => c.estado === "registrada" && c.vence_el !== null);

  const palancas: Palanca[] = [];
  if (hayVencido) palancas.push({ tipo: "cobrar_vencido", parte: 0.5, en_dias: 30 });
  if (hayCompras) palancas.push({ tipo: "estirar_pagos", dias: 15 });
  if (hayFijos) palancas.push({ tipo: "recortar_fijos", parte: 0.1 });

  return palancas.map((p) => simular(entrada, p));
}
