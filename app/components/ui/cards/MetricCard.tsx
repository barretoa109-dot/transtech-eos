"use client";

import GlassCard from "./GlassCard";
import { eosTheme } from "../theme/theme";

type Props = {
  icon: React.ReactNode;
  title: string;
  value: string | number;
  description?: string;
};

export default function MetricCard({
  icon,
  title,
  value,
  description,
}: Props) {
  return (
    <GlassCard>
      <div
        style={{
          display: "flex",

          gap: 18,

          alignItems: "center",
        }}
      >
        <div
          style={{
            width: 54,

            height: 54,

            borderRadius: 18,

            display: "flex",

            alignItems: "center",

            justifyContent: "center",

            background:
              eosTheme.colors.state.infoSoft,

            color:
              eosTheme.colors.accent.cyan,

            fontSize: 24,
          }}
        >
          {icon}
        </div>

        <div>
          <div
            style={{
              color:
                eosTheme.colors.text.muted,

              fontSize: 12,
            }}
          >
            {title}
          </div>

          <div
            style={{
              fontSize: 30,

              fontWeight: 900,

              color:
                eosTheme.colors.text.primary,
            }}
          >
            {value}
          </div>

          {description && (
            <div
              style={{
                color:
                  eosTheme.colors.text.subtle,

                fontSize: 11,
              }}
            >
              {description}
            </div>
          )}
        </div>
      </div>
    </GlassCard>
  );
}