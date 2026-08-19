"use client";

import dynamic from "next/dynamic";

const TechCanvas = dynamic(() => import("./TechCanvas"), { ssr: false });

type AmbientBackgroundProps = {
  gridVeil?: boolean;
  spanCount?: 2 | 3;
};

/**
 * Shared decorative backdrop (aurora blobs + subtle grid + rotating 3D
 * wireframe) used across the redesigned marketing/auth pages. Styling lives
 * in app/eos-design/tokens.css under the .eos-aurora / .eos-grid-veil /
 * .eos-tech-canvas classes. Light vs dark palette comes from the
 * [data-eos-theme] attribute set on the page's own root element (CSS custom
 * properties inherit down to this component regardless of where it renders).
 */
export default function AmbientBackground({ gridVeil = true, spanCount = 3 }: AmbientBackgroundProps) {
  return (
    <>
      <TechCanvas />
      <div className="eos-aurora" aria-hidden="true">
        {Array.from({ length: spanCount }).map((_, i) => (
          <span key={i} />
        ))}
      </div>
      {gridVeil && <div className="eos-grid-veil" aria-hidden="true" />}
    </>
  );
}
