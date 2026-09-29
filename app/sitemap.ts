import type { MetadataRoute } from "next";

const SITIO = "https://www.transtech.com.py";

const PAGINAS: { ruta: string; prioridad: number }[] = [
  { ruta: "", prioridad: 1 },
  { ruta: "/eos", prioridad: 0.9 },
  { ruta: "/planes", prioridad: 0.9 },
  { ruta: "/login", prioridad: 0.5 },
  { ruta: "/privacidad", prioridad: 0.3 },
  { ruta: "/terminos", prioridad: 0.3 },
];

export default function sitemap(): MetadataRoute.Sitemap {
  return PAGINAS.map(({ ruta, prioridad }) => ({
    url: `${SITIO}${ruta}`,
    priority: prioridad,
  }));
}
