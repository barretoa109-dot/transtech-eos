export const colors = {
  background: {
    app: "#06101d",
    elevated: "#0b1828",
    elevatedSoft: "#102036",
    elevatedStrong: "#132842",
    overlay: "rgba(6, 16, 29, 0.78)",
  },

  surface: {
    primary: "rgba(15, 31, 51, 0.96)",
    secondary: "rgba(18, 39, 63, 0.92)",
    tertiary: "rgba(21, 46, 73, 0.88)",
    subtle: "rgba(148, 163, 184, 0.055)",
    transparent: "rgba(255, 255, 255, 0.025)",
  },

  border: {
    subtle: "rgba(148, 163, 184, 0.10)",
    default: "rgba(148, 163, 184, 0.16)",
    strong: "rgba(103, 232, 249, 0.24)",
    accent: "rgba(34, 211, 238, 0.28)",
    danger: "rgba(248, 113, 113, 0.22)",
    success: "rgba(34, 197, 94, 0.22)",
    warning: "rgba(250, 204, 21, 0.22)",
  },

  text: {
    primary: "#f8fafc",
    secondary: "#cbd5e1",
    muted: "#8fa3bb",
    subtle: "#64748b",
    disabled: "#475569",
    inverse: "#062330",
  },

  accent: {
    cyan: "#22d3ee",
    cyanLight: "#67e8f9",
    cyanDark: "#0891b2",
    blue: "#0ea5e9",
    blueStrong: "#2563eb",
    indigo: "#6366f1",
  },

  state: {
    success: "#22c55e",
    successSoft: "rgba(34, 197, 94, 0.10)",
    warning: "#facc15",
    warningSoft: "rgba(250, 204, 21, 0.10)",
    danger: "#f87171",
    dangerSoft: "rgba(248, 113, 113, 0.10)",
    info: "#38bdf8",
    infoSoft: "rgba(56, 189, 248, 0.10)",
  },

  gradient: {
    app:
      "linear-gradient(180deg, #06101d 0%, #091524 52%, #07111f 100%)",

    hero:
      "linear-gradient(145deg, rgba(18, 40, 65, 0.98), rgba(8, 24, 42, 0.96))",

    card:
      "linear-gradient(145deg, rgba(17, 35, 57, 0.94), rgba(9, 24, 41, 0.92))",

    cardSoft:
      "linear-gradient(145deg, rgba(17, 35, 57, 0.78), rgba(9, 24, 41, 0.72))",

    accent:
      "linear-gradient(135deg, #67e8f9 0%, #22d3ee 48%, #0ea5e9 100%)",

    success:
      "linear-gradient(135deg, #4ade80 0%, #22c55e 100%)",

    danger:
      "linear-gradient(135deg, #fb7185 0%, #ef4444 100%)",

    glow:
      "radial-gradient(circle, rgba(34, 211, 238, 0.18), transparent 68%)",
  },

  glow: {
    cyan: "rgba(34, 211, 238, 0.30)",
    cyanSoft: "rgba(34, 211, 238, 0.12)",
    blue: "rgba(14, 165, 233, 0.28)",
    success: "rgba(34, 197, 94, 0.28)",
    warning: "rgba(250, 204, 21, 0.22)",
    danger: "rgba(248, 113, 113, 0.22)",
  },
} as const;

export type EOSColors = typeof colors;