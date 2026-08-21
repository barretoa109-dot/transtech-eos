"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";
import EliminarCuenta from "./EliminarCuenta";

type ProfileViewProps = {
  nombre: string;
  plan: string;
  email: string;
  usuarioId: string;
  conversaciones: number;
  mensajes: number;
};

type Uso = {
  plan_nombre: string | null;
  limite_mensajes: number | null;
  memoria_dias: number | null;
  usados: number;
};

export default function ProfileView({ nombre, plan, email, usuarioId, conversaciones }: ProfileViewProps) {
  const [copiado, setCopiado] = useState(false);
  const [uso, setUso] = useState<Uso | null>(null);

  useEffect(() => {
    let activo = true;

    fetch("/api/eos-uso", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((payload) => {
        if (activo && payload && !payload.error) setUso(payload);
      })
      .catch(() => {
        /* la tarjeta de uso simplemente no se muestra */
      });

    return () => {
      activo = false;
    };
  }, []);

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

  const limite = uso?.limite_mensajes ?? null;
  const usados = uso?.usados ?? 0;
  const ilimitado = limite === null || limite < 0;
  const porcentaje = ilimitado || limite === 0 ? 0 : Math.min(100, Math.round((usados / limite) * 100));

  return (
    <div className="view" id="view-perfil">
      <div className="page page-in">
        <div className="page-header">
          <div className="page-eyebrow">Perfil</div>
          <div className="page-title">Tu cuenta</div>
          <div className="page-sub">Datos de la cuenta, memoria y uso del asistente.</div>
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
            <span className="field-label">Usuario</span>
            <span className="field-value">{nombre || "Usuario"}</span>
          </div>
          <div className="field-row">
            <span className="field-label">Correo</span>
            <span className="field-value">{email || "—"}</span>
          </div>
          <div className="field-row">
            <span className="field-label">Plan actual</span>
            <span className="field-value">{uso?.plan_nombre || `EOS ${planVisible}`}</span>
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
          <div className="card-title">Memoria y contexto</div>
          <div className="field-row">
            <span className="field-label">
              Memoria contextual
              <span className="field-hint">EOS recuerda tu contexto entre conversaciones</span>
            </span>
            <span className="field-value">
              {uso?.memoria_dias === null || uso?.memoria_dias === undefined
                ? "Según tu plan"
                : uso.memoria_dias < 0
                  ? "Ilimitada"
                  : `${uso.memoria_dias} días`}
            </span>
          </div>
          <div className="field-row">
            <span className="field-label">
              Conversaciones guardadas
              <span className="field-hint">Historial disponible en la barra lateral</span>
            </span>
            <span className="field-value">{conversaciones}</span>
          </div>
        </div>

        <div className="card">
          <div className="card-title">Plan y uso</div>
          {uso === null ? (
            <p className="empty-note">Cargando uso del plan…</p>
          ) : ilimitado ? (
            <>
              <div className="usage-text">
                {usados} {usados === 1 ? "mensaje usado" : "mensajes usados"} este mes · sin límite en tu plan
              </div>
              <div className="usage-bar">
                <div className="usage-fill" style={{ width: "100%" }} />
              </div>
            </>
          ) : (
            <>
              <div className="usage-text">
                {usados} de {limite} mensajes usados este mes
              </div>
              <div className="usage-bar">
                <div className="usage-fill" style={{ width: `${porcentaje}%` }} />
              </div>
            </>
          )}
          <Link href="/planes" className="reco-btn" style={{ display: "inline-flex", marginTop: 10 }}>
            Ver planes disponibles
          </Link>
        </div>
      </div>

      <EliminarCuenta />
    </div>
  );
}

function capitalizar(value: string) {
  const normalizado = value.trim();
  if (!normalizado) return "Free";
  return normalizado.charAt(0).toUpperCase() + normalizado.slice(1).toLowerCase();
}
