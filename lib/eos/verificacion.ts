/**
 * Qué pasó DE VERDAD con lo que el usuario pidió.
 *
 * ============================================================
 * EL BUG QUE ESTE ARCHIVO EXISTE PARA MATAR
 * ============================================================
 *
 * Hasta el 9 de septiembre de 2026, `app/api/eos/route.ts` decidía si algo
 * había quedado guardado mirando si existía una APROBACIÓN PENDIENTE:
 *
 *     if (requiereAprobacion(acciones)) {
 *       ...buscar en eos_action_approvals_v12...
 *       if (!hay) respuesta = AVISO_SIN_APROBACION + respuesta
 *     }
 *
 * Eso fue cierto exactamente hasta el 3 de septiembre. Ese día
 * `lib/autonomia/riesgo.ts` pasó las acciones del negocio a
 * `forceApproval: false` con `defaultLevelOverride: 3` —el usuario pidió
 * "auto-aprobar todo lo que venga del chat, sin excepción"— y desde entonces
 * una venta que sale BIEN no deja ninguna aprobación pendiente, porque no
 * necesita ninguna.
 *
 * Resultado: toda venta registrada con éxito venía coronada con
 *
 *     ⚠️ No llegué a dejarlo listo. […] no se guardó nada.
 *       Cargalo desde la sección Negocio y ahí sí queda.
 *
 * Es la inversa exacta de la falla que `corregirAfirmacionSinAccion` vino a
 * arreglar: ahí EOS decía haber hecho algo que no hizo; acá dice NO haber
 * hecho algo que sí hizo. Las dos destruyen lo mismo —poder creerle sin ir a
 * verificar— y la segunda además empuja a cargar a mano una venta que ya está
 * cargada, o sea a duplicarla.
 *
 * ============================================================
 * LA EVIDENCIA YA VENÍA, Y SE TIRABA
 * ============================================================
 *
 * El nodo `08 GW Agregar Resultados Worker` de n8n —y su puerto
 * `lib/gateway/resultados.ts`— devuelven desde siempre:
 *
 *     worker: { ok, resultados, acciones_ejecutadas,
 *               acciones_idempotentes, errores: [{accion, error}] }
 *
 * `normalizarRespuestaN8N` no lo leía. La respuesta tenía la verdad adentro y
 * se descartaba en el camino, para después deducirla mal de otra tabla.
 *
 * ============================================================
 * LA REGLA
 * ============================================================
 *
 * Cada acción con efecto durable que el modelo pidió termina en uno de estos
 * cinco estados, y ninguno se infiere de la ausencia de otra cosa:
 *
 *   ejecutada             el worker la hizo en este mensaje
 *   repetida              ya estaba hecha; no se repitió el efecto
 *   fallida               se intentó y no se pudo, con su motivo
 *   pendiente_aprobacion  quedó esperando que la persona la apruebe
 *   sin_evidencia         nadie reportó nada — y SOLO acá se avisa que no
 *                         quedó guardado, porque solo acá es cierto
 *
 * "Sin evidencia" no es teórico: es lo que pasaba cuando el Worker Gate no
 * conocía una acción y la rechazaba en la puerta. Por eso el aviso se
 * conserva; lo que cambia es que ahora aparece cuando corresponde.
 */

import { ACCIONES_CON_RIESGO } from "../autonomia/riesgo.ts";

/** Las que no dejan nada escrito: preguntar por ellas no tiene sentido. */
export const ACCIONES_SIN_EFECTO = new Set(["RESPONDER", "VER_DASHBOARD", "VER_BRIEFING"]);

/**
 * Todo lo demás deja algo: una fila, un archivo, una venta.
 *
 * Se deriva de `SYSTEM_RISK` y no se escribe a mano. Es el mismo problema de
 * los nueve lugares donde hay que dar de alta una acción: la lista escrita a
 * mano en `acciones-chat.ts` tenía tres de doce, así que nueve acciones —una
 * compra, un pago de deuda, una corrección— no se verificaban en absoluto.
 */
export const ACCIONES_DURABLES = new Set(
  [...ACCIONES_CON_RIESGO].filter((accion) => !ACCIONES_SIN_EFECTO.has(accion)),
);

export type EstadoDeAccion =
  | "ejecutada"
  | "repetida"
  | "fallida"
  | "pendiente_aprobacion"
  | "sin_evidencia";

