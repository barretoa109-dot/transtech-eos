import type { Metadata } from "next";
import { metadatosDePagina } from "@/lib/seo/metadatos";

// La página es de cliente y no puede declarar sus metadatos: van acá.
export const metadata: Metadata = metadatosDePagina({
  titulo: "Ingresar · TransTech EOS",
  descripcion:
    "Organizá tus ideas, proyectos, tareas, documentos, objetivos y procesos en un sistema que entiende tu contexto.",
  ruta: "/login",
});

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
