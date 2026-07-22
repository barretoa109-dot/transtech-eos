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

      window.setTimeout(() => {
        setCopiado(false);
      }, 1800);
    } catch (error) {
      console.error("No se pudo copiar el ID del usuario:", error);
    }
  }

  return (
    <div style={styles.page}>
      <div style={styles.glowOne} />
      <div style={styles.glowTwo} />

      <div style={styles.container}>
        <header style={styles.header}>
          <div>
            <div style={styles.eyebrowRow}>
              <span style={styles.statusDot} />
              <span style={styles.eyebrow}>PERFIL EOS</span>
            </div>

            <h1 style={styles.title}>Tu espacio personal</h1>

            <p style={styles.subtitle}>
              Información general de tu cuenta y del uso actual de TransTech
              EOS.
            </p>
          </div>

          <div style={styles.accountStatus}>
            <span style={styles.accountStatusLabel}>ESTADO DE LA CUENTA</span>

            <div style={styles.accountStatusValue}>
              <span style={styles.activeDot} />
              EOS activo
            </div>
          </div>
        </header>

        <section style={styles.profileCard}>
          <div style={styles.profileIdentity}>
            <div style={styles.avatarOuter}>
              <div style={styles.avatar}>{inicial}</div>
              <span style={styles.avatarStatus} />
            </div>

            <div style={styles.identityContent}>
              <span style={styles.profileLabel}>USUARIO TRANSTECH EOS</span>

              <h2 style={styles.profileName}>{nombre || "Usuario"}</h2>

              <div style={styles.profileTags}>
                <span style={styles.planTag}>
                  Plan {capitalizar(planVisible)}
                </span>

                <span style={styles.connectedTag}>
                  <span style={styles.connectedDot} />
                  Conectado
                </span>
              </div>
            </div>
          </div>

          <div style={styles.userIdCard}>
            <div style={styles.userIdHeader}>
              <div>
                <span style={styles.userIdLabel}>IDENTIFICADOR DE USUARIO</span>
                <p style={styles.userIdDescription}>
                  Código único asociado a tu cuenta.
                </p>
              </div>

              <button
                type="button"
                onClick={copiarUsuarioId}
                disabled={!usuarioId}
                style={{
                  ...styles.copyButton,
                  ...(!usuarioId ? styles.copyButtonDisabled : {}),
                }}
              >
                {copiado ? "Copiado" : "Copiar"}
              </button>
            </div>

            <code style={styles.userIdValue}>{idVisible}</code>
          </div>
        </section>

        <section style={styles.metricsGrid}>
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

        <div style={styles.contentGrid}>
          <section style={styles.card}>
            <div style={styles.cardHeader}>
              <div>
                <span style={styles.sectionEyebrow}>CAPACIDADES</span>
                <h3 style={styles.cardTitle}>Funciones disponibles</h3>
              </div>

              <span style={styles.featureCount}>6 activas</span>
            </div>

            <div style={styles.featuresGrid}>
              <Feature
                title="Asesor EOS"
                description="Conversaciones inteligentes y análisis contextual."
              />

              <Feature
                title="Memoria"
                description="Uso del contexto registrado para mejorar respuestas."
              />

              <Feature
                title="Briefing"
                description="Resumen ejecutivo con prioridades y recomendaciones."
              />

              <Feature
                title="Documentos"
                description="Generación de archivos y entregables profesionales."
              />

              <Feature
                title="Dashboard"
                description="Indicadores generales del espacio de trabajo."
              />

              <Feature
                title="Historial"
                description="Acceso a conversaciones registradas anteriormente."
              />
            </div>
          </section>

          <section style={styles.card}>
            <div style={styles.cardHeader}>
              <div>
                <span style={styles.sectionEyebrow}>CUENTA</span>
                <h3 style={styles.cardTitle}>Resumen del acceso</h3>
              </div>

              <span style={styles.shieldIcon}>◇</span>
            </div>

            <div style={styles.accountList}>
              <AccountRow
                label="Estado"
                value="Activo"
                indicator
              />

              <AccountRow
                label="Plan"
                value={capitalizar(planVisible)}
              />

              <AccountRow
                label="Memoria contextual"
                value="Habilitada"
              />

              <AccountRow
                label="Asistente EOS"
                value="Disponible"
              />
            </div>

            <div style={styles.securityNotice}>
              <span style={styles.securityIcon}>✓</span>

              <div>
                <strong style={styles.securityTitle}>
                  Espacio protegido
                </strong>

                <p style={styles.securityText}>
                  Tu identificador permite asociar correctamente las
                  conversaciones y los datos de tu cuenta.
                </p>
              </div>
            </div>
          </section>
        </div>

        <footer style={styles.footer}>
          <span style={styles.footerDot} />

          <span>
            TransTech EOS está conectado y listo para trabajar con tu cuenta.
          </span>
        </footer>
      </div>
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
    <article style={styles.metricCard}>
      <div style={styles.metricIcon}>{icon}</div>

      <div style={styles.metricContent}>
        <span style={styles.metricLabel}>{label}</span>
        <strong style={styles.metricValue}>{value}</strong>
        <span style={styles.metricDescription}>{description}</span>
      </div>
    </article>
  );
}

