"use client";

import { ReactNode } from "react";
import { eosTheme } from "../theme/theme";

type Props = {
  children: ReactNode;
};

export default function Label({
  children,
}: Props) {
  return (
    <div
      style={{
        color: eosTheme.colors.accent.cyan,

        textTransform: "uppercase",

        letterSpacing: ".15em",

        fontSize: 11,

        fontWeight: 800,
      }}
    >
      {children}
    </div>
  );
}