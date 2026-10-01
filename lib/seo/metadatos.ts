import type { Metadata } from "next";

/**
 * Título, descripción y vista previa al compartir, para una página pública.
 *
 * Hasta el 30/09/2026 todas las páginas se compartían igual: el layout raíz
 * fija `openGraph` y `twitter` con "TransTech EOS / Tecnología inteligente
 * para personas y empresas", y Next no los reemplaza con el título de la
 * página si la página no los repite. Por eso /planes o /privacidad, pegadas en
 * WhatsApp, mostraban la misma tarjeta genérica. Y el título salía duplicado
 * ("Política de privacidad · TransTech EOS | TransTech EOS") porque la página
 * ya traía la marca y la plantilla del layout la agregaba otra vez.
 *
 * Esto arma las tres cosas juntas y con el título absoluto.
 */
export const SITIO = "https://www.transtech.com.py";
const IMAGEN = { url: "/og-image.png", width: 1200, height: 630, alt: "TransTech EOS" };

export function metadatosDePagina({
  titulo,
  descripcion,
  ruta,
}: {
  titulo: string;
  descripcion: string;
  /** Sin ruta no se declara URL canónica (por ejemplo, un layout que cubre subpáginas). */
  ruta?: string;
}): Metadata {
  return {
    title: { absolute: titulo },
    description: descripcion,
    ...(ruta ? { alternates: { canonical: ruta } } : {}),
    openGraph: {
      type: "website",
      locale: "es_PY",
      siteName: "TransTech EOS",
      title: titulo,
      description: descripcion,
      ...(ruta ? { url: ruta } : {}),
      images: [IMAGEN],
    },
    twitter: {
      card: "summary_large_image",
      title: titulo,
      description: descripcion,
      images: [IMAGEN.url],
    },
  };
}
