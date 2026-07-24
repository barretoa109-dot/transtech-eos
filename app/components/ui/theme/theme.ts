import { colors } from "./colors";
import { radius } from "./radius";
import { shadows } from "./shadows";
import { spacing } from "./spacing";
import { typography } from "./typography";

export const eosTheme = {
  colors,
  radius,
  shadows,
  spacing,
  typography,

  layout: {
    sidebarWidth: 280,
    topbarHeight: 72,
    contentMaxWidth: 1180,
    composerMaxWidth: 900,
  },

  transition: {
    fast: "140ms ease",
    normal: "200ms ease",
    slow: "300ms ease",
  },

  blur: {
    soft: "blur(12px)",
    medium: "blur(20px)",
    strong: "blur(34px)",
  },
} as const;

export type EOSTheme = typeof eosTheme;