"use client";

import { eosTheme } from "../theme/theme";

type Props = {
  value: number;
};

export default function ProgressRing({
  value,
}: Props) {
  const radius = 70;
  const stroke = 10;

  const normalized = radius - stroke;

  const circumference =
    normalized * 2 * Math.PI;

  const offset =
    circumference -
    (value / 100) * circumference;

  return (
    <svg
      width={160}
      height={160}
    >
      <circle
        cx={80}
        cy={80}
        r={normalized}
        stroke={eosTheme.colors.surface.secondary}
        strokeWidth={stroke}
        fill="transparent"
      />

      <circle
        cx={80}
        cy={80}
        r={normalized}
        stroke={eosTheme.colors.accent.cyan}
        strokeWidth={stroke}
        fill="transparent"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        strokeLinecap="round"
        transform="rotate(-90 80 80)"
      />

      <text
        x="50%"
        y="50%"
        textAnchor="middle"
        dy=".35em"
        fill={eosTheme.colors.text.primary}
        fontSize="30"
        fontWeight="bold"
      >
        {value}%
      </text>
    </svg>
  );
}