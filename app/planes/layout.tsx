import type { Metadata } from "next";
import { metadatosDePagina } from "@/lib/seo/metadatos";

// La página es de cliente y no puede declarar sus metadatos: van acá.
export const metadata: Metadata = metadatosDePagina({
  titulo: "Planes y precios · TransTech EOS",
  descripcion:
    "Armá el EOS que vas a usar y pagá solo eso: prendé las funciones que te sirven y apagá las que no.",
  ruta: "/planes",
});

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
