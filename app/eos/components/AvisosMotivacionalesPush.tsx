"use client";

import { useEffect, useState } from "react";
import { BellRing, Check } from "lucide-react";
import { useEsAppNativa } from "@/lib/app-nativa/cliente";

/**
 * Apagar o volver a encender el push motivacional (hasta 3 veces por día).
 *
 * Solo tiene sentido dentro de la app nativa: es el único canal que lo manda
 * (`lib/push/motivacionales.ts`). En la web no se muestra —`useEsAppNativa`
 * devuelve `false` y el componente no renderiza nada— para no ofrecer un
 * interruptor de algo que nunca le va a llegar a esa persona.
 *
 * Arranca ENCENDIDO (decisión del dueño, 2026-11-10): llega a toda cuenta con
 * la app instalada, y se apaga con este botón.
 */
export default function AvisosMotivacionalesPush() {
  const enApp = useEsAppNativa();
  const [activo, setActivo] = useState<boolean | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!enApp) return;
    fetch("/api/push/preferencias", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("fallo"))))
      // Sin dato es "sí": es el valor con el que arranca todo el mundo.
      .then((p) => setActivo(p.avisos_motivacionales_push !== false))
      .catch(() => setActivo(null));
  }, [enApp]);

  if (!enApp || activo === null) return null;

  async function cambiar(valor: boolean) {
    setGuardando(true);
    setError("");
    setActivo(valor);

    try {
      const res = await fetch("/api/push/preferencias", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ avisos_motivacionales_push: valor }),
      });
      if (!res.ok) throw new Error("fallo");
    } catch {
      setActivo(!valor);
      setError("No pudimos guardar el cambio. Probá de nuevo.");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="card">
      <div className="card-title">
        <BellRing size={14} style={{ display: "inline", marginRight: 6, verticalAlign: -2 }} />
        Avisos para usar EOS
      </div>
      <p className="prose">
        {activo
          ? "Hasta tres veces al día te mandamos un empujón para que le cuentes algo a EOS: cómo va tu objetivo, un recordatorio si hace días que no anotás nada, o un cierre del día."
          : "Están apagados. No te llega ningún empujón; los avisos de agenda y de riesgo siguen como estaban."}
      </p>
      <button
        type="button"
        className="chip"
        onClick={() => void cambiar(!activo)}
        disabled={guardando}
        style={{ marginTop: 10, display: "inline-flex", alignItems: "center", gap: 6, cursor: guardando ? "wait" : "pointer" }}
      >
        {activo && <Check size={12} />}
        {guardando ? "Guardando…" : activo ? "Activados" : "Activar"}
      </button>
      {error && (
        <p className="prose" style={{ marginTop: 8, color: "var(--amber)" }}>
          {error}
        </p>
      )}
    </div>
  );
}
