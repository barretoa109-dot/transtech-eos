"use client";

import { ReactNode } from "react";
import { eosTheme } from "../theme/theme";

type Props = {
  children: ReactNode;
};

export default function Text({
  children,
}: Props) {
  return (
    <p
      style={{
        color: eosTheme.colors.text.secondary,

        lineHeight: 1.8,

        margin: 0,
      }}
    >
      {children}
    </p>
  );
}