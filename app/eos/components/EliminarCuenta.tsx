"use client";

import { useState } from "react";
import { AlertTriangle } from "lucide-react";

const CONFIRMACION = "ELIMINAR MI CUENTA";

/**
 * Baja de cuenta desde adentro de la app.
 *
 * Apple y Google lo exigen para cualquier app con registro, pero además es
 * lo correcto: alguien que se va tiene derecho a llevarse sus datos.
 *
 * La fricción es deliberada. Está plegado detrás de un enlace discreto —no
 * es un botón que compite con el resto— y pide escribir una frase exacta.
 * Un borrado irreversible que se dispara con un clic mal dado destruye la
 * vida financiera de alguien, y no hay copia de respaldo que lo arregle.
 */
export default function EliminarCuenta() {
  const [abierto, setAbierto] = useState(false);
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState("");

  if (!abierto) {
    return (
      <div
        style={{
          marginTop: 22,
          textAlign: "center",
          display: "flex",
          gap: 18,
          justifyContent: "center",
          flexWrap: "wrap",
        }}
      >
        {/*
          Descargar va antes que eliminar a propósito: si alguien está por
          irse, lo mínimo es ofrecerle llevarse lo suyo primero.
        */}
        <a
          href="/api/cuenta/exportar"
          style={{ color: "var(--muted, #64748b)", fontSize: 13, textDecoration: "underline" }}
        >
          Descargar mis datos
        </a>
        <button
          type="button"
          onClick={() => setAbierto(true)}
          style={{
            background: "none",
            border: "none",
            color: "var(--muted, #64748b)",
            fontSize: 13,
            textDecoration: "underline",
            cursor: "pointer",
          }}
        >
          Eliminar mi cuenta
        </button>
      </div>
    );
  }

  async function eliminar() {
    setEnviando(true);
    setError("");

    try {
      const res = await fetch("/api/cuenta/eliminar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmacion: texto.trim() }),
      });

      const payload = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(payload.error || "No pudimos completar la baja.");
        setEnviando(false);
        return;
      }

      // Sin sesión ya no hay a dónde volver dentro de la app.
      window.location.href = "/";
    } catch {
      setError("No pudimos conectarnos. Probá de nuevo.");
      setEnviando(false);
    }
  }

  return (
    <div className="card" style={{ marginTop: 22, borderColor: "var(--amber, #f59e0b)" }}>
      <div className="card-title" style={{ color: "var(--amber, #f59e0b)" }}>
        <AlertTriangle size={14} style={{ display: "inline", marginRight: 6, verticalAlign: -2 }} />
        Eliminar mi cuenta
      </div>

      <p className="prose">
        Se borran para siempre tus conversaciones, documentos, objetivos, memorias y todos tus datos
        financieros. También se elimina tu tarjeta de los servidores de Bancard. <strong>No hay
        forma de recuperarlo</strong> y no guardamos una copia.
      </p>

      <p className="prose" style={{ marginTop: 10 }}>
        Si tenés una suscripción activa, se cancela y no se cobra de nuevo.
      </p>

      <p className="prose" style={{ marginTop: 12 }}>
        Para confirmar, escribí <strong>{CONFIRMACION}</strong>:
      </p>

      <input
        type="text"
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        placeholder={CONFIRMACION}
        autoComplete="off"
        style={{
          width: "100%",
          marginTop: 8,
          padding: "10px 12px",
          borderRadius: 9,
          border: "1px solid var(--border, #e2e8f0)",
          fontSize: 14,
        }}
      />

      {error && (
        <p className="prose" style={{ marginTop: 10, color: "var(--amber, #f59e0b)" }}>
          {error}
        </p>
      )}

      <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
        <button
          type="button"
          className="reco-btn"
          onClick={() => {
            setAbierto(false);
            setTexto("");
            setError("");
          }}
          disabled={enviando}
        >
          Cancelar
        </button>
        <button
          type="button"
          className="chip"
          onClick={() => void eliminar()}
          disabled={enviando || texto.trim() !== CONFIRMACION}
          style={{
            cursor: texto.trim() === CONFIRMACION && !enviando ? "pointer" : "not-allowed",
            opacity: texto.trim() === CONFIRMACION ? 1 : 0.5,
          }}
        >
          {enviando ? "Eliminando…" : "Eliminar definitivamente"}
        </button>
      </div>
    </div>
  );
}
