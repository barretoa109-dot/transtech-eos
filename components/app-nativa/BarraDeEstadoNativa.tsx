"use client";

import { useEffect } from "react";
import { barraDeEstadoNativa, estaEnAppNativa } from "@/lib/app-nativa/cliente";
import { barraPara } from "@/lib/app-nativa/barra-de-estado";

/**
 * Pone la barra de estado de la app nativa en el mismo tema que la web: texto
 * claro sobre fondo oscuro, y al revés. Sigue al tema del teléfono mientras la
 * app está abierta. En la web no hace nada.
 */
export default function BarraDeEstadoNativa() {
  useEffect(() => {
    if (!estaEnAppNativa()) return;

    const oscuroPorSistema = window.matchMedia("(prefers-color-scheme: dark)");
    const aplicar = () => {
      const { estilo, fondo } = barraPara(oscuroPorSistema.matches);
      const barra = barraDeEstadoNativa();
      barra.setStyle({ style: estilo }).catch(() => {});
      barra.setBackgroundColor({ color: fondo }).catch(() => {});
    };

    aplicar();
    oscuroPorSistema.addEventListener("change", aplicar);
    return () => oscuroPorSistema.removeEventListener("change", aplicar);
  }, []);

  return null;
}
