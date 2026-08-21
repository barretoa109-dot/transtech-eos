"use client";

import { useEffect, useState } from "react";
import { Check, Mail } from "lucide-react";

/**
 * Activar o desactivar el briefing por correo.
 *
 * Vive acá, al lado del briefing, y no enterrado en el perfil: es donde el
 * usuario está mirando justo el contenido que recibiría, así que es el
 * momento en que la oferta tiene sentido.
 *
 * Arranca apagado a propósito. Un correo diario que nadie pidió es la forma
 * más rápida de terminar en spam, y de ahí no se vuelve.
 */
export default function BriefingCorreoToggle() {
  const [activo, setActivo] = useState<boolean | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/briefing/preferencias", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("fallo"))))
      .then((p) => setActivo(Boolean(p.canal_email)))
      .catch(() => setActivo(null));
  }, []);

  if (activo === null) return null;

  async function cambiar(valor: boolean) {
    setGuardando(true);
    setError("");

    // Optimista: el toggle responde al instante y se revierte si falla.
    // Esperar a la red para mover un switch se siente roto.
    setActivo(valor);

    try {
      const res = await fetch("/api/briefing/preferencias", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ canal_email: valor }),
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
        <Mail size={14} style={{ display: "inline", marginRight: 6, verticalAlign: -2 }} />
        Recibirlo por correo
      </div>
      <p className="prose">
        {activo
          ? "Cada mañana te llega este briefing por correo. No hace falta que entres a buscarlo."
          : "Podés recibir este briefing por correo cada mañana, sin tener que entrar a buscarlo."}
      </p>
      <button
        type="button"
        className="chip"
        onClick={() => void cambiar(!activo)}
        disabled={guardando}
        style={{
          marginTop: 10,
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          cursor: guardando ? "wait" : "pointer",
        }}
      >
        {activo && <Check size={12} />}
        {guardando ? "Guardando…" : activo ? "Activado" : "Activar"}
      </button>
      {error && (
        <p className="prose" style={{ marginTop: 8, color: "var(--amber)" }}>
          {error}
        </p>
      )}
    </div>
  );
}
