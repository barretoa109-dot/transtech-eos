"use client";

import { useState } from "react";

type ProfileViewProps = {
  nombre: string;
  plan: string;
  usuarioId: string;
  conversaciones: number;
  mensajes: number;
};

export default function ProfileView({
  nombre,
  plan,
  usuarioId,
  conversaciones,
  mensajes,
}: ProfileViewProps) {
  const [copiado, setCopiado] = useState(false);

  const inicial = nombre.trim().charAt(0).toUpperCase() || "U";
  const planVisible = plan?.trim() || "Free";
  const idVisible = usuarioId || "No disponible";

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
    <div className="profile-page">
      <div className="glow glow-one" />
      <div className="glow glow-two" />

      <div className="profile-container">
        <header className="profile-header">
          <div className="header-copy">
            <div className="eyebrow-row">
              <span className="status-dot" />
              <span className="eyebrow">PERFIL EOS</span>
            </div>

            <h1>Tu espacio personal</h1>

            <p>
              Información general de tu cuenta y del uso actual de TransTech
              EOS.
            </p>
          </div>

          <div className="account-status">
            <span>ESTADO DE LA CUENTA</span>
            <strong>
              <i />
              EOS activo
            </strong>
          </div>
        </header>

        <section className="profile-card">
          <div className="profile-identity">
            <div className="avatar-outer">
              <div className="avatar">{inicial}</div>
              <span className="avatar-status" />
            </div>

            <div className="identity-content">
              <span className="profile-label">USUARIO TRANSTECH EOS</span>
              <h2>{nombre || "Usuario"}</h2>

              <div className="profile-tags">
                <span className="plan-tag">Plan {capitalizar(planVisible)}</span>
                <span className="connected-tag">
                  <i />
                  Conectado
                </span>
              </div>
            </div>
          </div>

          <div className="user-id-card">
            <div className="user-id-header">
              <div>
                <span>IDENTIFICADOR DE USUARIO</span>
                <p>Código único asociado a tu cuenta.</p>
              </div>

              <button
                type="button"
                onClick={copiarUsuarioId}
                disabled={!usuarioId}
              >
                {copiado ? "Copiado" : "Copiar"}
              </button>
            </div>

            <code>{idVisible}</code>
          </div>
        </section>

        <section className="metrics-grid">
          <MetricCard
            icon="◫"
            label="Conversaciones"
            value={conversaciones}
            description="Chats registrados en EOS"
          />
          <MetricCard
            icon="≡"
            label="Mensajes"
            value={mensajes}
            description="Mensajes del chat actual"
          />
          <MetricCard
            icon="✦"
            label="Plan actual"
            value={capitalizar(planVisible)}
            description="Nivel de acceso disponible"
          />
        </section>

        <div className="content-grid">
          <section className="section-card">
            <div className="section-header">
              <div>
                <span>CAPACIDADES</span>
                <h3>Funciones disponibles</h3>
              </div>
              <b>6 activas</b>
            </div>

            <div className="features-grid">
              <Feature title="Asesor EOS" description="Conversaciones inteligentes y análisis contextual." />
              <Feature title="Memoria" description="Uso del contexto registrado para mejorar respuestas." />
              <Feature title="Briefing" description="Resumen ejecutivo con prioridades y recomendaciones." />
              <Feature title="Documentos" description="Generación de archivos y entregables profesionales." />
              <Feature title="Dashboard" description="Indicadores generales del espacio de trabajo." />
              <Feature title="Historial" description="Acceso a conversaciones registradas anteriormente." />
            </div>
          </section>

          <section className="section-card">
            <div className="section-header">
              <div>
                <span>CUENTA</span>
                <h3>Resumen del acceso</h3>
              </div>
              <em>◇</em>
            </div>

            <div className="account-list">
              <AccountRow label="Estado" value="Activo" indicator />
              <AccountRow label="Plan" value={capitalizar(planVisible)} />
              <AccountRow label="Memoria contextual" value="Habilitada" />
              <AccountRow label="Asistente EOS" value="Disponible" />
            </div>

            <div className="security-notice">
              <span>✓</span>
              <div>
                <strong>Espacio protegido</strong>
                <p>
                  Tu identificador permite asociar correctamente las
                  conversaciones y los datos de tu cuenta.
                </p>
              </div>
            </div>
          </section>
        </div>

        <footer className="profile-footer">
          <span />
          TransTech EOS está conectado y listo para trabajar con tu cuenta.
        </footer>
      </div>

      <style jsx>{`
        .profile-page {
          position: relative;
          flex: 1;
          min-width: 0;
          min-height: 0;
          height: 100%;
          overflow-x: hidden;
          overflow-y: auto;
          padding: 34px 28px 60px;
          box-sizing: border-box;
          background: linear-gradient(180deg, #ffffff 0%, #f7faff 46%, #eef5ff 100%);
          color: #071226;
          font-family: var(--font-inter), Inter, Arial, Helvetica, sans-serif;
          -webkit-overflow-scrolling: touch;
          overscroll-behavior-y: contain;
        }

        .glow {
          position: fixed;
          border-radius: 999px;
          pointer-events: none;
        }

        .glow-one {
          top: 110px;
          right: 8%;
          width: 420px;
          height: 420px;
          background: rgba(37, 99, 235, 0.1);
          filter: blur(120px);
        }

        .glow-two {
          bottom: 40px;
          left: 26%;
          width: 340px;
          height: 340px;
          background: rgba(59, 130, 246, 0.07);
          filter: blur(110px);
        }

        .profile-container {
          position: relative;
          z-index: 1;
          width: 100%;
          max-width: 1120px;
          margin: 0 auto;
        }

        .profile-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          flex-wrap: wrap;
          gap: 22px;
          margin-bottom: 25px;
        }

        .header-copy { min-width: 0; }

        .eyebrow-row {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 11px;
        }

        .status-dot {
          width: 7px;
          height: 7px;
          border-radius: 999px;
          background: #2f72d6;
          box-shadow: 0 0 11px rgba(34, 211, 238, 0.8);
        }

        .eyebrow {
          color: #1656bd;
          font-size: 10px;
          font-weight: 900;
          letter-spacing: 0.18em;
        }

        .profile-header h1 {
          margin: 0;
          font-size: clamp(31px, 5vw, 46px);
          line-height: 1.1;
          font-weight: 900;
          letter-spacing: -0.045em;
        }

        .profile-header p {
          max-width: 580px;
          margin: 14px 0 0;
          color: #475569;
          font-size: 14px;
          line-height: 1.7;
        }

        .account-status {
          min-width: 195px;
          padding: 16px 18px;
          border: 1px solid #dbe5f2;
          border-radius: 17px;
          background: rgba(255, 255, 255, 0.9);
          box-sizing: border-box;
        }

        .account-status > span {
          display: block;
          margin-bottom: 8px;
          color: #64748b;
          font-size: 8px;
          font-weight: 900;
          letter-spacing: 0.14em;
        }

        .account-status strong {
          display: flex;
          align-items: center;
          gap: 8px;
          color: #0f172a;
          font-size: 13px;
          font-weight: 800;
        }

        .account-status i,
        .connected-tag i,
        .account-value i {
          width: 7px;
          height: 7px;
          flex: 0 0 auto;
          border-radius: 999px;
          background: #22c55e;
          box-shadow: 0 0 9px rgba(34, 197, 94, 0.55);
        }

        .profile-card {
          display: grid;
          grid-template-columns: minmax(280px, 1fr) minmax(300px, 0.8fr);
          gap: 22px;
          padding: 24px;
          border: 1px solid #dbe5f2;
          border-radius: 23px;
          background: linear-gradient(145deg, rgba(255,255,255,0.98), rgba(245,249,255,0.96));
          box-shadow: 0 22px 52px rgba(15,23,42,0.08), inset 0 1px 0 rgba(96, 165, 250, 0.05);
          box-sizing: border-box;
        }

        .profile-identity {
          min-width: 0;
          display: flex;
          align-items: center;
          gap: 19px;
        }

        .avatar-outer {
          position: relative;
          flex: 0 0 auto;
        }

        .avatar {
          width: 82px;
          height: 82px;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 25px;
          background: linear-gradient(135deg, #1656bd 0%, #1656bd 52%, #113f8c 100%);
          color: #fff;
          font-size: 32px;
          font-weight: 950;
          box-shadow: 0 16px 30px rgba(37, 99, 235, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.32);
        }

        .avatar-status {
          position: absolute;
          right: -2px;
          bottom: -2px;
          width: 18px;
          height: 18px;
          border: 4px solid #ffffff;
          border-radius: 999px;
          background: #22c55e;
          box-sizing: border-box;
        }

        .identity-content { min-width: 0; }

        .profile-label {
          color: #64748b;
          font-size: 8px;
          font-weight: 900;
          letter-spacing: 0.15em;
        }

        .identity-content h2 {
          margin: 7px 0 11px;
          overflow: hidden;
          color: #071226;
          font-size: 27px;
          line-height: 1.1;
          font-weight: 900;
          letter-spacing: -0.035em;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .profile-tags {
          display: flex;
          align-items: center;
          flex-wrap: wrap;
          gap: 8px;
        }

        .plan-tag,
        .connected-tag {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 7px 10px;
          border-radius: 999px;
          font-size: 9px;
          font-weight: 850;
        }

        .plan-tag {
          border: 1px solid #a9c6ee;
          background: #eef3fb;
          color: #1656bd;
        }

        .connected-tag {
          border: 1px solid #e2e8f0;
          background: #f8fafc;
          color: #64748b;
        }

        .connected-tag i { width: 5px; height: 5px; box-shadow: none; }

        .user-id-card {
          min-width: 0;
          padding: 17px;
          border: 1px solid #dbe5f2;
          border-radius: 17px;
          background: rgba(255,255,255,0.88);
          box-sizing: border-box;
        }

        .user-id-header {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 12px;
        }

        .user-id-header span {
          color: #64748b;
          font-size: 8px;
          font-weight: 900;
          letter-spacing: 0.13em;
        }

        .user-id-header p {
          margin: 5px 0 0;
          color: #94a3b8;
          font-size: 9px;
        }

        .user-id-header button {
          flex: 0 0 auto;
          padding: 7px 11px;
          border: 1px solid #a9c6ee;
          border-radius: 9px;
          background: #eef3fb;
          color: #1656bd;
          font-family: inherit;
          font-size: 9px;
          font-weight: 850;
          cursor: pointer;
        }

        .user-id-header button:disabled { opacity: 0.45; cursor: not-allowed; }

        .user-id-card code {
          display: block;
          max-width: 100%;
          margin-top: 17px;
          overflow: hidden;
          padding: 11px 12px;
          border-radius: 10px;
          background: #f8fafc;
          color: #334155;
          font-size: 10px;
          line-height: 1.5;
          text-overflow: ellipsis;
          white-space: nowrap;
          box-sizing: border-box;
        }

        .metrics-grid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 14px;
          margin-top: 17px;
        }

        .content-grid {
          display: grid;
          grid-template-columns: minmax(0, 1.2fr) minmax(300px, 0.8fr);
          gap: 16px;
          margin-top: 17px;
        }

        .section-card {
          min-width: 0;
          padding: 22px;
          border: 1px solid #dbe5f2;
          border-radius: 21px;
          background: linear-gradient(145deg, rgba(255,255,255,0.98), rgba(248,251,255,0.96));
          box-shadow: 0 18px 37px rgba(15,23,42,0.07);
          box-sizing: border-box;
        }

        .section-header {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 12px;
          margin-bottom: 18px;
        }

        .section-header span {
          color: #1656bd;
          font-size: 8px;
          font-weight: 900;
          letter-spacing: 0.14em;
        }

        .section-header h3 {
          margin: 5px 0 0;
          color: #071226;
          font-size: 19px;
          font-weight: 850;
          letter-spacing: -0.025em;
        }

        .section-header b {
          flex: 0 0 auto;
          padding: 6px 9px;
          border-radius: 999px;
          background: #eef3fb;
          color: #1656bd;
          font-size: 8px;
          font-weight: 850;
        }

        .section-header em {
          color: #1656bd;
          font-size: 21px;
          font-style: normal;
        }

        .features-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 11px;
        }

        .account-list { display: grid; }

        .security-notice {
          display: flex;
          align-items: flex-start;
          gap: 11px;
          margin-top: 17px;
          padding: 14px;
          border: 1px solid #e9f0fb;
          border-radius: 13px;
          background: #eef3fb;
        }

        .security-notice > span {
          width: 24px;
          height: 24px;
          flex: 0 0 auto;
          display: grid;
          place-items: center;
          border-radius: 8px;
          background: #e9f0fb;
          color: #1656bd;
          font-size: 10px;
          font-weight: 900;
        }

        .security-notice strong {
          color: #071226;
          font-size: 10px;
          font-weight: 850;
        }

        .security-notice p {
          margin: 4px 0 0;
          color: #64748b;
          font-size: 8px;
          line-height: 1.55;
        }

        .profile-footer {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          margin-top: 23px;
          color: #64748b;
          font-size: 9px;
          text-align: center;
        }

        .profile-footer > span {
          width: 5px;
          height: 5px;
          flex: 0 0 auto;
          border-radius: 999px;
          background: #22c55e;
        }

        @media (max-width: 900px) {
          .profile-card,
          .content-grid {
            grid-template-columns: 1fr;
          }

          .metrics-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
        }

        @media (max-width: 760px) {
          .profile-page {
            width: 100%;
            height: 100%;
            padding: 68px 14px calc(40px + env(safe-area-inset-bottom));
          }

          .glow-one {
            top: 120px;
            right: -180px;
            width: 360px;
            height: 360px;
          }

          .glow-two {
            left: -170px;
            bottom: 40px;
            width: 320px;
            height: 320px;
          }

          .profile-header {
            display: grid;
            grid-template-columns: minmax(0, 1fr);
            gap: 18px;
            margin-bottom: 18px;
          }

          .profile-header h1 {
            font-size: clamp(33px, 10vw, 44px);
          }

          .profile-header p {
            font-size: 14px;
            line-height: 1.6;
          }

          .account-status {
            width: 100%;
            min-width: 0;
          }

          .profile-card {
            grid-template-columns: minmax(0, 1fr);
            gap: 18px;
            padding: 18px;
            border-radius: 20px;
          }

          .profile-identity {
            align-items: center;
            gap: 16px;
          }

          .avatar {
            width: 68px;
            height: 68px;
            border-radius: 21px;
            font-size: 27px;
          }

          .avatar-status {
            width: 16px;
            height: 16px;
          }

          .identity-content h2 {
            font-size: 24px;
            white-space: normal;
            overflow-wrap: anywhere;
          }

          .user-id-header {
            align-items: stretch;
            flex-direction: column;
          }

          .user-id-header button {
            width: 100%;
            min-height: 42px;
          }

          .metrics-grid,
          .content-grid,
          .features-grid {
            grid-template-columns: minmax(0, 1fr);
          }

          .section-card {
            padding: 18px;
            border-radius: 19px;
          }

          .profile-footer {
            align-items: flex-start;
            padding: 0 8px;
            line-height: 1.55;
          }
        }

        @media (max-width: 390px) {
          .profile-page {
            padding-left: 11px;
            padding-right: 11px;
          }

          .profile-card,
          .section-card {
            padding: 15px;
          }

          .profile-identity {
            align-items: flex-start;
            flex-direction: column;
          }

          .identity-content h2 { font-size: 22px; }
        }
      `}</style>
    </div>
  );
}

