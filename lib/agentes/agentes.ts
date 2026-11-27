/**
 * El equipo de agentes de EOS (plan del 27/11/2026, docs/agentes/).
 *
 * Esta lista tiene que coincidir con las filas de `agentes.agent_config` de la
 * v267 y con los roles `agente_<nombre>`. Un test lo verifica.
 */

export const AGENTES = ["reportes", "cobranza", "activacion", "soporte", "retencion", "contenido"] as const;

export type Agente = (typeof AGENTES)[number];

export function esAgente(valor: unknown): valor is Agente {
  return typeof valor === "string" && (AGENTES as readonly string[]).includes(valor);
}

/**
 * La variable de entorno con la conexión del agente a la base, con SU rol.
 * Ejemplo: `AGENTE_COBRANZA_DB_URL`. Nunca la service role.
 */
export function variableDeConexion(agente: Agente): string {
  return `AGENTE_${agente.toUpperCase()}_DB_URL`;
}

export type Canal = "email" | "whatsapp" | "push" | "app";
export type Prioridad = "urgente" | "normal";
export type Disparador = "cron" | "evento" | "manual";
