"use client";

import {
  Activity,
  BrainCircuit,
  ShieldAlert,
  Sparkles,
  TrendingUp,
} from "lucide-react";

import {
  GlassCard,
  ProgressRing,
  StatusBadge,
} from "@/app/components/ui";

import { eosTheme } from "@/app/components/ui/theme/theme";

type DashboardHeroProps = {
  score: number;
  level: string;
  risk: string;
  progress: number;
  diagnosis?: string;
};

function normalizePercentage(value: number) {
  if (!Number.isFinite(value)) return 0;

  return Math.min(100, Math.max(0, Math.round(value)));
}

function getRiskStatus(
  risk: string,
): "success" | "warning" | "danger" | "info" {
  const normalized = risk.trim().toLowerCase();

  if (
    normalized.includes("alto") ||
    normalized.includes("crítico") ||
    normalized.includes("critico")
  ) {
    return "danger";
  }

  if (
    normalized.includes("medio") ||
    normalized.includes("moderado")
  ) {
    return "warning";
  }

  if (
    normalized.includes("controlado") ||
    normalized.includes("bajo")
  ) {
    return "success";
  }

  return "info";
}

export default function DashboardHero({
  score,
  level,
  risk,
  progress,
  diagnosis,
}: DashboardHeroProps) {
  const normalizedScore = normalizePercentage(score);
  const normalizedProgress = normalizePercentage(progress);

  return (
    <GlassCard
      hover={false}
      padding={30}
      style={{
        position: "relative",
        overflow: "hidden",
        background: eosTheme.colors.gradient.hero,
      }}
    >
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          top: -180,
          right: -120,
          width: 420,
          height: 420,
          borderRadius: "50%",
          background: eosTheme.colors.glow.cyanSoft,
          filter: "blur(70px)",
          pointerEvents: "none",
        }}
      />

      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          bottom: -160,
          left: "30%",
          width: 320,
          height: 320,
          borderRadius: "50%",
          background: eosTheme.colors.glow.blue,
          filter: "blur(90px)",
          opacity: 0.35,
          pointerEvents: "none",
        }}
      />

      <div
        className="dashboard-hero-layout"
        style={{
          position: "relative",
          display: "grid",
          gridTemplateColumns:
            "minmax(0, 1.35fr) minmax(220px, 0.65fr)",
          alignItems: "center",
          gap: 36,
        }}
      >
        <div
          style={{
            minWidth: 0,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 9,
              color: eosTheme.colors.accent.cyanLight,
              fontSize: 11,
              fontWeight: 900,
              letterSpacing: "0.16em",
              textTransform: "uppercase",
            }}
          >
            <Sparkles size={15} />
            Motor de inteligencia EOS
          </div>

          <h2
            style={{
              margin: "15px 0 0",
              color: eosTheme.colors.text.primary,
              fontSize: "clamp(30px, 4vw, 48px)",
              fontWeight: 900,
              lineHeight: 1.08,
              letterSpacing: "-0.045em",
            }}
          >
            Estado estratégico de tu operación
          </h2>

          <p
            style={{
              maxWidth: 700,
              margin: "16px 0 0",
              color: eosTheme.colors.text.muted,
              fontSize: 14,
              lineHeight: 1.75,
            }}
          >
            {diagnosis ||
              "EOS analiza tus objetivos, tareas, seguimiento y actividad para determinar el nivel actual de avance."}
          </p>

          <div
            className="dashboard-hero-metrics"
            style={{
              display: "grid",
              gridTemplateColumns:
                "repeat(3, minmax(0, 1fr))",
              gap: 14,
              marginTop: 28,
            }}
          >
            <HeroMetric
              icon={<TrendingUp size={19} />}
              label="Nivel"
              value={level || "Inicial"}
              status="info"
            />

            <HeroMetric
              icon={<ShieldAlert size={19} />}
              label="Riesgo"
              value={risk || "Controlado"}
              status={getRiskStatus(risk)}
            />

            <HeroMetric
              icon={<Activity size={19} />}
              label="Progreso"
              value={`${normalizedProgress}%`}
              status={
                normalizedProgress >= 70
                  ? "success"
                  : normalizedProgress >= 40
                    ? "warning"
                    : "info"
              }
            />
          </div>

          <div
            style={{
              marginTop: 26,
              paddingTop: 22,
              borderTop: `1px solid ${eosTheme.colors.border.subtle}`,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                marginBottom: 10,
              }}
            >
              <span
                style={{
                  color: eosTheme.colors.text.secondary,
                  fontSize: 12,
                  fontWeight: 700,
                }}
              >
                Avance general
              </span>

              <strong
                style={{
                  color: eosTheme.colors.accent.cyanLight,
                  fontSize: 13,
                }}
              >
                {normalizedProgress}%
              </strong>
            </div>

            <div
              style={{
                width: "100%",
                height: 10,
                overflow: "hidden",
                borderRadius: 999,
                background: eosTheme.colors.surface.tertiary,
              }}
            >
              <div
                style={{
                  width: `${normalizedProgress}%`,
                  height: "100%",
                  borderRadius: 999,
                  background: eosTheme.colors.gradient.accent,
                  boxShadow: `0 0 22px ${eosTheme.colors.glow.cyan}`,
                  transition: "width 700ms ease",
                }}
              />
            </div>
          </div>
        </div>

        <div
          style={{
            display: "grid",
            justifyItems: "center",
            gap: 16,
          }}
        >
          <div
            style={{
              position: "relative",
              display: "grid",
              placeItems: "center",
            }}
          >
            <div
              aria-hidden="true"
              style={{
                position: "absolute",
                inset: 25,
                borderRadius: "50%",
                background: eosTheme.colors.gradient.glow,
                filter: "blur(20px)",
                pointerEvents: "none",
              }}
            />

            <ProgressRing value={normalizedScore} />
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 9,
              padding: "8px 12px",
              borderRadius: 999,
              border: `1px solid ${eosTheme.colors.border.accent}`,
              background: eosTheme.colors.state.infoSoft,
              color: eosTheme.colors.accent.cyanLight,
              fontSize: 11,
              fontWeight: 900,
            }}
          >
            <BrainCircuit size={15} />
            EOS Score
          </div>

          <StatusBadge
            status={
              normalizedScore >= 80
                ? "success"
                : normalizedScore >= 55
                  ? "warning"
                  : "danger"
            }
          >
            {normalizedScore >= 85
              ? "Rendimiento excelente"
              : normalizedScore >= 65
                ? "Buen rendimiento"
                : normalizedScore >= 40
                  ? "En desarrollo"
                  : "Requiere atención"}
          </StatusBadge>
        </div>
      </div>

      <style jsx>{`
        @media (max-width: 900px) {
          .dashboard-hero-layout {
            grid-template-columns: 1fr !important;
          }
        }

        @media (max-width: 650px) {
          .dashboard-hero-metrics {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </GlassCard>
  );
}

type HeroMetricProps = {
  icon: React.ReactNode;
  label: string;
  value: string;
  status: "success" | "warning" | "danger" | "info";
};

function HeroMetric({
  icon,
  label,
  value,
  status,
}: HeroMetricProps) {
  const statusMap = {
    success: {
      background: eosTheme.colors.state.successSoft,
      color: eosTheme.colors.state.success,
    },
    warning: {
      background: eosTheme.colors.state.warningSoft,
      color: eosTheme.colors.state.warning,
    },
    danger: {
      background: eosTheme.colors.state.dangerSoft,
      color: eosTheme.colors.state.danger,
    },
    info: {
      background: eosTheme.colors.state.infoSoft,
      color: eosTheme.colors.state.info,
    },
  };

  return (
    <div
      style={{
        minWidth: 0,
        padding: 16,
        borderRadius: eosTheme.radius.lg,
        border: `1px solid ${eosTheme.colors.border.subtle}`,
        background: eosTheme.colors.surface.transparent,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          color: statusMap[status].color,
        }}
      >
        <span
          style={{
            width: 35,
            height: 35,
            display: "grid",
            placeItems: "center",
            borderRadius: 12,
            background: statusMap[status].background,
          }}
        >
          {icon}
        </span>

        <span
          style={{
            color: eosTheme.colors.text.muted,
            fontSize: 10,
            fontWeight: 800,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
          }}
        >
          {label}
        </span>
      </div>

      <div
        style={{
          overflow: "hidden",
          marginTop: 12,
          color: eosTheme.colors.text.primary,
          fontSize: 18,
          fontWeight: 900,
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {value}
      </div>
    </div>
  );
}
