import sharp from "sharp";

/**
 * Una foto de WhatsApp, del tamaño que el modelo necesita y no más
 * (encargado-11 del tablero de lanzamiento).
 *
 * WhatsApp manda las fotos en resolución completa: 3 a 5 MB, que en base64 son
 * 4 a 7 MB. Esa imagen viajaba DOS veces a OpenAI (la lectura que se guarda
 * para el mensaje siguiente y el mensaje en sí) y además por n8n. El
 * 22/09/2026 una foto dejó al chat colgado 60 s (docs/admision-reserva-race).
 *
 * El modelo no aprovecha más de ~2048 px del lado largo: OpenAI achica igual
 * antes de mirarla. Hacerlo acá, a 1600 px en JPEG calidad 80, deja la foto en
 * unos cientos de KB y se lee igual: una lista de precios o un ticket siguen
 * siendo legibles (medido con `evals/bateria/foto-catalogo.mts`).
 *
 * Reglas:
 *  - Solo fotos (JPEG, PNG, WebP, HEIC si sharp la abre). Un GIF o un PDF no
 *    se tocan.
 *  - Se respeta la orientación de la cámara (EXIF) antes de achicar: una foto
 *    tomada de costado no puede llegar acostada.
 *  - Si el resultado no es más chico, o si algo falla, sale la original. Achicar
 *    es una mejora, nunca una condición para que el mensaje llegue.
 */

export const LADO_MAXIMO = 1600;
const CALIDAD = 80;
const ACHICABLES = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp", "image/heic", "image/heif"]);

export async function achicarImagen(
  bytes: Buffer,
  tipo: string,
): Promise<{ bytes: Buffer; tipo: string; achicada: boolean }> {
  const original = { bytes, tipo, achicada: false };
  if (!ACHICABLES.has(tipo.toLowerCase())) return original;

  try {
    const salida = await sharp(bytes, { failOn: "none" })
      .rotate()
      // Un PNG con transparencia pasado a JPEG quedaría con fondo negro.
      .flatten({ background: "#ffffff" })
      .resize({ width: LADO_MAXIMO, height: LADO_MAXIMO, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: CALIDAD, mozjpeg: true })
      .toBuffer();

    if (salida.length >= bytes.length) return original;
    return { bytes: salida, tipo: "image/jpeg", achicada: true };
  } catch (error) {
    console.error("WhatsApp: no se pudo achicar la foto; va la original:", error instanceof Error ? error.message : error);
    return original;
  }
}
