"use client";

import { ButtonHTMLAttributes } from "react";
import { eosTheme } from "../theme/theme";

type Props = ButtonHTMLAttributes<HTMLButtonElement>;

export default function GhostButton({
  children,
  style,
  ...props
}: Props) {
  return (
    <button
      {...props}
      style={{
        background: "transparent",

        border: "none",

        cursor: "pointer",

        color: eosTheme.colors.text.secondary,

        padding: "10px 18px",

        borderRadius: eosTheme.radius.md,

        transition: eosTheme.transition.normal,

        ...style,
      }}
    >
      {children}
    </button>
  );
}