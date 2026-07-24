"use client";

import {
  Activity,
  ArrowUpRight,
  Sparkles,
} from "lucide-react";

import { eosTheme } from "../ui/theme/theme";

type SidebarScoreProps = {
  score?: number;
  label?: string;
  description?: string;
  onOpenDashboard?: () => void;
};

function normalizeScore(score: number) {
  if (!Number.isFinite(score)) return 0;

  return Math.min(100, Math.max(0, Math.round(score)));
}

function getScoreStatus(score: number) {
  if (score >= 90) {
    return {
      label: "Excelente",
      color: eosTheme.colors.state.success,
      background: eosTheme.colors.state.successSoft,
    };
  }

  if (score >= 75) {
    return {
      label: "Muy bueno",
      color: eosTheme.colors.accent.cyan,
      background: eosTheme.colors.state.infoSoft,
    };
  }

  if (score >= 55) {
    return {
      label: "En progreso",
      color: eosTheme.colors.state.warning,
      background: eosTheme.colors.state.warningSoft,
    };
  }

  return {
    label: "Requiere atención",
    color: eosTheme.colors.state.danger,
    background: eosTheme.colors.state.dangerSoft,
  };
}

export default function SidebarScore({
  score = 84,
  label = "EOS Score",
  description = "Estado general de tu operación",
  onOpenDashboard,
}: SidebarScoreProps) {
  const normalizedScore = normalizeScore(score);
  const scoreStatus = getScoreStatus(normalizedScore);

  return (
    <div
      style={{
        position: "relative",
        overflow: "hidden",
        padding: 18,
        borderRadius: eosTheme.radius.xl,
        border: `1px solid ${eosTheme.colors.border.subtle}`,
        background: eosTheme.colors.gradient.cardSoft,
        boxShadow: eosTheme.shadows.inner,
      }}
    >
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          top: -70,
          right: -65,
          width: 150,
          height: 150,
          borderRadius: "50%",
          background: eosTheme.colors.glow.cyanSoft,
          filter: "blur(35px)",
          pointerEvents: "none",
        }}
      />

      <div
        style={{
          position: "relative",
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 7,
              color: eosTheme.colors.accent.cyanLight,
              fontSize: 10,
              fontWeight: 900,
              letterSpacing: "0.13em",
              textTransform: "uppercase",
            }}
          >
            <Sparkles size={13} strokeWidth={2.2} />
            {label}
          </div>

          <p
            style={{
              margin: "7px 0 0",
              color: eosTheme.colors.text.muted,
              fontSize: 11,
              lineHeight: 1.45,
            }}
          >
            {description}
          </p>
        </div>

        <div
          style={{
            width: 38,
            height: 38,
            flexShrink: 0,
            display: "grid",
            placeItems: "center",
            borderRadius: 13,
            color: eosTheme.colors.accent.cyan,
            background: eosTheme.colors.state.infoSoft,
          }}
        >
          <Activity size={19} />
        </div>
      </div>

      <div
        style={{
          position: "relative",
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          gap: 12,
          marginTop: 18,
        }}
      >
        <div
          style={{
            color: eosTheme.colors.text.primary,
            fontSize: 36,
            fontWeight: 900,
            lineHeight: 1,
            letterSpacing: "-0.05em",
          }}
        >
          {normalizedScore}
        </div>

        <span
          style={{
            padding: "5px 9px",
            borderRadius: 999,
            color: scoreStatus.color,
            background: scoreStatus.background,
            fontSize: 10,
            fontWeight: 800,
          }}
        >
          {scoreStatus.label}
        </span>
      </div>

      <div
        style={{
          height: 7,
          marginTop: 15,
          overflow: "hidden",
          borderRadius: 999,
          background: eosTheme.colors.surface.tertiary,
        }}
      >
        <div
          style={{
            width: `${normalizedScore}%`,
            height: "100%",
            borderRadius: 999,
            background: eosTheme.colors.gradient.accent,
            boxShadow: `0 0 18px ${eosTheme.colors.glow.cyan}`,
            transition: "width 600ms ease",
          }}
        />
      </div>

      {onOpenDashboard ? (
        <button
          type="button"
          onClick={onOpenDashboard}
          style={{
            width: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
            marginTop: 15,
            padding: "10px 0 0",
            border: 0,
            borderTop: `1px solid ${eosTheme.colors.border.subtle}`,
            background: "transparent",
            color: eosTheme.colors.text.secondary,
            fontSize: 11,
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          Ver estado completo
          <ArrowUpRight size={15} />
        </button>
      ) : null}
    </div>
  );
}