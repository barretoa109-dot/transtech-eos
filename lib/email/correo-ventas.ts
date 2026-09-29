import { createHash } from "node:crypto";

/**
 * Lo que n8n puede pedirle a la app que mande desde ventas@.
 *
 * ============================================================
 * POR QUÉ EL CORREO DE VENTAS SALE POR LA APP
 * ============================================================
 *
 * El flujo de n8n que contesta los correos de ventas@ ("EOS - Correo ESTABLE")
 * mandaba con su propia clave de Resend. El 29/09/2026 esa clave no llegaba al
 * proceso de n8n (cargada en Railway, pero el deploy que la aplicaba no tomó) y
 * cada respuesta fallaba con 401. Dos copias de la misma clave son dos lugares
 * donde puede estar mal, vencida o filtrada.
 *
 * Ahora n8n le pasa a `/api/internal/correo-ventas` el destinatario, el asunto y
 * el cuerpo, autenticado con `EOS_WORKER_GATE_SECRET` (el mismo del worker), y
 * la app manda con la clave que ya usa para todo lo demás.
 *
 * Lo que la ruta NO deja hacer, aunque alguien tenga el secreto: elegir el
 * remitente (siempre ventas@), mandar a varios destinatarios, escribirle al
 * propio dominio (eso armaría un ida y vuelta con la casilla que n8n lee) ni
 * mandar un cuerpo de tamaño arbitrario.
 */

export const REMITENTE_VENTAS = "TransTech <ventas@transtech.com.py>";

const MAX_ASUNTO = 200;
const MAX_HTML = 20_000;
const CORREO = /^[^\s@<>,;"']+@[^\s@<>,;"']+\.[a-z]{2,}$/i;

export type PedidoCorreoVentas = { to: string; subject: string; html: string };

export type Validacion = { ok: true; pedido: PedidoCorreoVentas } | { ok: false; error: string };

export function validarPedidoCorreoVentas(cuerpo: unknown): Validacion {
  const c = (cuerpo && typeof cuerpo === "object" ? cuerpo : {}) as Record<string, unknown>;
  const to = typeof c.to === "string" ? c.to.trim().toLowerCase() : "";
  const subject = typeof c.subject === "string" ? c.subject.trim() : "";
  const html = typeof c.html === "string" ? c.html.trim() : "";

  if (!CORREO.test(to)) return { ok: false, error: "Destinatario inválido: tiene que ser una sola dirección." };
  if (to.endsWith("@transtech.com.py")) return { ok: false, error: "No se le contesta al propio dominio." };
  if (/(^|[.+-])(no-?reply|do-?not-?reply|mailer-daemon|postmaster)@/i.test(to)) {
    return { ok: false, error: "No se le contesta a una dirección automática." };
  }
  if (!subject || subject.length > MAX_ASUNTO) return { ok: false, error: `Asunto vacío o de más de ${MAX_ASUNTO} caracteres.` };
  if (!html || html.length > MAX_HTML) return { ok: false, error: `Cuerpo vacío o de más de ${MAX_HTML} caracteres.` };

  return { ok: true, pedido: { to, subject, html } };
}

/**
 * La misma respuesta al mismo destinatario, dos veces, se manda una sola.
 *
 * n8n reintenta un HTTP Request que falla, y una respuesta duplicada a un
 * cliente se nota. Resend descarta una clave repetida dentro de 24 horas.
 */
export function claveCorreoVentas(pedido: PedidoCorreoVentas): string {
  const huella = createHash("sha256").update(`${pedido.to}\n${pedido.subject}\n${pedido.html}`).digest("hex");
  return `ventas-${huella.slice(0, 32)}`;
}
