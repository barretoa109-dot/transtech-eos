"use client";

import GlassCard from "./GlassCard";
import { eosTheme } from "../theme/theme";

type Props = {
  text: string;
};

export default function RecommendationCard({
  text,
}: Props) {
  return (
    <GlassCard
      style={{
        background:
          "linear-gradient(145deg,#0f3146,#0b2437)",
      }}
    >
      <div
        style={{
          display: "flex",

          gap: 14,

          alignItems: "center",
        }}
      >
        <div
          style={{
            width: 44,

            height: 44,

            borderRadius: 14,

            background:
              eosTheme.colors.state.infoSoft,

            display: "flex",

            alignItems: "center",

            justifyContent: "center",

            color:
              eosTheme.colors.accent.cyan,

            fontWeight: 900,
          }}
        >
          ✦
        </div>

        <div>
          <div
            style={{
              fontWeight: 800,

              color:
                eosTheme.colors.text.primary,
            }}
          >
            Recomendación EOS
          </div>

          <div
            style={{
              color:
                eosTheme.colors.text.muted,

              marginTop: 6,

              lineHeight: 1.6,
            }}
          >
            {text}
          </div>
        </div>
      </div>
    </GlassCard>
  );
}