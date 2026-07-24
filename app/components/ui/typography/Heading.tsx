"use client";

import { ReactNode } from "react";
import { eosTheme } from "../theme/theme";

type Props = {
  children: ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
};

const sizes = {
  sm: 20,
  md: 28,
  lg: 38,
  xl: 52,
};

export default function Heading({
  children,
  size = "md",
}: Props) {
  return (
    <h2
      style={{
        fontSize: sizes[size],

        margin: 0,

        color: eosTheme.colors.text.primary,

        fontWeight: 800,
      }}
    >
      {children}
    </h2>
  );
}