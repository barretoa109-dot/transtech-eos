"use client";

import { useState } from "react";

import DecisionsView from "./DecisionsView";
import LearningsView from "./LearningsView";
import { SubNav } from "./SeccionNav";
import { useEtiquetaEspacio } from "./EspacioContext";

/**
 * Lo que EOS sabe: decisiones y aprendizajes, en una sola entrada del menú
 * (05/10/2026).
 *
 * Eran dos secciones sueltas al final del menú viejo. Son la misma cosa vista
 * desde dos lados —lo que se decidió y lo que resultó—, así que van juntas,
 * cada una en su pestaña. Las dos pantallas no cambian: se muestran adentro.
 */
type Parte = "decisiones" | "aprendizajes";

const PARTES = [
  { clave: "decisiones" as const, etiqueta: "Decisiones", detalle: "Lo que decidiste con EOS y cómo resultó" },
  { clave: "aprendizajes" as const, etiqueta: "Aprendizajes", detalle: "Los patrones que EOS comprobó con tus datos" },
];

export default function MemoriaView({ inicial = "decisiones" }: { inicial?: Parte }) {
  const [parte, setParte] = useState<Parte>(inicial);
  const etiquetaEspacio = useEtiquetaEspacio();

  return (
    <div className="view" id="view-memoria">
      <div className="page page-in">
        <div className="page-header">
          <div className="page-eyebrow">{etiquetaEspacio}</div>
          <div className="page-title">Decisiones y aprendizajes</div>
          <div className="page-sub">Lo que EOS sabe: lo que decidiste y lo que fue aprendiendo de tus datos.</div>
        </div>

        <SubNav subs={PARTES} sub={parte} onSub={setParte} ariaLabel="Partes de Decisiones y aprendizajes" />

        <div className="incrustado">{parte === "decisiones" ? <DecisionsView /> : <LearningsView />}</div>
      </div>
    </div>
  );
}
