"use client";

import type { CSSProperties } from "react";

import Logo from "./Logo";
import Wordmark from "./Wordmark";

type BrandProps = {
  product?: string;
  subtitle?: string;
  dark?: boolean;
  compact?: boolean;
  logoSize?: number;
  style?: CSSProperties;
};

export default function Brand({
  product = "EOS",
  subtitle = "Executive Operating System",
  dark = false,
  compact = false,
  logoSize = compact ? 40 : 46,
  style,
}: BrandProps) {
  return (
    <div
      style={{
        minWidth: 0,
        display: "flex",
        alignItems: "center",
        gap: compact ? 11 : 14,
        ...style,
      }}
    >
      <Logo
        size={logoSize}
        priority
      />

      <Wordmark
        product={product}
        subtitle={subtitle}
        dark={dark}
        compact={compact}
      />
    </div>
  );
}