"use client";

import { eosTheme } from "../theme/theme";

type Props = {
  value: number;
};

export default function ProgressBar({
  value,
}: Props) {
  return (
    <div
      style={{
        width: "100%",

        height: 10,

        borderRadius: 999,

        background: eosTheme.colors.surface.tertiary,

        overflow: "hidden",
      }}
    >
      <div
        style={{
          width: `${value}%`,

          height: "100%",

          background:
            eosTheme.colors.gradient.accent,

          transition: "width .6s ease",
        }}
      />
    </div>
  );
}