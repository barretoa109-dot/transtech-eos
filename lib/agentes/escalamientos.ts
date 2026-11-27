import { escaparHtml, envolverEmailDeMarca } from "../email/marca.ts";

/**
 * Cómo le llegan al dueño los casos que escalan los agentes.
 *
 * Decisión del dueño (27/11/2026): los urgentes por push a su iPhone y por
 * correo, al momento; los normales, en un correo diario a las 18:00 de
 * Asunción. Este archivo es puro: arma los textos. La ruta
 * `/api/cron/agentes-escalamientos` los manda.
 *
 * El push se lee con el teléfono bloqueado: lleva el agente y el motivo,
 * nunca datos de la persona. El correo lleva además el contexto resumido que
 * dejó el agente (contadores e ids, no movimientos).
 */

export type Escalamiento = {
  id: string;
  agente: string;
  usuario_id: string | null;
  motivo: string;
  prioridad: "urgente" | "normal";
  contexto: Record<string, unknown>;
  creado_en: string;
};

const NOMBRES: Record<string, string> = {
  reportes: "Reportes",
  cobranza: "Cobranza",
  activacion: "Activación",
  soporte: "Soporte",
  retencion: "Retención",
  contenido: "Contenido",
};

export const nombreDelAgente = (agente: string) => NOMBRES[agente] ?? agente;

function hora(iso: string): string {
  return new Intl.DateTimeFormat("es-PY", {
    timeZone: "America/Asuncion",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(iso));
}

function contextoEnTexto(contexto: Record<string, unknown>): string {
  const pares = Object.entries(contexto ?? {}).slice(0, 8);
  if (pares.length === 0) return "";
  return pares.map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`.slice(0, 200)).join(" · ");
}

export function avisoPush(casos: Escalamiento[]): { titulo: string; cuerpo: string; url: string } {
  const primero = casos[0];
  return {
    titulo: casos.length === 1 ? `EOS · ${nombreDelAgente(primero.agente)} escaló un caso` : `EOS · ${casos.length} casos urgentes`,
    cuerpo: casos.length === 1 ? primero.motivo.slice(0, 120) : casos.map((c) => nombreDelAgente(c.agente)).join(", "),
    url: "/admin/agentes",
  };
}

export function correoDeEscalamientos(
  casos: Escalamiento[],
  { urgentes, baseUrl }: { urgentes: boolean; baseUrl: string },
): { asunto: string; texto: string; html: string } {
  const enlace = `${baseUrl.replace(/\/$/, "")}/admin/agentes`;
  const asunto = urgentes
    ? `Urgente: ${casos.length === 1 ? `${nombreDelAgente(casos[0].agente)} — ${casos[0].motivo}` : `${casos.length} casos de los agentes`}`
    : `Agentes: ${casos.length} ${casos.length === 1 ? "caso" : "casos"} para revisar hoy`;

  const lineas = casos.map((c) => {
    const ctx = contextoEnTexto(c.contexto);
    return `· [${nombreDelAgente(c.agente)}] ${c.motivo} — ${hora(c.creado_en)}${c.usuario_id ? ` — cuenta ${c.usuario_id}` : ""}${ctx ? `\n  ${ctx}` : ""}`;
  });

  const texto = `${urgentes ? "Un agente necesita que lo mires ahora." : "Lo que escalaron los agentes desde el último resumen."}

${lineas.join("\n")}

Para responder y cerrar cada caso: ${enlace}`;

  // `parrafos` va sin escapar (es HTML): todo lo variable se escapa acá.
  const parrafos = casos.map((c) => {
    const ctx = contextoEnTexto(c.contexto);
    return `<strong>${escaparHtml(nombreDelAgente(c.agente))}</strong> · ${escaparHtml(hora(c.creado_en))}<br>${escaparHtml(c.motivo)}${
      ctx ? `<br><span style="color:#64748b;font-size:13px;">${escaparHtml(ctx)}</span>` : ""
    }`;
  });

  const html = envolverEmailDeMarca({
    eyebrow: "AGENTES DE EOS",
    titulo: urgentes ? "Un agente necesita que lo mires ahora" : "Casos para revisar hoy",
    parrafos,
    ctaTexto: "Abrir los escalamientos",
    ctaUrl: enlace,
  });

  return { asunto, texto, html };
}