function MetricCard({
  icon,
  label,
  value,
  description,
}: {
  icon: string;
  label: string;
  value: string | number;
  description: string;
}) {
  return (
    <article className="metric-card">
      <div className="metric-icon">{icon}</div>
      <div className="metric-content">
        <span>{label}</span>
        <strong>{value}</strong>
        <small>{description}</small>
      </div>

      <style jsx>{`
        .metric-card {
          min-width: 0;
          display: flex;
          align-items: center;
          gap: 14px;
          padding: 19px;
          border: 1px solid #dbe5f2;
          border-radius: 18px;
          background: linear-gradient(145deg, rgba(255,255,255,0.98), rgba(248,251,255,0.96));
          box-shadow: 0 15px 32px rgba(15,23,42,0.06);
          box-sizing: border-box;
        }

        .metric-icon {
          width: 46px;
          height: 46px;
          flex: 0 0 auto;
          display: grid;
          place-items: center;
          border: 1px solid #a9c6ee;
          border-radius: 14px;
          background: #eef3fb;
          color: #1656bd;
          font-size: 18px;
          font-weight: 900;
        }

        .metric-content {
          min-width: 0;
          display: flex;
          flex-direction: column;
        }

        .metric-content span {
          color: #64748b;
          font-size: 9px;
          font-weight: 850;
        }

        .metric-content strong {
          margin-top: 3px;
          color: #071226;
          font-size: 23px;
          font-weight: 900;
          letter-spacing: -0.025em;
        }

        .metric-content small {
          margin-top: 3px;
          color: #94a3b8;
          font-size: 8px;
        }
      `}</style>
    </article>
  );
}

