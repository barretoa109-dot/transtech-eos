export const radius = {
  none: 0,
  xs: 6,
  sm: 9,
  md: 12,
  lg: 16,
  xl: 20,
  "2xl": 24,
  "3xl": 30,
  full: 999,
} as const;

export type EOSRadius = typeof radius;