import type { SystemRisk } from "./riesgo.ts";

/**
 * Qué hace el gate con una acción: recomendarla, prepararla, pedir
 * aprobación, ejecutarla o frenarla.
 *
 * ============================================================
 * POR QUÉ VIVE ACÁ Y NO EN EL HANDLER
 * ============================================================
 *
 * Estaba adentro de `lib/worker-gate-handler.ts`, que importa `next/server`,
 * y ninguna prueba de `lib/` puede importar ese archivo. Es la tercera pieza
 * que se muda por el mismo motivo, después de `SYSTEM_RISK` (`riesgo.ts`) y de
 * la huella (`huella.ts`).
 *
 * Y es la que más falta hacía. La escalera de acá abajo decide si una venta
 * se registra sola, y el presupuesto diario es lo único que frena a un modelo
 * trabado en un bucle. Ninguna de las dos tenía una sola prueba, y sus dos
 * incidentes conocidos —catorce días en nivel 1, y GUARDAR_MEMORIA terminando
 * en `recommend` desde el 18 de agosto— se encontraron usando el producto.
 *
 * Se mudó, no se copió: el handler lee la base, llama a `decidirAutonomia` y
 * escribe lo que sale. Los motivos son los mismos textos, letra por letra,
 * porque quedan guardados en `eos_autonomy_events_v12` y el worker los lee.
 */

/*
 * El perfil de quien todavía no tiene fila propia.
 *
 * Tiene que decir lo mismo que el default de la columna en la base
 * (v101, y ahora v127). Cuando dijeron cosas distintas, cinco de los seis
 * usuarios de producción corrieron catorce días en nivel 1 —que ni ejecuta
 * ni pregunta— mientras el chat les decía que sí. Si cambia uno, cambia el
 * otro.
 *
 * Los dos techos diarios subieron el 6 de septiembre de 2026. Estaban en 5
 * acciones y 10 puntos desde la v12, cuando lo más caro que se podía pedir
 * era crear un objetivo. Una venta vale 6 puntos: con presupuesto 10, la
 * PRIMERA venta del día pasaba y la segunda daba `block` —ni siquiera
 * `approval`, así que no quedaba nada que aprobar—. Desde el chat eso se ve
 * como que EOS no registra nada en el ERP, y así se reportó.
 *
 * Los números salen de un día cargado de uso conversacional —unas quince
 * ventas, tres contactos, dos ajustes de stock: 111 puntos en 20 acciones— y
 * se duplican. El techo sigue existiendo para frenar a un modelo trabado en
 * un bucle, que es para lo que sirve; dejó de frenar a alguien trabajando.
 *
 * ------------------------------------------------------------
 * EL NIVEL POR DEFECTO PASA DE 2 A 3, Y ESA ES LA DECISIÓN GRANDE
 * ------------------------------------------------------------
 *
 * En la escalera de abajo, el nivel 2 significa `approval`: la acción no se
 * ejecuta y queda esperando que la persona vaya a `/eos/autonomy` a aprobarla.
 * Como era el default, TODA acción que no fuera una de las tres del negocio
 * —guardar una memoria, crear una tarea, armar un Excel— terminaba ahí.
 *
 * En la práctica eso significa que no pasa nada. Nadie interrumpe una
 * conversación para ir a otra pantalla a autorizar que se guarde una nota, y
 * el resultado es un chat que promete y no cumple. Se reportó dos veces desde
 * el uso real, con estas palabras: "EOS no recuerda las cosas" y "cuando se le
 * pide por el chat que anote algo en el ERP y CRM no lo hace".
 *
 * El nivel 3 ejecuta, y lo que protege deja de ser una pregunta por acción
 * para ser el techo diario de acá arriba: 40 acciones y 240 puntos. Eso frena
 * a un modelo trabado en un bucle, que es el riesgo real, sin frenar a alguien
 * trabajando.
 *
 * Queda escrito qué se pierde: si el modelo entiende mal algo, ahora lo hace
 * en vez de preguntar. Es exactamente lo que el usuario pidió para las tres
 * acciones del negocio el 3 de septiembre —las más caras de equivocar— y no
 * tiene sentido ser más estricto con guardar una nota que con registrar una
 * venta.
 */
