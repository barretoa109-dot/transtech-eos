/**
 * El embudo de ventas, con cinco etapas y no con diez.
 *
 * ============================================================
 * POR QUÉ CINCO
 * ============================================================
 *
 * Un embudo de diez etapas se abandona. Nadie mueve tarjetas todos los días, y
 * un embudo desactualizado miente peor que no tener ninguno: muestra
 * oportunidades "en negociación" que se perdieron hace tres meses, y el usuario
 * planifica sobre plata que no va a entrar.
 *
 * Con cinco, mover una tarjeta es una decisión de verdad y el estado del embudo
 * dice algo. Cada etapa contesta una pregunta distinta:
 *
 *   nueva        · apareció, todavía no hablamos
 *   contactado   · hablamos, no sabemos si va
 *   propuesta    · le pasamos precio
 *   negociacion  · está discutiendo el precio, o sea que quiere
 *   ganada/perdida · terminó
 *
 * ============================================================
 * LA PROBABILIDAD NO SE PIDE, SE DEDUCE
 * ============================================================
 *
 * Los CRM piden que el usuario asigne un porcentaje a cada oportunidad. Nadie
 * lo mantiene, y a los dos meses todas dicen 50%. Acá la probabilidad sale de
 * la etapa: es menos precisa y es la única que se mantiene sola.
 *
 * Los números no son una estimación estadística —no hay historia todavía para
 * eso— sino una escala honesta: sirven para ORDENAR y para no confundir "hay
 * cien millones en el embudo" con "van a entrar cien millones".
 */

export type Etapa = "nueva" | "contactado" | "propuesta" | "negociacion" | "ganada" | "perdida";

export const ETAPAS: { clave: Etapa; etiqueta: string; probabilidad: number }[] = [
  { clave: "nueva", etiqueta: "Nueva", probabilidad: 0.1 },
  { clave: "contactado", etiqueta: "Contactado", probabilidad: 0.25 },
  { clave: "propuesta", etiqueta: "Propuesta", probabilidad: 0.5 },
  { clave: "negociacion", etiqueta: "Negociación", probabilidad: 0.75 },
  { clave: "ganada", etiqueta: "Ganada", probabilidad: 1 },
  { clave: "perdida", etiqueta: "Perdida", probabilidad: 0 },
];

const POR_CLAVE = new Map(ETAPAS.map((e) => [e.clave, e]));

export function esEtapa(valor: unknown): valor is Etapa {
  return typeof valor === "string" && POR_CLAVE.has(valor as Etapa);
}

export function etiquetaDeEtapa(etapa: string): string {
  return POR_CLAVE.get(etapa as Etapa)?.etiqueta ?? etapa;
}

export function probabilidadDe(etapa: string): number {
  return POR_CLAVE.get(etapa as Etapa)?.probabilidad ?? 0;
}

/** La etapa que sigue en el camino normal. Ganada y perdida no siguen. */
export function siguienteEtapa(etapa: string): Etapa {
  const orden: Etapa[] = ["nueva", "contactado", "propuesta", "negociacion", "ganada"];
  const i = orden.indexOf(etapa as Etapa);

  if (i < 0 || i === orden.length - 1) return "ganada";
  return orden[i + 1];
}

export type OportunidadResumen = {
  monto: number;
  etapa: string;
};

/**
 * Lo que razonablemente va a entrar, no lo que suma el embudo.
 *
 * Es la diferencia entre "hay cien millones en juego" —que es cierto y no
 * significa nada— y "esperá unos treinta". Un embudo que se lee como caja
 * futura hace gastar plata que todavía no existe, que es exactamente lo que el
 * panel financiero de EOS trata de evitar.
 */
export function valorPonderado(oportunidades: OportunidadResumen[]): number {
  const abiertas = oportunidades.filter((o) => o.etapa !== "ganada" && o.etapa !== "perdida");

  return Math.round(abiertas.reduce((total, o) => total + o.monto * probabilidadDe(o.etapa), 0));
}

/** Cuántas hay en cada etapa, en el orden del embudo. */
export function porEtapa(
  oportunidades: OportunidadResumen[],
): { clave: Etapa; etiqueta: string; cantidad: number; monto: number }[] {
  return ETAPAS.map((etapa) => {
    const suyas = oportunidades.filter((o) => o.etapa === etapa.clave);

    return {
      clave: etapa.clave,
      etiqueta: etapa.etiqueta,
      cantidad: suyas.length,
      monto: Math.round(suyas.reduce((t, o) => t + o.monto, 0)),
    };
  });
}
