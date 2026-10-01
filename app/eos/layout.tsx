import type { Metadata } from "next";
import { metadatosDePagina } from "@/lib/seo/metadatos";

// La página de /eos es de cliente. Este layout también cubre /eos/chat y el resto de la app, por eso sin URL canónica.
export const metadata: Metadata = metadatosDePagina({
  titulo: "EOS · Sistema operativo ejecutivo de TransTech",
  descripcion:
    "EOS conversa con contexto, genera archivos, organiza objetivos y conserva la información de tu trabajo y de tu negocio.",
});

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
