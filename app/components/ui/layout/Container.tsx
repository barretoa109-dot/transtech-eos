"use client";

import { ReactNode } from "react";
import { eosTheme } from "../theme/theme";

type Props = {
  children: ReactNode;
  fluid?: boolean;
};

export default function Container({
  children,
  fluid = false,
}: Props) {
  return (
    <div
      style={{
        width: "100%",

        maxWidth: fluid
          ? "100%"
          : eosTheme.layout.contentMaxWidth,

        margin: "0 auto",

        padding: "32px",

        boxSizing: "border-box",
      }}
    >
      {children}
    </div>
  );
}