function Feature({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div style={styles.feature}>
      <div style={styles.featureCheck}>✓</div>

      <div>
        <strong style={styles.featureTitle}>{title}</strong>
        <p style={styles.featureDescription}>{description}</p>
      </div>
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
    <div style={styles.accountRow}>
      <span style={styles.accountRowLabel}>{label}</span>

      <span style={styles.accountRowValue}>
        {indicator && <span style={styles.rowIndicator} />}
        {value}
      </span>
    </div>
  );
}

function capitalizar(value: string) {
  if (!value) return "Free";
  return value.charAt(0).toUpperCase() + value.slice(1);
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    position: "relative",
    flex: 1,
    minHeight: 0,
    overflowY: "auto",
    overflowX: "hidden",
    padding: "34px 28px 60px",
    background:
      "linear-gradient(180deg, #07101d 0%, #091524 48%, #07111f 100%)",
    color: "#f8fafc",
    fontFamily: "Inter, Arial, Helvetica, sans-serif",
  },

  glowOne: {
    position: "fixed",
    top: 110,
    right: "8%",
    width: 420,
    height: 420,
    borderRadius: 999,
    background: "rgba(14,165,233,0.07)",
    filter: "blur(120px)",
    pointerEvents: "none",
  },

  glowTwo: {
    position: "fixed",
    bottom: 40,
    left: "26%",
    width: 340,
    height: 340,
    borderRadius: 999,
    background: "rgba(34,211,238,0.04)",
    filter: "blur(110px)",
    pointerEvents: "none",
  },

  container: {
    position: "relative",
    zIndex: 1,
    width: "100%",
    maxWidth: 1120,
    margin: "0 auto",
  },

  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: 22,
    marginBottom: 25,
  },

  eyebrowRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    marginBottom: 11,
  },

  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 999,
    background: "#22d3ee",
    boxShadow: "0 0 11px rgba(34,211,238,0.8)",
  },

  eyebrow: {
    color: "#67e8f9",
    fontSize: 10,
    fontWeight: 900,
    letterSpacing: "0.18em",
  },

  title: {
    margin: 0,
    fontSize: "clamp(31px, 5vw, 46px)",
    lineHeight: 1.1,
    fontWeight: 900,
    letterSpacing: "-0.045em",
  },

  subtitle: {
    maxWidth: 580,
    margin: "14px 0 0",
    color: "#879bb2",
    fontSize: 14,
    lineHeight: 1.7,
  },

  accountStatus: {
    minWidth: 195,
    padding: "16px 18px",
    border: "1px solid rgba(148,163,184,0.12)",
    borderRadius: 17,
    background: "rgba(16,33,53,0.78)",
  },

  accountStatusLabel: {
    display: "block",
    marginBottom: 8,
    color: "#5f748c",
    fontSize: 8,
    fontWeight: 900,
    letterSpacing: "0.14em",
  },

  accountStatusValue: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    color: "#dff8ee",
    fontSize: 13,
    fontWeight: 800,
  },

  activeDot: {
    width: 7,
    height: 7,
    borderRadius: 999,
    background: "#22c55e",
    boxShadow: "0 0 9px rgba(34,197,94,0.55)",
  },

  profileCard: {
    display: "grid",
    gridTemplateColumns: "minmax(280px, 1fr) minmax(300px, 0.8fr)",
    gap: 22,
    padding: 24,
    borderRadius: 23,
    border: "1px solid rgba(103,232,249,0.16)",
    background:
      "linear-gradient(145deg, rgba(18,38,60,0.96), rgba(10,24,41,0.95))",
    boxShadow:
      "0 22px 52px rgba(2,8,23,0.25), inset 0 1px 0 rgba(255,255,255,0.035)",
  },

  profileIdentity: {
    display: "flex",
    alignItems: "center",
    gap: 19,
  },

  avatarOuter: {
    position: "relative",
    flexShrink: 0,
  },

  avatar: {
    width: 82,
    height: 82,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 25,
    background:
      "linear-gradient(135deg, #67e8f9 0%, #22d3ee 50%, #0ea5e9 100%)",
    color: "#073344",
    fontSize: 32,
    fontWeight: 950,
    boxShadow:
      "0 16px 30px rgba(14,165,233,0.22), inset 0 1px 0 rgba(255,255,255,0.5)",
  },

  avatarStatus: {
    position: "absolute",
    right: -2,
    bottom: -2,
    width: 18,
    height: 18,
    border: "4px solid #10243a",
    borderRadius: 999,
    background: "#22c55e",
  },

  identityContent: {
    minWidth: 0,
  },

  profileLabel: {
    color: "#62849a",
    fontSize: 8,
    fontWeight: 900,
    letterSpacing: "0.15em",
  },

  profileName: {
    margin: "7px 0 11px",
    overflow: "hidden",
    color: "#f7fbff",
    fontSize: 27,
    fontWeight: 900,
    letterSpacing: "-0.035em",
    textOverflow: "ellipsis",
  },

  profileTags: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 8,
  },

  planTag: {
    padding: "7px 10px",
    borderRadius: 999,
    background: "rgba(34,211,238,0.1)",
    border: "1px solid rgba(34,211,238,0.14)",
    color: "#67e8f9",
    fontSize: 9,
    fontWeight: 850,
  },

  connectedTag: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    padding: "7px 10px",
    borderRadius: 999,
    background: "rgba(148,163,184,0.07)",
    border: "1px solid rgba(148,163,184,0.1)",
    color: "#8498ae",
    fontSize: 9,
    fontWeight: 800,
  },

  connectedDot: {
    width: 5,
    height: 5,
    borderRadius: 999,
    background: "#22c55e",
  },

  userIdCard: {
    minWidth: 0,
    padding: 17,
    borderRadius: 17,
    border: "1px solid rgba(148,163,184,0.11)",
    background: "rgba(5,16,30,0.4)",
  },

  userIdHeader: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },

  userIdLabel: {
    color: "#70869d",
    fontSize: 8,
    fontWeight: 900,
    letterSpacing: "0.13em",
  },

  userIdDescription: {
    margin: "5px 0 0",
    color: "#536a82",
    fontSize: 9,
  },

  copyButton: {
    padding: "7px 11px",
    border: "1px solid rgba(34,211,238,0.15)",
    borderRadius: 9,
    background: "rgba(34,211,238,0.08)",
    color: "#67e8f9",
    fontSize: 9,
    fontWeight: 850,
    cursor: "pointer",
  },

  copyButtonDisabled: {
    opacity: 0.45,
    cursor: "not-allowed",
  },

  userIdValue: {
    display: "block",
    marginTop: 17,
    overflow: "hidden",
    padding: "11px 12px",
    borderRadius: 10,
    background: "rgba(2,8,23,0.47)",
    color: "#a5bbce",
    fontFamily: "monospace",
    fontSize: 10,
    lineHeight: 1.5,
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },

  metricsGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
    gap: 14,
    marginTop: 17,
  },

  metricCard: {
    display: "flex",
    alignItems: "center",
    gap: 14,
    padding: 19,
    borderRadius: 18,
    border: "1px solid rgba(148,163,184,0.12)",
    background:
      "linear-gradient(145deg, rgba(17,34,54,0.91), rgba(11,25,42,0.9))",
    boxShadow: "0 15px 32px rgba(2,8,23,0.14)",
  },

  metricIcon: {
    width: 46,
    height: 46,
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 14,
    background: "rgba(34,211,238,0.09)",
    border: "1px solid rgba(34,211,238,0.13)",
    color: "#67e8f9",
    fontSize: 18,
    fontWeight: 900,
  },

  metricContent: {
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
  },

  metricLabel: {
    color: "#72879e",
    fontSize: 9,
    fontWeight: 850,
  },

  metricValue: {
    marginTop: 3,
    color: "#f5fbff",
    fontSize: 23,
    fontWeight: 900,
    letterSpacing: "-0.025em",
  },

  metricDescription: {
    marginTop: 3,
    color: "#50677f",
    fontSize: 8,
  },

  contentGrid: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1.2fr) minmax(300px, 0.8fr)",
    gap: 16,
    marginTop: 17,
  },

  card: {
    padding: 22,
    borderRadius: 21,
    border: "1px solid rgba(148,163,184,0.12)",
    background:
      "linear-gradient(145deg, rgba(17,34,54,0.93), rgba(11,25,42,0.91))",
    boxShadow: "0 18px 37px rgba(2,8,23,0.16)",
  },

  cardHeader: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 18,
  },

  sectionEyebrow: {
    color: "#5e7c92",
    fontSize: 8,
    fontWeight: 900,
    letterSpacing: "0.14em",
  },

  cardTitle: {
    margin: "5px 0 0",
    color: "#eff8ff",
    fontSize: 19,
    fontWeight: 850,
    letterSpacing: "-0.025em",
  },

  featureCount: {
    padding: "6px 9px",
    borderRadius: 999,
    background: "rgba(34,211,238,0.08)",
    color: "#67e8f9",
    fontSize: 8,
    fontWeight: 850,
  },

  featuresGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
    gap: 11,
  },

  feature: {
    display: "flex",
    alignItems: "flex-start",
    gap: 10,
    padding: 13,
    borderRadius: 13,
    background: "rgba(148,163,184,0.045)",
    border: "1px solid rgba(148,163,184,0.075)",
  },

  featureCheck: {
    width: 24,
    height: 24,
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
    background: "rgba(34,211,238,0.09)",
    color: "#67e8f9",
    fontSize: 10,
    fontWeight: 900,
  },

  featureTitle: {
    color: "#dfeef8",
    fontSize: 11,
    fontWeight: 850,
  },

  featureDescription: {
    margin: "4px 0 0",
    color: "#667c94",
    fontSize: 9,
    lineHeight: 1.5,
  },

  shieldIcon: {
    color: "#4f7188",
    fontSize: 21,
  },

  accountList: {
    display: "grid",
  },

  accountRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 15,
    padding: "13px 0",
    borderBottom: "1px solid rgba(148,163,184,0.075)",
  },

  accountRowLabel: {
    color: "#71879e",
    fontSize: 10,
  },

  accountRowValue: {
    display: "flex",
    alignItems: "center",
    gap: 7,
    color: "#dceaf4",
    fontSize: 10,
    fontWeight: 800,
  },

  rowIndicator: {
    width: 6,
    height: 6,
    borderRadius: 999,
    background: "#22c55e",
    boxShadow: "0 0 7px rgba(34,197,94,0.45)",
  },

  securityNotice: {
    display: "flex",
    alignItems: "flex-start",
    gap: 11,
    marginTop: 17,
    padding: 14,
    borderRadius: 13,
    background: "rgba(34,211,238,0.055)",
    border: "1px solid rgba(34,211,238,0.09)",
  },

  securityIcon: {
    width: 24,
    height: 24,
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
    background: "rgba(34,211,238,0.11)",
    color: "#67e8f9",
    fontSize: 10,
    fontWeight: 900,
  },

  securityTitle: {
    color: "#dff7fb",
    fontSize: 10,
    fontWeight: 850,
  },

  securityText: {
    margin: "4px 0 0",
    color: "#648296",
    fontSize: 8,
    lineHeight: 1.55,
  },

  footer: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginTop: 23,
    color: "#52677f",
    fontSize: 9,
    textAlign: "center",
  },

  footerDot: {
    width: 5,
    height: 5,
    flexShrink: 0,
    borderRadius: 999,
    background: "#22c55e",
  },
};