"use client";

import { ButtonHTMLAttributes } from "react";
import { eosTheme } from "../theme/theme";

type Props = ButtonHTMLAttributes<HTMLButtonElement>;

export default function PrimaryButton({
  children,
  style,
  ...props
}: Props) {
  return (
    <button
      {...props}
      style={{
        border: "none",

        cursor: "pointer",

        padding: "14px 24px",

        borderRadius: eosTheme.radius.lg,

        background: eosTheme.colors.gradient.accent,

        color: "#fff",

        fontWeight: 700,

        fontSize: 15,

        boxShadow: eosTheme.shadows.accent,

        transition: eosTheme.transition.normal,

        ...style,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = "translateY(-2px)";
        e.currentTarget.style.filter = "brightness(1.08)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = "translateY(0)";
        e.currentTarget.style.filter = "brightness(1)";
      }}
    >
      {children}
    </button>
  );
}