"use client";

import GlassCard from "./GlassCard";
import { eosTheme } from "../theme/theme";

type Props = {
  title: string;
  children: React.ReactNode;
};

export default function InfoCard({
  title,
  children,
}: Props) {
  return (
    <GlassCard>
      <h3
        style={{
          marginTop: 0,

          marginBottom: 20,

          fontSize: 22,

          color:
            eosTheme.colors.text.primary,
        }}
      >
        {title}
      </h3>

      {children}
    </GlassCard>
  );
}