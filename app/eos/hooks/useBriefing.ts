"use client";

import { useMemo, useState } from "react";
import type { Briefing } from "../types/briefing";

export function useBriefing(nombre: string) {
  const [briefing, setBriefing] = useState<Briefing | null>(null);

  const briefingVisible = useMemo(() => {
    return {
      saludo: briefing?.saludo || `Hola ${nombre}.`,
      resumen:
        briefing?.resumen ||
        "EOS está listo para ayudarte. Cuando empieces a conversar, acá vas a ver un resumen inteligente de tu situación.",
      prioridad_1: briefing?.prioridad_1 || "Definir qué querés mejorar",
      prioridad_2: briefing?.prioridad_2 || "Ordenar la información",
      prioridad_3: briefing?.prioridad_3 || "Crear el próximo paso",
      recomendacion_principal:
        briefing?.recomendacion_principal ||
        "Contale a EOS qué querés lograr para que pueda ayudarte mejor.",
      score: briefing?.score || 0,
    };
  }, [briefing, nombre]);

  async function cargarBriefing(usuarioId: string) {
    try {
      const response = await fetch(`/api/briefing?usuario_id=${usuarioId}`);
      const data = await response.json();

      if (data?.briefing) {
        setBriefing(data.briefing);
      }
    } catch (error) {
      console.log("Error cargando briefing:", error);
    }
  }

  return {
    briefing,
    briefingVisible,
    cargarBriefing,
  };
}