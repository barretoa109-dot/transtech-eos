/**
 * Envoltorio de marca para los emails transaccionales que le llegan a un
 * usuario (bienvenida, confirmación de plan) — no a un vendedor ni a
 * soporte. Mismo lenguaje visual que ya usa `app/api/ventas/contacto`
 * (fondo #eef5ff, tarjeta blanca, header oscuro #071226 con la etiqueta
 * TRANSTECH EOS, acento #2563eb, botón píldora), factorizado acá porque acá
 * sí hay dos plantillas distintas que lo repetirían letra por letra.
 */

function escaparHtml(texto: string): string {
  return texto
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function primerNombre(nombreCompleto: string | null | undefined): string {
  const limpio = (nombreCompleto || "").trim();
  if (!limpio) return "";
  return limpio.split(/\s+/)[0];
}

export function envolverEmailDeMarca(opciones: {
  eyebrow?: string;
  titulo: string;
  parrafos: string[];
  ctaTexto?: string;
  ctaUrl?: string;
  notaFinal?: string;
}): string {
  const eyebrow = escaparHtml(opciones.eyebrow || "TRANSTECH EOS");
  const titulo = escaparHtml(opciones.titulo);
  const parrafosHtml = opciones.parrafos
    .map(
      (parrafo) =>
        `<p style="margin:0 0 16px;color:#334155;line-height:1.7;font-size:15px;">${parrafo}</p>`,
    )
    .join("");

  const cta =
    opciones.ctaTexto && opciones.ctaUrl
      ? `<a
          href="${opciones.ctaUrl}"
          style="display:inline-block;margin-top:8px;padding:14px 26px;border-radius:999px;background:#2563eb;color:#ffffff;font-size:14px;font-weight:800;text-decoration:none;"
        >
          ${escaparHtml(opciones.ctaTexto)}
        </a>`
      : "";

  const notaFinal = opciones.notaFinal
    ? `<p style="margin:24px 0 0;color:#94a3b8;line-height:1.6;font-size:12px;">${escaparHtml(opciones.notaFinal)}</p>`
    : "";

  return `
    <div style="margin:0;padding:32px 16px;background:#eef5ff;font-family:Arial,Helvetica,sans-serif;color:#071226;">
      <div style="max-width:560px;margin:0 auto;overflow:hidden;border:1px solid #dbeafe;border-radius:24px;background:#ffffff;">
        <div style="padding:28px 32px;background:#071226;color:#ffffff;">
          <div style="font-size:11px;font-weight:800;letter-spacing:2px;color:#93c5fd;">${eyebrow}</div>
          <h1 style="margin:10px 0 0;font-size:26px;line-height:1.25;">${titulo}</h1>
        </div>

        <div style="padding:30px 32px;">
          ${parrafosHtml}
          ${cta}
          ${notaFinal}
        </div>
      </div>
    </div>
  `;
}
