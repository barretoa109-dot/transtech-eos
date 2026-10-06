/**
 * Achica una foto antes de subirla al catálogo.
 *
 * Una foto de teléfono pesa 3 a 6 MB y el bucket acepta 2 MB. Además, en la
 * lista se ve en 40 píxeles y al tocarla en unos 300: subir 4000 píxeles de
 * ancho solo haría lento el catálogo con datos móviles. Se lleva el lado más
 * largo a 1000 píxeles y se guarda en JPEG, que todos los navegadores y las
 * dos tiendas de apps saben escribir.
 */
const LADO_MAXIMO = 1000;
const CALIDAD = 0.82;

export async function achicarFoto(archivo: File): Promise<{ tipo: string; base64: string }> {
  if (!/^image\/(jpeg|png|webp|heic|heif)$/i.test(archivo.type) && !/\.(jpe?g|png|webp|heic|heif)$/i.test(archivo.name)) {
    throw new Error("La foto tiene que ser una imagen (JPG, PNG o WebP).");
  }

  const url = URL.createObjectURL(archivo);
  try {
    const imagen = await new Promise<HTMLImageElement>((resolver, rechazar) => {
      const img = new Image();
      img.onload = () => resolver(img);
      img.onerror = () => rechazar(new Error("No pudimos leer esa imagen. Probá con otra."));
      img.src = url;
    });

    const escala = Math.min(1, LADO_MAXIMO / Math.max(imagen.naturalWidth, imagen.naturalHeight));
    const ancho = Math.max(1, Math.round(imagen.naturalWidth * escala));
    const alto = Math.max(1, Math.round(imagen.naturalHeight * escala));

    const lienzo = document.createElement("canvas");
    lienzo.width = ancho;
    lienzo.height = alto;
    const ctx = lienzo.getContext("2d");
    if (!ctx) throw new Error("Este dispositivo no pudo preparar la foto.");

    // Fondo blanco: un PNG con transparencia pasado a JPEG quedaría negro.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, ancho, alto);
    ctx.drawImage(imagen, 0, 0, ancho, alto);

    const datos = lienzo.toDataURL("image/jpeg", CALIDAD);
    return { tipo: "image/jpeg", base64: datos.slice(datos.indexOf(",") + 1) };
  } finally {
    URL.revokeObjectURL(url);
  }
}
