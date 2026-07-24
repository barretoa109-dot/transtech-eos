"use client";

import type { ReactNode } from "react";
import { eosTheme } from "../ui/theme/theme";

type SidebarSectionProps = {
  title?: string;
  children: ReactNode;
  style?: React.CSSProperties;
};

export default function SidebarSection({
  title,
  children,
  style,
}: SidebarSectionProps) {
  return (
    <section
      style={{
        display: "grid",
        gap: 8,
        ...style,
      }}
    >
      {title ? (
        <div
          style={{
            padding: "0 12px",
            color: eosTheme.colors.text.subtle,
            fontSize: 10,
            fontWeight: 800,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
          }}
        >
          {title}
        </div>
      ) : null}

      {children}
    </section>
  );
}