/** Lo que el worker contó de este mensaje. */
export type EvidenciaWorker = {
  /** `false` cuando el cuerpo no traía bloque `worker` en absoluto. */
  informado: boolean;
  ejecutadas: string[];
  idempotentes: string[];
  errores: { accion: string; error: string }[];
};

export type VerificacionDeAccion = {
  accion: string;
  estado: EstadoDeAccion;
  motivo: string;
};

export const SIN_EVIDENCIA: EvidenciaWorker = {
  informado: false,
  ejecutadas: [],
  idempotentes: [],
  errores: [],
};

function normalizar(valor: unknown): string {
  return String(valor ?? "").trim().toUpperCase();
}

function textos(valor: unknown): string[] {
  return Array.isArray(valor) ? valor.map(normalizar).filter(Boolean) : [];
}

/**
 * Lee el bloque `worker` del cuerpo que devolvió n8n o el gateway propio.
 *
 * Tolerante a propósito: si el bloque no vino, `informado` queda en `false` y
 * quien llama sabe que no puede afirmar nada. Un cuerpo raro no puede hacer
 * que EOS invente que registró una venta.
 */
export function leerEvidencia(valor: unknown): EvidenciaWorker {
  if (!valor || typeof valor !== "object" || Array.isArray(valor)) return SIN_EVIDENCIA;

  const w = valor as Record<string, unknown>;

  const errores = Array.isArray(w.errores)
    ? w.errores
        .map((e) => {
          const registro = (e && typeof e === "object" ? e : {}) as Record<string, unknown>;
          return {
            accion: normalizar(registro.accion),
            error: typeof registro.error === "string" ? registro.error.trim() : "",
          };
        })
        .filter((e) => e.accion || e.error)
    : [];

  return {
    informado: true,
    ejecutadas: textos(w.acciones_ejecutadas),
    idempotentes: textos(w.acciones_idempotentes),
    errores,
  };
}

/**
 * Un estado por cada acción con efecto durable que el modelo pidió.
 *
 * El orden importa y no es arbitrario:
 *
 *   1. ejecutada  — es lo único que autoriza a hablar en pasado.
 *   2. repetida   — se hizo antes; contarla como nueva sería contarla dos veces.
 *   3. fallida    — se intentó y no se pudo, con su motivo, que es lo único
 *                   accionable que trae el error.
 *   4. pendiente  — el gate pidió aprobación explícita.
 *   5. sin nada   — nadie reportó. El único caso donde se puede decir que no
 *                   quedó guardado.
 */
export function verificarAcciones(
  acciones: { tipo?: unknown }[],
  evidencia: EvidenciaWorker,
  hayAprobacionPendiente: boolean,
): VerificacionDeAccion[] {
  const durables = acciones
    .map((a) => normalizar(a?.tipo))
    .filter((tipo) => ACCIONES_DURABLES.has(tipo));

  // Sin repetir: dos ítems de la misma acción no son dos preguntas distintas.
  const unicas = [...new Set(durables)];

  return unicas.map((accion): VerificacionDeAccion => {
    if (evidencia.ejecutadas.includes(accion)) {
      return { accion, estado: "ejecutada", motivo: "" };
    }

    if (evidencia.idempotentes.includes(accion)) {
      return { accion, estado: "repetida", motivo: "" };
    }

    const error = evidencia.errores.find((e) => e.accion === accion);
    if (error) {
      return { accion, estado: "fallida", motivo: error.error };
    }

    /*
     * Un error sin acción tampoco se ignora.
     *
     * El worker puede fallar antes de saber de qué acción se trataba —un
     * timeout, un cuerpo ilegible— y ahí `accion` viene vacía. Atribuirlo a la
     * única acción del mensaje es correcto; con varias no se puede saber cuál
     * falló, y entonces vale para todas: ninguna se puede dar por hecha.
     */
    const anonimo = evidencia.errores.find((e) => !e.accion);
    if (anonimo) {
      return { accion, estado: "fallida", motivo: anonimo.error };
    }

    if (hayAprobacionPendiente) {
      return { accion, estado: "pendiente_aprobacion", motivo: "" };
    }

    return { accion, estado: "sin_evidencia", motivo: "" };
  });
}

/** ¿Alguna acción quedó realmente escrita? Es lo que autoriza a hablar en pasado. */
export function huboEfecto(verificaciones: VerificacionDeAccion[]): boolean {
  return verificaciones.some((v) => v.estado === "ejecutada" || v.estado === "repetida");
}
