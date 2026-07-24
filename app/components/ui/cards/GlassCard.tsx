"use client";

import { CSSProperties, ReactNode } from "react";
import { eosTheme } from "../theme/theme";

type GlassCardProps = {
  children: ReactNode;
  style?: CSSProperties;
  padding?: number;
  hover?: boolean;
};

export default function GlassCard({
  children,
  style,
  padding = 24,
  hover = true,
}: GlassCardProps) {
  return (
    <div
      style={{
        background: eosTheme.colors.gradient.card,

        border: `1px solid ${eosTheme.colors.border.default}`,

        borderRadius: eosTheme.radius.xl,

        boxShadow: `${eosTheme.shadows.card},
                    ${eosTheme.shadows.inner}`,

        backdropFilter: eosTheme.blur.medium,

        transition: eosTheme.transition.normal,

        padding,

        ...style,
      }}
      onMouseEnter={(e) => {
        if (!hover) return;

        e.currentTarget.style.transform =
          "translateY(-4px)";

        e.currentTarget.style.boxShadow =
          eosTheme.shadows.elevated;
      }}
      onMouseLeave={(e) => {
        if (!hover) return;

        e.currentTarget.style.transform =
          "translateY(0px)";

        e.currentTarget.style.boxShadow =
          `${eosTheme.shadows.card},
           ${eosTheme.shadows.inner}`;
      }}
    >
      {children}
    </div>
  );
}