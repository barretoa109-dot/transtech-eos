"use client";

import { useEffect, useState } from "react";
import { BellRing, Check } from "lucide-react";

/**
 * Apagar o volver a encender el aviso de cada mañana.
 *
 * Arranca ENCENDIDO: son recordatorios que la persona misma anotó, no un boletín.
 * Pero tiene que haber una salida a la vista, y es ésta, en la misma pantalla donde
 * se ven los recordatorios.
 *
 * Dice la verdad sobre lo que hace: avisa UNA vez por mañana, no "en 30 minutos".
 * Prometer una hora exacta que el sistema no cumple es peor que no avisar.
 */
export default function AvisosAgenda() {
  const [activo, setActivo] = useState<boolean | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/calendario/preferencias", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("fallo"))))
      // Sin dato es "sí": es el valor con el que arranca todo el mundo.
      .then((p) => setActivo(p.avisos_agenda !== false))
      .catch(() => setActivo(null));
  }, []);

  if (activo === null) return null;

  async function cambiar(valor: boolean) {
    setGuardando(true);
    setError("");
    setActivo(valor);

    try {
      const res = await fetch("/api/calendario/preferencias", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ avisos_agenda: valor }),
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
    <div className="card cal-avisos">
      <div className="card-title">
        <BellRing size={14} style={{ display: "inline", marginRight: 6, verticalAlign: -2 }} />
        Avisos de agenda
      </div>
      <p className="prose">
        {activo
          ? "Cada mañana te avisamos lo que tenés anotado ese día y el siguiente, y lo que quedó atrás: por notificación si la tenés activada y, si no, por correo. Es un aviso por día; no te avisamos minutos antes de cada cosa."
          : "Están apagados. Seguís viendo todo acá, pero no te llega ningún aviso."}
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
