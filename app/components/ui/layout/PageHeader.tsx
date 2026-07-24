"use client";

import { ReactNode } from "react";
import { eosTheme } from "../theme/theme";

type Props = {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
};

export default function PageHeader({
  title,
  subtitle,
  actions,
}: Props) {
  return (
    <div
      style={{
        display: "flex",

        justifyContent: "space-between",

        alignItems: "center",

        marginBottom: 34,
      }}
    >
      <div>
        <h1
          style={{
            margin: 0,

            fontSize: 38,

            fontWeight: 800,

            color: eosTheme.colors.text.primary,
          }}
        >
          {title}
        </h1>

        {subtitle && (
          <p
            style={{
              marginTop: 10,

              color: eosTheme.colors.text.muted,

              lineHeight: 1.6,
            }}
          >
            {subtitle}
          </p>
        )}
      </div>

      {actions}
    </div>
  );
}