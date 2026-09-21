"use client";

import { useEffect, useState } from "react";
import { Check, Mail } from "lucide-react";

type Campo = "canal_email" | "correos_motivacionales";

/**
 * Activar o desactivar los correos de EOS: el briefing y los motivacionales.
 *
 * Vive acá, al lado del briefing, y no enterrado en el perfil: es donde el
 * usuario está mirando justo el contenido que recibiría, así que es el
 * momento en que la oferta tiene sentido.
 *
 * El briefing arranca apagado a propósito. Un correo diario que nadie pidió es
 * la forma más rápida de terminar en spam, y de ahí no se vuelve. Los
 * motivacionales (uno cada 3 días) arrancan encendidos y cada correo trae su
 * enlace de baja; este interruptor es el camino de vuelta.
 */
export default function BriefingCorreoToggle() {
  const [prefs, setPrefs] = useState<Record<Campo, boolean> | null>(null);
  const [guardando, setGuardando] = useState<Campo | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/briefing/preferencias", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("fallo"))))
      .then((p) =>
        setPrefs({
          canal_email: Boolean(p.canal_email),
          correos_motivacionales: p.correos_motivacionales !== false,
        }),
      )
      .catch(() => setPrefs(null));
  }, []);

  if (prefs === null) return null;

  async function cambiar(campo: Campo, valor: boolean) {
    setGuardando(campo);
    setError("");

    // Optimista: el toggle responde al instante y se revierte si falla.
    // Esperar a la red para mover un switch se siente roto.
    setPrefs((actual) => (actual ? { ...actual, [campo]: valor } : actual));

    try {
      const res = await fetch("/api/briefing/preferencias", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [campo]: valor }),
      });
      if (!res.ok) throw new Error("fallo");
    } catch {
      setPrefs((actual) => (actual ? { ...actual, [campo]: !valor } : actual));
      setError("No pudimos guardar el cambio. Probá de nuevo.");
    } finally {
      setGuardando(null);
    }
  }

  function boton(campo: Campo) {
    const activo = prefs![campo];
    const ocupado = guardando === campo;

    return (
      <button
        type="button"
        className="chip"
        onClick={() => void cambiar(campo, !activo)}
        disabled={guardando !== null}
        style={{
          marginTop: 10,
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          cursor: guardando !== null ? "wait" : "pointer",
        }}
      >
        {activo && <Check size={12} />}
        {ocupado ? "Guardando…" : activo ? "Activado" : "Activar"}
      </button>
    );
  }

  return (
    <>
      <div className="card">
        <div className="card-title">
          <Mail size={14} style={{ display: "inline", marginRight: 6, verticalAlign: -2 }} />
          Recibirlo por correo
        </div>
        <p className="prose">
          {prefs.canal_email
            ? "Cada mañana te llega este briefing por correo. No hace falta que entres a buscarlo."
            : "Podés recibir este briefing por correo cada mañana, sin tener que entrar a buscarlo."}
        </p>
        {boton("canal_email")}
      </div>

      <div className="card">
        <div className="card-title">
          <Mail size={14} style={{ display: "inline", marginRight: 6, verticalAlign: -2 }} />
          Un empujón cada 3 días
        </div>
        <p className="prose">
          {prefs.correos_motivacionales
            ? "Cada 3 días te llega un correo corto para animarte a seguir con tu hábito. Podés apagarlo cuando quieras."
            : "Podés recibir un correo corto cada 3 días para animarte a seguir con tu hábito."}
        </p>
        {boton("correos_motivacionales")}
      </div>

      {error && (
        <p className="prose" style={{ marginTop: 8, color: "var(--amber)" }}>
          {error}
        </p>
      )}
    </>
  );
}
