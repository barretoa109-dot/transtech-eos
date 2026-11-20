import type { Metadata } from "next";
import { metadatosDePagina } from "@/lib/seo/metadatos";

// La página es de cliente y no puede declarar sus metadatos: van acá.
export const metadata: Metadata = metadatosDePagina({
  titulo: "Planes y precios · TransTech EOS",
  descripcion:
    "Gratis para probar, Finanzas Personales por Gs. 50.000, Emprendedor / Empresas por Gs. 100.000 y Full por Gs. 130.000 al mes.",
  ruta: "/planes",
});

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
