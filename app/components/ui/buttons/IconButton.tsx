"use client";

import { ButtonHTMLAttributes } from "react";
import { eosTheme } from "../theme/theme";

type Props = ButtonHTMLAttributes<HTMLButtonElement>;

export default function IconButton({
  children,
  style,
  ...props
}: Props) {
  return (
    <button
      {...props}
      style={{
        width: 46,

        height: 46,

        borderRadius: 14,

        border: `1px solid ${eosTheme.colors.border.default}`,

        background: eosTheme.colors.surface.secondary,

        color: eosTheme.colors.text.primary,

        display: "flex",

        justifyContent: "center",

        alignItems: "center",

        cursor: "pointer",

        ...style,
      }}
    >
      {children}
    </button>
  );
}