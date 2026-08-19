"use client";

import Link from "next/link";
import { useState } from "react";
import { Check, Copy } from "lucide-react";

type ProfileViewProps = {
  nombre: string;
  plan: string;
  usuarioId: string;
  conversaciones: number;
  mensajes: number;
};

export default function ProfileView({ nombre, plan, usuarioId, conversaciones, mensajes }: ProfileViewProps) {
  const [copiado, setCopiado] = useState(false);

  const iniciales =
    nombre
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((p) => p.charAt(0).toUpperCase())
      .join("") || "U";

  const planVisible = capitalizar(plan || "free");

  async function copiarUsuarioId() {
    if (!usuarioId || !navigator.clipboard) return;

    try {
      await navigator.clipboard.writeText(usuarioId);
      setCopiado(true);
      window.setTimeout(() => setCopiado(false), 1800);
    } catch (error) {
      console.error("No se pudo copiar el ID del usuario:", error);
    }
  }

  return (
    <div className="view" id="view-perfil">
      <div className="page page-in">
        <div className="page-header">
          <div className="page-eyebrow">Perfil</div>
          <div className="page-title">Tu cuenta</div>
          <div className="page-sub">Datos de tu cuenta y actividad reciente con EOS.</div>
        </div>

        <div className="profile-hero">
          <div className="profile-avatar-lg">{iniciales}</div>
          <div>
            <div className="profile-name">{nombre || "Usuario"}</div>
            <div className="plan-badge">Plan {planVisible}</div>
          </div>
          <Link href="/planes" className="ghost-btn">
            Mejorar plan
          </Link>
        </div>

        <div className="card">
          <div className="card-title">Información de la cuenta</div>
          <div className="field-row">
            <span className="field-label">Nombre</span>
            <span className="field-value">{nombre || "Usuario"}</span>
          </div>
          <div className="field-row">
            <span className="field-label">Plan actual</span>
            <span className="field-value">{planVisible}</span>
          </div>
          <div className="field-row">
            <span className="field-label">ID de usuario</span>
            <button
              type="button"
              onClick={copiarUsuarioId}
              className="field-value"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                background: "none",
                border: "none",
                cursor: "pointer",
                color: copiado ? "var(--green)" : "var(--blue)",
              }}
            >
              {copiado ? <Check size={13} /> : <Copy size={13} />}
              {copiado ? "Copiado" : usuarioId ? `${usuarioId.slice(0, 8)}…` : "No disponible"}
            </button>
          </div>
        </div>

        <div className="card">
          <div className="card-title">Actividad con EOS</div>
          <div className="field-row">
            <span className="field-label">Conversaciones</span>
            <span className="field-value">{conversaciones}</span>
          </div>
          <div className="field-row">
            <span className="field-label">Mensajes intercambiados</span>
            <span className="field-value">{mensajes}</span>
          </div>
        </div>

        <div className="card">
          <div className="card-title">Plan y facturación</div>
          <p className="empty-note">
            Estás en el plan <strong>{planVisible}</strong>. Podés ver el resto de los planes disponibles y sus
            límites en cualquier momento.
          </p>
          <Link href="/planes" className="reco-btn" style={{ display: "inline-flex", marginTop: 10 }}>
            Ver planes disponibles
          </Link>
        </div>
      </div>
    </div>
  );
}

function capitalizar(value: string) {
  const normalizado = value.trim();
  if (!normalizado) return "Free";
  return normalizado.charAt(0).toUpperCase() + normalizado.slice(1).toLowerCase();
}