export const PERFIL_POR_DEFECTO = {
  default_level: 3,
  max_auto_actions_per_day: 40,
  max_daily_risk_points: 240,
  approval_ttl_minutes: 60,
  enabled: true,
};

export const ZONA_HORARIA_AUTONOMIA = "America/Asuncion";

export type PerfilAutonomia = {
  default_level: number;
  max_auto_actions_per_day: number;
  max_daily_risk_points: number;
  enabled: boolean;
};

/** Una fila de `eos_autonomy_rules_v12`, o nada. */
export type ReglaAutonomia =
  | {
      autonomy_level?: number | null;
      risk_tier?: number | null;
      risk_points?: number | null;
      max_auto_per_day?: number | null;
      enabled?: boolean | null;
    }
  | null
  | undefined;

/** Un `auto_allowed` de `eos_autonomy_events_v12`. */
export type EventoAutomatico = { created_at: string; detail: unknown };

export type Decision = "recommend" | "prepare" | "approval" | "allow" | "block";

export type ResultadoDecision = {
  decision: Decision;
  reason: string;
  configuredLevel: number;
  effectiveLevel: number;
  riskTier: number;
  riskPoints: number;
  autoCount: number;
  actionLimit: number;
  usedRisk: number;
  riskLimit: number;
};

/** El día calendario de un instante, en Asunción: `2026-09-12`. */
export function diaEnZonaHoraria(valor: string, zona = ZONA_HORARIA_AUTONOMIA): string {
  const partes = new Intl.DateTimeFormat("en-US", {
    timeZone: zona,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(valor));
  const valores = Object.fromEntries(partes.map((parte) => [parte.type, parte.value]));
  return `${valores.year}-${valores.month}-${valores.day}`;
}

/**
 * Desde cuándo se leen los eventos para contar el día.
 *
 * Treinta horas y no veinticuatro: el día que cuenta es el de Asunción, y la
 * consulta se filtra en UTC. Con treinta, el comienzo de la ventana cae
 * siempre en el día local anterior, así que el día de hoy entra entero a
 * cualquier hora y con cualquier desfase. Lo que sobra lo descarta
 * `decidirAutonomia` comparando días.
 */
export function inicioVentanaDiaria(ahora: Date): string {
  return new Date(ahora.getTime() - 30 * 60 * 60 * 1000).toISOString();
}

function objeto(valor: unknown): Record<string, unknown> {
  return valor && typeof valor === "object" && !Array.isArray(valor)
    ? (valor as Record<string, unknown>)
    : {};
}

export function decidirAutonomia({
  perfil,
  regla,
  riesgo,
  eventosAutomaticos,
  ahora,
}: {
  perfil: PerfilAutonomia;
  regla: ReglaAutonomia;
  riesgo: SystemRisk;
  eventosAutomaticos: EventoAutomatico[];
  ahora: Date;
}): ResultadoDecision {
  /*
   * Una regla apagada no existe; no es una regla que diga "nunca".
   *
   * Antes, `enabled: false` bajaba el nivel a 0, que en la escalera de abajo
   * significa `recommend`: la acción no se ejecuta y el usuario recibe "la
   * política permite únicamente recomendar esta acción", una frase con la
   * que no puede hacer nada.
   *
   * Eso costó caro y se encontró usando el producto. La cuenta del plan
   * Business tenía tres reglas apagadas —GUARDAR_MEMORIA entre ellas— y por
   * eso EOS no guardó una sola memoria desde el 18 de agosto. Cuando el
   * usuario preguntó "¿en serio no recordás nada de mi negocio?", la
   * respuesta era correcta: no había nada guardado, porque cada intento
   * terminaba en `recommend`.
   *
   * Y nadie lo eligió: **ninguna ruta ni pantalla del producto escribe en
   * `eos_autonomy_rules_v12`.** Esas filas son restos de pruebas, y no hay
   * forma de apagarlas desde la aplicación. Un interruptor que solo se puede
   * prender desde afuera no puede ser el que decide si EOS recuerda.
   *
   * Ahora una regla apagada se ignora ENTERA —nivel, tope diario y riesgo—
   * y manda el perfil. Si algún día hace falta "nunca hagas esta acción",
   * eso es un `block` con su propio motivo, no un booleano que produce el
   * fallo más silencioso posible.
   */
  const reglaVigente = regla?.enabled === false ? null : (regla ?? null);

  const configuredLevel = Number(
    reglaVigente?.autonomy_level ?? riesgo.defaultLevelOverride ?? perfil.default_level,
  );
  const effectiveLevel = Math.min(configuredLevel, riesgo.maxLevel);
  const riskTier = Math.max(riesgo.tier, Number(reglaVigente?.risk_tier ?? 0));
  const riskPoints = Math.max(riesgo.points, Number(reglaVigente?.risk_points ?? 0));

  const hoy = diaEnZonaHoraria(ahora.toISOString());
  const deHoy = eventosAutomaticos.filter((evento) => diaEnZonaHoraria(evento.created_at) === hoy);
  const autoCount = deHoy.length;
  const usedRisk = deHoy.reduce((total, evento) => {
    const puntos = Number(objeto(evento.detail).risk_points || 0);
    return total + (Number.isFinite(puntos) ? puntos : 0);
  }, 0);

  const actionLimit =
    reglaVigente?.max_auto_per_day === null || reglaVigente?.max_auto_per_day === undefined
      ? Number(perfil.max_auto_actions_per_day)
      : Math.min(Number(perfil.max_auto_actions_per_day), Number(reglaVigente.max_auto_per_day));
  const riskLimit = Number(perfil.max_daily_risk_points);

  let decision: Decision;
  let reason: string;

  if (!perfil.enabled) {
    decision = "recommend";
    reason = "La autonomía está desactivada para este usuario.";
  } else if (!Number.isInteger(effectiveLevel) || !Number.isFinite(riskTier)) {
    /*
     * Un nivel que no se puede leer frena. No ejecuta.
     *
     * Sin esta rama, un `NaN` no es `<= 0`, ni `=== 1`, ni `=== 2`, así que
     * atravesaba la escalera entera y terminaba en `allow`: el caso en que el
     * gate no sabe qué hacer era exactamente el caso en que ejecutaba. Hoy no
     * es alcanzable —las columnas son NOT NULL y el perfil por defecto rellena
     * lo que falta—, pero un gate no puede depender de que lo de afuera nunca
     * cambie.
     */
    decision = "block";
    reason = "No se pudo determinar el nivel de autonomía de esta acción; se frena por seguridad.";
  } else if (effectiveLevel <= 0) {
    decision = "recommend";
    reason = "La política permite únicamente recomendar esta acción.";
  } else if (effectiveLevel === 1) {
    decision = "prepare";
    reason = "EOS puede preparar la acción, pero no ejecutar el efecto secundario.";
  } else if (effectiveLevel === 2 || (riskTier >= 2 && riesgo.forceApproval !== false)) {
    decision = "approval";
    reason =
      riskTier >= 2 && riesgo.forceApproval !== false
        ? "El riesgo mínimo de sistema exige aprobación explícita."
        : "La configuración del usuario exige aprobación explícita.";
  } else if (
    !Number.isFinite(actionLimit) ||
    !Number.isFinite(riskLimit) ||
    !Number.isFinite(riskPoints)
  ) {
    // Mismo agujero que el nivel: `autoCount >= NaN` y `x > NaN` dan false,
    // y un techo ilegible se convertía en ningún techo.
    decision = "block";
    reason = "No se pudo leer el límite diario de autonomía; se frena por seguridad.";
  } else if (autoCount >= actionLimit) {
    decision = "block";
    reason = "Se alcanzó el límite diario de acciones automáticas.";
  } else if (usedRisk + riskPoints > riskLimit) {
    decision = "block";
    reason = "La acción superaría el presupuesto diario de riesgo automático.";
  } else {
    decision = "allow";
    reason = "La acción está dentro del nivel, riesgo y límites permitidos.";
  }

  return {
    decision,
    reason,
    configuredLevel,
    effectiveLevel,
    riskTier,
    riskPoints,
    autoCount,
    actionLimit,
    usedRisk,
    riskLimit,
  };
}
