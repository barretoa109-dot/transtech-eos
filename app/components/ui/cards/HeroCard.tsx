"use client";

import { ReactNode } from "react";
import GlassCard from "./GlassCard";
import { eosTheme } from "../theme/theme";

type Props = {
  title: string;
  subtitle: string;
  children?: ReactNode;
};

export default function HeroCard({
  title,
  subtitle,
  children,
}: Props) {
  return (
    <GlassCard
      style={{
        background:
          eosTheme.colors.gradient.hero,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 30,
          alignItems: "center",
        }}
      >
        <div>
          <p
            style={{
              color:
                eosTheme.colors.accent.cyanLight,

              fontSize: 11,

              fontWeight: 900,

              letterSpacing: ".18em",

              margin: 0,
            }}
          >
            TRANSTECH EOS
          </p>

          <h1
            style={{
              marginTop: 12,

              marginBottom: 12,

              fontSize: 42,

              color:
                eosTheme.colors.text.primary,
            }}
          >
            {title}
          </h1>

          <p
            style={{
              color:
                eosTheme.colors.text.muted,

              maxWidth: 600,

              lineHeight: 1.8,
            }}
          >
            {subtitle}
          </p>
        </div>

        {children}
      </div>
    </GlassCard>
  );
}