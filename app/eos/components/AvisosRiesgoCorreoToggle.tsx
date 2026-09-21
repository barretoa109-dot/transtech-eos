"use client";

import { useEffect, useState } from "react";
import { BellRing, Check } from "lucide-react";

/**
 * Apagar o volver a encender los avisos de riesgo por correo.
 *
 * Arrancan ENCENDIDOS (migración v190), a diferencia del briefing diario, que
 * es opt-in: un aviso de que el 28 no te alcanza la plata o de que se acaba un
 * producto es plata tuya, no un boletín. Pero tiene que haber una salida a la
 * vista, y es ésta. Vive junto al del briefing porque es donde la persona ya
 * está mirando sus preferencias de correo.
 */
export default function AvisosRiesgoCorreoToggle() {
  const [activo, setActivo] = useState<boolean | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/briefing/preferencias", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("fallo"))))
      // Sin dato es "sí": es el valor con el que arranca todo el mundo.
      .then((p) => setActivo(p.avisos_riesgo_correo !== false))
      .catch(() => setActivo(null));
  }, []);

  if (activo === null) return null;

  async function cambiar(valor: boolean) {
    setGuardando(true);
    setError("");
    setActivo(valor);

    try {
      const res = await fetch("/api/briefing/preferencias", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ avisos_riesgo_correo: valor }),
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
        Avisos importantes por correo
      </div>
      <p className="prose">
        {activo
          ? "Si algo puede afectar tu plata o tu negocio —un pago que no te alcanza, un producto que se acaba, un cobro demorado— te lo mandamos por correo. Sale una sola vez por cada situación."
          : "Están apagados. Seguís viendo estos avisos acá, pero no te llegan al correo."}
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
