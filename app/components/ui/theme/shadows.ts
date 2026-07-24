export const shadows = {
  none: "none",

  soft:
    "0 10px 30px rgba(2, 8, 23, 0.18)",

  card:
    "0 18px 45px rgba(2, 8, 23, 0.26)",

  elevated:
    "0 28px 70px rgba(2, 8, 23, 0.38)",

  accent:
    "0 14px 34px rgba(14, 165, 233, 0.28)",

  success:
    "0 12px 28px rgba(34, 197, 94, 0.22)",

  danger:
    "0 12px 28px rgba(248, 113, 113, 0.22)",

  inner:
    "inset 0 1px 0 rgba(255, 255, 255, 0.045)",

  glow:
    "0 0 32px rgba(34, 211, 238, 0.18)",
} as const;

export type EOSShadows = typeof shadows;