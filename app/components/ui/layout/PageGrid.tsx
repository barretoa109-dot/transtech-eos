"use client";

import { CSSProperties, ReactNode } from "react";

type PageGridProps = {
  children: ReactNode;
  columns?: number;
  minColumnWidth?: number;
  gap?: number;
  style?: CSSProperties;
};

export default function PageGrid({
  children,
  columns = 3,
  minColumnWidth = 210,
  gap = 24,
  style,
}: PageGridProps) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${columns}, minmax(${minColumnWidth}px, 1fr))`,
        gap,
        ...style,
      }}
      className="eos-page-grid"
    >
      {children}

      <style jsx>{`
        @media (max-width: 1100px) {
          .eos-page-grid {
            grid-template-columns: repeat(
              2,
              minmax(${minColumnWidth}px, 1fr)
            ) !important;
          }
        }

        @media (max-width: 620px) {
          .eos-page-grid {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </div>
  );
}