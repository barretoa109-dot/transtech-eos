import { ETAPAS, esEtapa, type EscalaDeEtapas, type Etapa } from "./embudo.ts";

/**
 * Las etapas del embudo, configurables por cada empresa.
 *
 * ============================================================
 * QUÉ SE PUEDE CONFIGURAR Y QUÉ NO
 * ============================================================
 *
 * Las seis etapas (nueva, contactado, propuesta, negociación, ganada, perdida) son
 * un CONTRATO: los indicadores del CRM, el trigger que gana una oportunidad cuando
 * se registra una venta y el aviso de oportunidades estancadas dependen de esos
 * códigos. Agregar una etapa nueva rompería los tres sin que nada lo avise.
 *
 * Lo que cada empresa SÍ puede cambiar, sin romper nada:
 *
 *   · cómo se LLAMA cada etapa ("Propuesta" → "Presupuesto enviado"),
 *   · en qué ORDEN se muestran las intermedias,
 *   · cuáles se muestran (se puede ocultar "Contactado" si no lo usa),
 *   · qué PROBABILIDAD lleva cada etapa en el pronóstico.
 *
 * "Ganada" y "perdida" no se ocultan, no se reordenan y no cambian de probabilidad:
 * son el final del camino y valen 100 y 0 por definición. Sí se les puede cambiar el
 * nombre.
 *
 * Todo esto es puro: no lee la base ni el reloj.
 */

export type FilaConfig = {
  etapa: string;
  etiqueta: string;
  orden: number;
  visible: boolean;
  probabilidad_defecto: number | null;
};

export type EtapaConfigurada = {
  clave: Etapa;
  etiqueta: string;
  orden: number;
  visible: boolean;
  /** De 0 a 1, la que efectivamente se usa en el pronóstico. */
  probabilidad: number;
  /** ¿La empresa cambió algo de esta etapa respecto de la de fábrica? */
  personalizada: boolean;
};

const FINALES = new Set<Etapa>(["ganada", "perdida"]);
const MAX_ETIQUETA = 40;

/** Las seis etapas, con lo que configuró la empresa encima de lo de fábrica. */
export function combinarConfig(filas: FilaConfig[] = []): EtapaConfigurada[] {
  const porEtapa = new Map(filas.filter((f) => esEtapa(f.etapa)).map((f) => [f.etapa as Etapa, f]));

  const combinadas = ETAPAS.map((fabrica, indice): EtapaConfigurada => {
    const f = porEtapa.get(fabrica.clave);
    const final = FINALES.has(fabrica.clave);

    // Las finales quedan siempre al final y siempre visibles, digan lo que digan las filas.
    const orden = final ? 900 + indice : Number.isInteger(f?.orden) ? (f!.orden as number) : indice;
    const visible = final ? true : f ? f.visible !== false : true;
    const probabilidad = final
      ? fabrica.probabilidad
      : typeof f?.probabilidad_defecto === "number"
        ? Math.min(1, Math.max(0, f.probabilidad_defecto / 100))
        : fabrica.probabilidad;
    const etiqueta = (f?.etiqueta ?? "").trim() || fabrica.etiqueta;

    return {
      clave: fabrica.clave,
      etiqueta,
      orden,
      visible,
      probabilidad,
      personalizada: Boolean(
        f && (etiqueta !== fabrica.etiqueta || orden !== indice || visible === false || probabilidad !== fabrica.probabilidad),
      ),
    };
  });

  return combinadas.sort((a, b) => a.orden - b.orden);
}

/** La escala de probabilidades que usa el pronóstico. */
export function escalaDe(config: EtapaConfigurada[]): EscalaDeEtapas {
  return Object.fromEntries(config.map((e) => [e.clave, e.probabilidad])) as EscalaDeEtapas;
}

export type ValidacionConfig = { ok: true; filas: FilaConfig[] } | { ok: false; error: string };

/** Lo que llega del formulario → las filas que se guardan. */
export function validarConfig(cuerpo: unknown): ValidacionConfig {
  const lista = (cuerpo && typeof cuerpo === "object" ? (cuerpo as { etapas?: unknown }).etapas : null) as unknown;

  if (!Array.isArray(lista) || lista.length === 0) {
    return { ok: false, error: "No llegó ninguna etapa para guardar." };
  }

  const filas = new Map<Etapa, FilaConfig>();

  for (const item of lista) {
    const i = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;

    if (!esEtapa(i.etapa)) return { ok: false, error: "Hay una etapa que no existe. Las etapas son fijas." };
    if (filas.has(i.etapa)) return { ok: false, error: "Una etapa vino repetida." };

    const etiqueta = String(i.etiqueta ?? "").trim();
    if (etiqueta.length < 1 || etiqueta.length > MAX_ETIQUETA) {
      return { ok: false, error: `El nombre de una etapa va de 1 a ${MAX_ETIQUETA} caracteres.` };
    }
    // Sin caracteres de control: un nombre de etapa se muestra en pantalla y en mensajes.
    if ([...etiqueta].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)) {
      return { ok: false, error: "Un nombre de etapa tiene caracteres que no se pueden mostrar." };
    }

    let probabilidad: number | null = null;
    if (i.probabilidad !== null && i.probabilidad !== undefined && i.probabilidad !== "") {
      const n = Number(i.probabilidad);
      if (!Number.isInteger(n) || n < 0 || n > 100) {
        return { ok: false, error: "La probabilidad de una etapa va de 0 a 100." };
      }
      probabilidad = n;
    }

    const orden = i.orden === undefined ? 0 : Number(i.orden);
    if (!Number.isInteger(orden) || orden < 0 || orden > 50) {
      return { ok: false, error: "El orden de una etapa es un número de 0 a 50." };
    }

    const final = FINALES.has(i.etapa);

    filas.set(i.etapa, {
      etapa: i.etapa,
      etiqueta,
      orden: final ? 900 : orden,
      // Las finales no se ocultan ni cambian su probabilidad: es el fin del camino.
      visible: final ? true : i.visible !== false,
      probabilidad_defecto: final ? null : probabilidad,
    });
  }

  // Dos etapas visibles con el mismo nombre no se pueden distinguir en la pantalla.
  const nombres = [...filas.values()].filter((f) => f.visible).map((f) => f.etiqueta.toLowerCase());
  if (new Set(nombres).size !== nombres.length) {
    return { ok: false, error: "Dos etapas tienen el mismo nombre: no se podrían distinguir en el embudo." };
  }

  // Al menos una intermedia visible: sin ninguna, una oportunidad nueva no tendría dónde caer.
  const intermedias = [...filas.values()].filter((f) => !FINALES.has(f.etapa as Etapa) && f.visible);
  if (intermedias.length === 0) {
    return { ok: false, error: "Tiene que quedar al menos una etapa visible además de ganada y perdida." };
  }

  return { ok: true, filas: [...filas.values()] };
}
