"use client";

import { ButtonHTMLAttributes } from "react";
import { eosTheme } from "../theme/theme";

type Props = ButtonHTMLAttributes<HTMLButtonElement>;

export default function SecondaryButton({
  children,
  style,
  ...props
}: Props) {
  return (
    <button
      {...props}
      style={{
        cursor: "pointer",

        padding: "14px 24px",

        borderRadius: eosTheme.radius.lg,

        border: `1px solid ${eosTheme.colors.border.default}`,

        background: eosTheme.colors.surface.secondary,

        color: eosTheme.colors.text.primary,

        transition: eosTheme.transition.normal,

        ...style,
      }}
    >
      {children}
    </button>
  );
}