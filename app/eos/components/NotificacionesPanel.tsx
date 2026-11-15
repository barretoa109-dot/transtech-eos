"use client";

import { useEffect, useState } from "react";
import { BellRing } from "lucide-react";
import { useEsAppNativa } from "@/lib/app-nativa/cliente";
import type { ClaveDeNotificacion, PreferenciasDeNotificacion } from "@/lib/push/preferencias";

/**
 * Elegir qué notificaciones llegan al teléfono, una por una.
 *
 * Reemplaza al interruptor único de "todo o nada" (`AvisosMotivacionalesPush`):
 * quien se cansaba de una sola notificación solo podía apagarlas todas, y con
 * eso dejaba de recibir también las que le servían.
 *
 * Solo se muestra dentro de la app nativa, que es el único lugar donde llegan
 * estas notificaciones. En la web no renderiza nada, para no ofrecer
 * interruptores de algo que a esa persona nunca le va a llegar.
 *
 * Cada fila dice CUÁNDO llega y QUÉ trae, con las palabras de la notificación
 * y no con el nombre interno: nadie sabe qué es una "franja".
 */

const FILAS: { clave: ClaveDeNotificacion; titulo: string; cuando: string; detalle: string }[] = [
  {
    clave: "manana",
    titulo: "Tu objetivo o un consejo",
    cuando: "A la mañana",
    detalle: "Cómo va tu objetivo, o un consejo corto sobre tu plata. Los lunes, el resumen de tu semana.",
  },
  {
    clave: "mediodia",
    titulo: "Seguimiento y rachas",
    cuando: "Al mediodía",
    detalle: "Un recordatorio si hace días que no anotás nada, y el festejo cuando llegás a varios días seguidos.",
  },
  {
    clave: "noche",
    titulo: "Cierre del día",
    cuando: "A la noche",
    detalle: "Un repaso antes de terminar el día, o el aviso de que tu racha se corta si hoy no anotás nada.",
  },
  {
    clave: "agenda",
    titulo: "Tu agenda",
    cuando: "A la mañana, si tenés algo",
    detalle: "Lo que anotaste para hoy y para mañana en tu Calendario.",
  },
  {
    clave: "riesgos",
    titulo: "Avisos importantes",
    cuando: "Solo cuando pasa algo",
    detalle: "Si la plata no va a alcanzar, un cobro que se demora o un producto que se termina. Como mucho dos por día.",
  },
];

export default function NotificacionesPanel() {
  const enApp = useEsAppNativa();
  const [preferencias, setPreferencias] = useState<PreferenciasDeNotificacion | null>(null);
  const [guardando, setGuardando] = useState<ClaveDeNotificacion | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!enApp) return;
    fetch("/api/push/preferencias", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("fallo"))))
      .then((p: PreferenciasDeNotificacion) => setPreferencias(p))
      .catch(() => setPreferencias(null));
  }, [enApp]);

  if (!enApp || preferencias === null) return null;

  async function cambiar(clave: ClaveDeNotificacion, valor: boolean) {
    const anterior = preferencias;
    if (!anterior) return;

    setGuardando(clave);
    setError("");
    setPreferencias({ ...anterior, [clave]: valor });

    try {
      const res = await fetch("/api/push/preferencias", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clave, valor }),
      });
      if (!res.ok) throw new Error("fallo");
    } catch {
      setPreferencias(anterior);
      setError("No pudimos guardar el cambio. Probá de nuevo.");
    } finally {
      setGuardando(null);
    }
  }

  const encendidas = FILAS.filter((fila) => preferencias[fila.clave]).length;

  return (
    <div className="card">
      <div className="card-title">
        <BellRing size={14} style={{ display: "inline", marginRight: 6, verticalAlign: -2 }} />
        Notificaciones
      </div>
      <p className="prose">
        {encendidas === 0
          ? "Tenés todas apagadas. EOS no te va a escribir al teléfono; cuando quieras, volvé a encender las que te sirvan."
          : "Elegí qué querés que EOS te avise en el teléfono. Podés cambiarlo cuando quieras."}
      </p>

      <div style={{ marginTop: 6 }}>
        {FILAS.map((fila) => {
          const activa = preferencias[fila.clave];
          return (
            <div
              key={fila.clave}
              style={{
                display: "flex",
                alignItems: "flex-start",
                justifyContent: "space-between",
                gap: 14,
                padding: "12px 0",
                borderTop: "1px solid var(--line, rgba(127,127,127,0.2))",
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600 }}>{fila.titulo}</div>
                <div className="prose" style={{ fontSize: 12, opacity: 0.75, marginTop: 2 }}>
                  {fila.cuando}
                </div>
                <p className="prose" style={{ marginTop: 4 }}>
                  {fila.detalle}
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={activa}
                aria-label={`${fila.titulo}: ${activa ? "activada" : "apagada"}`}
                onClick={() => void cambiar(fila.clave, !activa)}
                disabled={guardando !== null}
                style={{
                  flex: "none",
                  width: 46,
                  height: 28,
                  borderRadius: 999,
                  border: "none",
                  padding: 3,
                  marginTop: 2,
                  cursor: guardando !== null ? "wait" : "pointer",
                  background: activa ? "var(--blue-solido, #2563eb)" : "rgba(127,127,127,0.35)",
                  transition: "background 0.15s",
                }}
              >
                <span
                  style={{
                    display: "block",
                    width: 22,
                    height: 22,
                    borderRadius: "50%",
                    background: "#fff",
                    transform: activa ? "translateX(18px)" : "translateX(0)",
                    transition: "transform 0.15s",
                  }}
                />
              </button>
            </div>
          );
        })}
      </div>

      {error && (
        <p className="prose" style={{ marginTop: 8, color: "var(--amber)" }}>
          {error}
        </p>
      )}
    </div>
  );
}
