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

/**
 * El embudo, una vez por moneda.
 *
 * ============================================================
 * POR QUÉ NO PUEDE HABER UN SOLO "EN JUEGO"
 * ============================================================
 *
 * El resumen sumaba `monto` de todas las oportunidades sin mirar la moneda, y
 * la pantalla etiquetaba el resultado con la moneda de la PRIMERA de la lista.
 * Con una oportunidad de USD 10.000 y otra de Gs. 5.000.000, el embudo decía
 * "en juego Gs. 5.010.000" — un número que no existe en ninguna moneda y que
 * nadie puede detectar mirándolo.
 *
 * Es el mismo error que el panel financiero ya corrigió por su lado. La regla
 * es una sola y vale para todo EOS: **un total pertenece a una moneda.** Si hay
 * dos monedas hay dos totales, uno debajo del otro, cada uno con su símbolo.
 *
 * El orden no es alfabético ni por monto: primero la moneda del negocio, para
 * que lo que el usuario mira todos los días esté siempre arriba.
 */
export type OportunidadConMoneda = OportunidadResumen & { moneda: string };

export type EmbudoDeMoneda = {
  moneda: string;
  abiertas: number;
  en_juego: number;
  esperado: number;
  ganadas: number;
  ganado: number;
  por_etapa: ReturnType<typeof porEtapa>;
};

export function embudoPorMoneda(
  oportunidades: OportunidadConMoneda[],
  principal = "PYG",
): EmbudoDeMoneda[] {
  const monedas = [...new Set(oportunidades.map((o) => o.moneda))];

  monedas.sort((a, b) => {
    if (a === principal) return -1;
    if (b === principal) return 1;
    return a.localeCompare(b);
  });

  return monedas.map((moneda) => {
    const suyas = oportunidades.filter((o) => o.moneda === moneda);
    const abiertas = suyas.filter((o) => o.etapa !== "ganada" && o.etapa !== "perdida");
    const ganadas = suyas.filter((o) => o.etapa === "ganada");

    return {
      moneda,
      abiertas: abiertas.length,
      en_juego: Math.round(abiertas.reduce((t, o) => t + o.monto, 0)),
      esperado: valorPonderado(suyas),
      ganadas: ganadas.length,
      ganado: Math.round(ganadas.reduce((t, o) => t + o.monto, 0)),
      por_etapa: porEtapa(suyas),
    };
  });
}
