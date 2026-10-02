/**
 * Reportar una respuesta de EOS (01/10/2026).
 *
 * Lo exige la política de Google Play para apps con IA generativa: la persona
 * tiene que poder marcar una respuesta ofensiva, peligrosa o equivocada sin
 * salir de la app. El reporte queda en `eos_reportes_respuesta_v230` y le llega
 * un correo al dueño. Acá lo que se prueba sin red: validar y redactar.
 */

export const MOTIVOS = {
  ofensivo: "Ofensiva o inapropiada",
  peligroso: "Peligrosa o dañina",
  incorrecto: "Información equivocada",
  otro: "Otro motivo",
} as const;

export type Motivo = keyof typeof MOTIVOS;

export type Reporte = {
  motivo: Motivo;
  comentario: string | null;
  mensajeId: string | null;
  conversacionId: string | null;
  extractoDelCliente: string;
  canal: "web" | "app";
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function texto(valor: unknown, max: number): string {
  return typeof valor === "string" ? valor.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

export function validarReporte(cuerpo: unknown): { ok: true; reporte: Reporte } | { ok: false; motivo: string } {
  const c = (cuerpo && typeof cuerpo === "object" ? cuerpo : {}) as Record<string, unknown>;
  const motivo = String(c.motivo ?? "");
  if (!(motivo in MOTIVOS)) return { ok: false, motivo: "motivo" };
  const mensajeId = typeof c.mensaje_id === "string" && UUID.test(c.mensaje_id) ? c.mensaje_id : null;
  const conversacionId = typeof c.conversacion_id === "string" && UUID.test(c.conversacion_id) ? c.conversacion_id : null;
  const extracto = texto(c.extracto, 2000);
  if (!mensajeId && !extracto) return { ok: false, motivo: "sin_respuesta" };
  return {
    ok: true,
    reporte: {
      motivo: motivo as Motivo,
      comentario: texto(c.comentario, 1000) || null,
      mensajeId,
      conversacionId,
      extractoDelCliente: extracto,
      canal: c.canal === "app" ? "app" : "web",
    },
  };
}

function escapar(t: string): string {
  return t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** El correo al dueño. El extracto y el comentario son de la persona: van escapados. */
export function correoDeReporte(datos: { reporte: Reporte; extracto: string; correoUsuario: string | null; id: number | null }) {
  const { reporte, extracto } = datos;
  const motivo = MOTIVOS[reporte.motivo];
  const asunto = `EOS: respuesta reportada (${motivo.toLowerCase()})`;
  const lineas = [
    `Una persona reportó una respuesta de EOS desde la ${reporte.canal === "app" ? "app" : "web"}.`,
    "",
    `Motivo: ${motivo}`,
    reporte.comentario ? `Comentario: ${reporte.comentario}` : "",
    `Cuenta: ${datos.correoUsuario ?? "(sin correo)"}`,
    datos.id ? `Reporte n.º ${datos.id} (eos_reportes_respuesta_v230)` : "",
    "",
    "Respuesta reportada:",
    extracto,
  ].filter((l, i, todas) => l !== "" || (i > 0 && todas[i - 1] !== ""));
  const texto = lineas.join("\n");
  const html = `<div style="font-family:system-ui,sans-serif;font-size:14px;line-height:1.5">${lineas
    .map((l) => (l ? `<p style="margin:0 0 6px">${escapar(l)}</p>` : "<br>"))
    .join("")}</div>`;
  return { asunto, texto, html };
}
