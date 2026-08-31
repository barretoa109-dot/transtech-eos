"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RotateCcw } from "lucide-react";

/**
 * Volver a hacer la conversación de arranque.
 *
 * ============================================================
 * POR QUÉ HACÍA FALTA
 * ============================================================
 *
 * El onboarding le pregunta a la persona qué le preocupa y qué prefiere no
 * mirar. Con eso EOS decide qué le muestra y de qué le habla, durante todo el
 * tiempo que use el producto.
 *
 * Y se contestaba una sola vez, para siempre. Quien se equivocó al principio
 * —o quien simplemente cambió de situación, que en un año es lo normal—
 * quedaba con un EOS calibrado para alguien que ya no es.
 *
 * ============================================================
 * NO BORRA NADA
 * ============================================================
 *
 * Rehacer vuelve al primer paso y deja las respuestas anteriores donde están
 * hasta que las pise. Así, empezar de nuevo y arrepentirse a la mitad no puede
 * dejar a nadie peor que antes de empezar — que es exactamente el miedo que
 * hace que la gente no toque este botón.
 */
export default function RehacerOnboarding() {
  const router = useRouter();
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState("");

  async function rehacer() {
    if (ocupado) return;

    setOcupado(true);
    setError("");

    try {
      const respuesta = await fetch("/api/onboarding", { method: "DELETE" });
      const payload = await respuesta.json().catch(() => null);

      if (!respuesta.ok) throw new Error(payload?.error || "No pudimos reiniciar tu configuración.");

      router.push("/eos/onboarding");
    } catch (fallo) {
      setError(fallo instanceof Error ? fallo.message : "No pudimos reiniciar tu configuración.");
      setOcupado(false);
    }
  }

  return (
    <div className="field-row">
      <span className="field-label">
        Configuración inicial
        <span className="field-hint">
          Lo que le contaste a EOS cuando empezaste. Si ya no te representa, rehacela.
        </span>
      </span>

      <span className="field-value" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <button
          type="button"
          className="chip"
          onClick={() => void rehacer()}
          disabled={ocupado}
          style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
        >
          <RotateCcw size={13} />
          {ocupado ? "Abriendo…" : "Rehacerla"}
        </button>

        {error && (
          <span className="field-hint" role="alert" style={{ color: "var(--red)" }}>
            {error}
          </span>
        )}
      </span>
    </div>
  );
}
