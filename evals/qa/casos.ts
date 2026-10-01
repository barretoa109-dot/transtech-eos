/**
 * Casos de QA con modelo: pocos y críticos (ver qa-con-tope.mts).
 *
 * INC-19 viene de la conversación de un cliente de la beta, ANONIMIZADA: sin
 * nombre ni montos reales. Lo que vino de una transcripción de voz dudosa
 * (pares de zapatos, marcas) NO está acá como dato: no se sabe con certeza.
 */
import { textoContexto, type ContextoNegocio } from "../../lib/eos/contexto-negocio.ts";
import { FRASES, contextoDe, type Turno } from "../bateria/frases.ts";

export type CasoQA = {
  id: string;
  critico: boolean;
  mensaje: string;
  contexto: string;
  historial?: Turno[];
  evaluar: (verbos: string[], texto: string, acciones?: { tipo: string; datos: Record<string, unknown> }[]) => { ok: boolean; motivo: string };
};

const PERSONAL: ContextoNegocio = {
  personal: [{ ingresos_mes: 0, gastos_mes: 1200000, neto_mes: -1200000, moneda: "PYG" }],
  posicion: {
    deudas: [
      { acreedor: "Préstamo del celular", saldo: 2400000, cuota: 400000, dia: 5, moneda: "PYG" },
      { acreedor: "Préstamo de la moto", saldo: 6000000, cuota: 650000, dia: 10, moneda: "PYG" },
    ],
  },
} as ContextoNegocio;

const MEMORIA = [
  "Lo que te contó y quedó guardado:",
  "- Prioridad: los préstamos del celular y de la moto van primero, porque se los descuentan cada mes.",
  "- Ingreso: sueldo base de ₲ 3.000.000 más comisiones y horas extra; lo variable cambia cada mes.",
].join("\n");

const REGISTROS = /^(REGISTRAR_|CORREGIR_|ANULAR_|DECLARAR_SALDO|CREAR_PRODUCTO|AJUSTAR_STOCK)/;

function primero(texto: string, a: RegExp, b: RegExp): boolean {
  const ia = texto.search(a);
  const ib = texto.search(b);
  return ia >= 0 && (ib < 0 || ia < ib);
}

function resultado(fallas: string[]) {
  return { ok: fallas.length === 0, motivo: fallas.join("; ") };
}

const VAGO = /lo analizo|lo voy a analizar|te aviso (despu|luego|m[aá]s tarde)|m[aá]s adelante lo vemos/i;

export const CASOS_QA: CasoQA[] = [
  {
    id: "asesoria-prioridad-prestamos",
    critico: true,
    contexto: textoContexto(PERSONAL),
    mensaje:
      "Tengo que arreglar el aire acondicionado y la moto, pero para mí los dos préstamos, el del celular y el de la moto, son prioridad porque me los descuentan todos los meses. Ayudame a ordenar este mes.",
    evaluar(verbos, texto) {
      const f: string[] = [];
      if (!verbos.includes("GUARDAR_MEMORIA")) f.push("no guardó la prioridad");
      if (verbos.some((v) => REGISTROS.test(v))) f.push(`registró algo: ${verbos.join(",")}`);
      if (verbos.includes("CREAR_TAREA")) f.push("creó tareas sin que las pida");
      if (!primero(texto, /pr[eé]stamo|cuota/i, /arregl|repar|aire|mec[aá]nic/i)) f.push("no puso los préstamos primero");
      if (VAGO.test(texto)) f.push("promesa vaga");
      return resultado(f);
    },
  },
  {
    id: "asesoria-ingreso-variable",
    critico: true,
    contexto: textoContexto(PERSONAL),
    mensaje:
      "Cobro un sueldo base de 3 millones y encima comisiones y horas extra, pero eso cambia cada mes. Armame cómo repartir la plata del mes.",
    evaluar(verbos, texto) {
      const f: string[] = [];
      if (!verbos.includes("GUARDAR_MEMORIA")) f.push("no guardó cómo se compone el ingreso");
      if (verbos.some((v) => REGISTROS.test(v))) f.push(`registró algo: ${verbos.join(",")}`);
      if (!/3\.000\.000|3 millones/i.test(texto)) f.push("no armó el plan sobre la base de 3.000.000");
      if (/(ingreso|sueldo|cobr[aá]s)[^.\n]{0,25}₲ ?[4-9]\.\d{3}\.\d{3}/i.test(texto)) f.push("supuso un ingreso fijo mayor que la base");
      if (!/variable|comisi|extra/i.test(texto)) f.push("no separó lo variable");
      return resultado(f);
    },
  },
  {
    id: "asesoria-sin-base",
    critico: false,
    contexto: textoContexto(PERSONAL),
    mensaje: "Gano con comisiones y horas extra, a veces más y a veces menos. ¿Cuánto puedo ahorrar por mes?",
    evaluar(verbos, texto) {
      const f: string[] = [];
      if (verbos.some((v) => REGISTROS.test(v))) f.push(`registró algo: ${verbos.join(",")}`);
      if (!/\?/.test(texto) || !/(fij|base|segur|m[ií]nimo|peor mes)/i.test(texto)) f.push("no preguntó la parte segura");
      if (/(sueldo|ingreso)[^.\n]{0,20}(de|es) ₲ ?\d/i.test(texto)) f.push("inventó un sueldo");
      return resultado(f);
    },
  },
  {
    id: "asesoria-recuerda-prioridad",
    critico: true,
    contexto: [textoContexto(PERSONAL), MEMORIA].join("\n\n"),
    mensaje: "Armame el plan de pagos de este mes, también tengo que arreglar la moto.",
    evaluar(verbos, texto) {
      const f: string[] = [];
      if (verbos.some((v) => REGISTROS.test(v))) f.push(`registró algo: ${verbos.join(",")}`);
      if (/cu[aá]l es tu prioridad|qu[eé] (va|quer[eé]s pagar) primero|cu[aá]nto (cobr|gan)[aá]s/i.test(texto)) f.push("volvió a preguntar lo que ya sabe");
      if (!primero(texto, /pr[eé]stamo|cuota/i, /arregl|repar|mec[aá]nic/i)) f.push("no puso los préstamos primero");
      if (VAGO.test(texto)) f.push("promesa vaga");
      return resultado(f);
    },
  },
  // Regresiones: que las reglas nuevas no rompan lo que ya andaba.
  ...["green-varias-cosas", "venta-simple"].map((id): CasoQA => {
    const frase = FRASES.find((x) => x.id === id);
    if (!frase) throw new Error(`no existe la frase ${id}`);
    return {
      id: `regresion-${id}`,
      critico: true,
      contexto: contextoDe(frase),
      historial: frase.historial,
      mensaje: frase.mensaje,
      evaluar(verbos) {
        const conjunto = [...new Set(verbos.filter((v) => v !== "RESPONDER"))].sort().join("+");
        const ok = frase.esperado.some((e) => [...e].sort().join("+") === conjunto);
        const prohibido = (frase.prohibido ?? []).filter((p) => verbos.includes(p));
        return resultado([
          ...(ok ? [] : [`esperaba ${frase.esperado.map((e) => e.join("+") || "nada").join(" o ")}, vino ${conjunto || "nada"}`]),
          ...prohibido.map((p) => `prohibido: ${p}`),
        ]);
      },
    };
  }),
];
