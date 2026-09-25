import type { MetadataRoute } from "next";

const SITIO = "https://www.transtech.com.py";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/", "/admin", "/eos/chat", "/eos/onboarding", "/pago", "/auth/", "/actualizar-contrasena"],
    },
    sitemap: `${SITIO}/sitemap.xml`,
  };
}
