"use client";

import { useEffect, useState } from "react";
import { Bell, BellOff, Check } from "lucide-react";

/**
 * Activar o desactivar los avisos urgentes.
 *
 * Esto NO es el briefing. El briefing sale por correo cada mañana y se lee
 * cuando se puede; el push es para lo que pierde sentido si se lee mañana —
 * que el 28 no va a alcanzar. Un push diario "porque sí" es exactamente lo
 * que hace que alguien apague las notificaciones, y entonces el aviso que sí
 * importaba tampoco llega.
 *
 * Dos decisiones sobre cuándo aparece:
 *
 *  - Solo se muestra si el navegador soporta push. En iOS eso significa que
 *    la PWA tiene que estar instalada; mostrar un botón que no puede
 *    funcionar solo genera desconfianza.
 *  - No se pide el permiso al entrar. El permiso se pide **cuando el usuario
 *    toca el botón**, porque un navegador que te pregunta apenas cargás la
 *    página recibe un "bloquear" automático — y ese bloqueo es permanente.
 */

type Estado = "no-soportado" | "bloqueado" | "activo" | "inactivo";

function claveVapid(): ArrayBuffer | null {
  const base64 = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!base64) return null;

  // La clave viaja en base64url; la API del navegador quiere bytes crudos.
  const relleno = "=".repeat((4 - (base64.length % 4)) % 4);
  const normal = (base64 + relleno).replace(/-/g, "+").replace(/_/g, "/");
  const crudo = atob(normal);

  const bytes = new Uint8Array(crudo.length);
  for (let i = 0; i < crudo.length; i += 1) bytes[i] = crudo.charCodeAt(i);
  return bytes.buffer;
}

export default function PushToggle() {
  const [estado, setEstado] = useState<Estado | null>(null);
  const [trabajando, setTrabajando] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const soportado =
      typeof window !== "undefined" &&
      "serviceWorker" in navigator &&
      "PushManager" in window &&
      Boolean(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY);

    if (!soportado) {
      setEstado("no-soportado");
      return;
    }

    if (Notification.permission === "denied") {
      setEstado("bloqueado");
      return;
    }

    navigator.serviceWorker.ready
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => setEstado(sub ? "activo" : "inactivo"))
      .catch(() => setEstado("inactivo"));
  }, []);

  // Nada que ofrecer: ni un cartel de "tu navegador no puede".
  if (estado === null || estado === "no-soportado") return null;

  async function activar() {
    setTrabajando(true);
    setError("");

    try {
      const permiso = await Notification.requestPermission();
      if (permiso !== "granted") {
        setEstado(permiso === "denied" ? "bloqueado" : "inactivo");
        return;
      }

      const clave = claveVapid();
      if (!clave) throw new Error("sin clave");

      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: clave,
      });

      const res = await fetch("/api/push/suscripcion", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sub.toJSON()),
      });

      if (!res.ok) throw new Error("no se pudo guardar");

      setEstado("activo");
    } catch {
      setError("No pudimos activar las notificaciones. Probá de nuevo.");
    } finally {
      setTrabajando(false);
    }
  }

  async function desactivar() {
    setTrabajando(true);
    setError("");

    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();

      if (sub) {
        // Primero el servidor: si se cancela en el navegador y falla el
        // borrado, quedaría una fila muerta recibiendo envíos para siempre.
        await fetch("/api/push/suscripcion", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        await sub.unsubscribe();
      }

      setEstado("inactivo");
    } catch {
      setError("No pudimos desactivar las notificaciones.");
    } finally {
      setTrabajando(false);
    }
  }

  return (
    <div className="card">
      <div className="card-title">
        {estado === "activo" ? (
          <Bell size={14} style={{ display: "inline", marginRight: 6, verticalAlign: -2 }} />
        ) : (
          <BellOff size={14} style={{ display: "inline", marginRight: 6, verticalAlign: -2 }} />
        )}
        Avisos urgentes en este dispositivo
      </div>

      {estado === "bloqueado" ? (
        <p className="prose">
          Bloqueaste las notificaciones para EOS en este navegador. Para volver a activarlas hay que
          permitirlas desde la configuración del sitio, al lado de la dirección web.
        </p>
      ) : (
        <p className="prose">
          {estado === "activo"
            ? "Si algún día no te va a alcanzar, te avisamos acá antes de que pase. Nada más: el briefing va por correo."
            : "Que EOS te avise en este teléfono cuando detecte un aprieto de plata con fecha. No es el briefing diario."}
        </p>
      )}

      {estado !== "bloqueado" && (
        <button
          type="button"
          className="chip"
          onClick={() => void (estado === "activo" ? desactivar() : activar())}
          disabled={trabajando}
          style={{
            marginTop: 10,
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            cursor: trabajando ? "wait" : "pointer",
          }}
        >
          {estado === "activo" && <Check size={12} />}
          {trabajando ? "Un momento…" : estado === "activo" ? "Activadas" : "Activar"}
        </button>
      )}

      {error && (
        <p className="prose" style={{ marginTop: 8, color: "var(--amber)" }}>
          {error}
        </p>
      )}
    </div>
  );
}
