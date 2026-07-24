"use client";

import { ReactNode } from "react";

type Props = {
  children: ReactNode;
};

export default function Section({
  children,
}: Props) {
  return (
    <section
      style={{
        marginBottom: 36,
      }}
    >
      {children}
    </section>
  );
}