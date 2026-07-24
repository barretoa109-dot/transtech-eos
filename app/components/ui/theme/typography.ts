export const typography = {
  fontFamily:
    "Inter, Arial, Helvetica, sans-serif",

  fontWeight: {
    regular: 400,
    medium: 500,
    semibold: 600,
    bold: 700,
    extraBold: 800,
    black: 900,
  },

  fontSize: {
    xs: 10,
    sm: 12,
    base: 14,
    md: 16,
    lg: 18,
    xl: 22,
    "2xl": 28,
    "3xl": 36,
    "4xl": 46,
    "5xl": 58,
  },

  lineHeight: {
    tight: 1.1,
    snug: 1.3,
    normal: 1.5,
    relaxed: 1.7,
  },

  letterSpacing: {
    tight: "-0.04em",
    normal: "0",
    wide: "0.08em",
    wider: "0.14em",
    widest: "0.18em",
  },
} as const;

export type EOSTypography = typeof typography;