function Feature({ title, description }: { title: string; description: string }) {
  return (
    <div className="feature">
      <div className="feature-check">✓</div>
      <div>
        <strong>{title}</strong>
        <p>{description}</p>
      </div>

      <style jsx>{`
        .feature {
          min-width: 0;
          display: flex;
          align-items: flex-start;
          gap: 10px;
          padding: 13px;
          border: 1px solid #e2e8f0;
          border-radius: 13px;
          background: #f8fbff;
          box-sizing: border-box;
        }

        .feature-check {
          width: 24px;
          height: 24px;
          flex: 0 0 auto;
          display: grid;
          place-items: center;
          border-radius: 8px;
          background: #eef3fb;
          color: #1656bd;
          font-size: 10px;
          font-weight: 900;
        }

        strong {
          color: #071226;
          font-size: 11px;
          font-weight: 850;
        }

        p {
          margin: 4px 0 0;
          color: #64748b;
          font-size: 9px;
          line-height: 1.5;
        }
      `}</style>
    </div>
  );
}

function AccountRow({
  label,
  value,
  indicator = false,
}: {
  label: string;
  value: string;
  indicator?: boolean;
}) {
  return (
    <div className="account-row">
      <span>{label}</span>
      <strong className="account-value">
        {indicator && <i />}
        {value}
      </strong>

      <style jsx>{`
        .account-row {
          min-width: 0;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 15px;
          padding: 13px 0;
          border-bottom: 1px solid #e2e8f0;
        }

        .account-row > span {
          color: #64748b;
          font-size: 10px;
        }

        .account-value {
          display: flex;
          align-items: center;
          gap: 7px;
          color: #071226;
          font-size: 10px;
          font-weight: 800;
          text-align: right;
        }

        .account-value i {
          width: 6px;
          height: 6px;
          flex: 0 0 auto;
          border-radius: 999px;
          background: #22c55e;
          box-shadow: 0 0 7px rgba(34, 197, 94, 0.45);
        }
      `}</style>
    </div>
  );
}

function capitalizar(value: string) {
  if (!value) return "Free";
  return value.charAt(0).toUpperCase() + value.slice(1);
}