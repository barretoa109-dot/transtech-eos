"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import type { TechCanvasConfig } from "./TechCanvas";
import { puedeAnimarFondo } from "@/lib/efectos/puede-animar-fondo";

const TechCanvas = dynamic(() => import("./TechCanvas"), { ssr: false });

type AmbientBackgroundProps = {
  techConfig: TechCanvasConfig;
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
 *
 * The 3D wireframe is three.js: ~725 KB of JavaScript plus a canvas redrawn
 * every frame. Measured 30/09/2026 on the home page (Lighthouse, mobile): 53/100,
 * almost 3 s of main-thread blocking and 6.3 s to interactive, most of it that
 * chunk. It also runs inside /eos/chat, i.e. the app itself. So it now loads
 * only after the page is idle, and never on phones, low-end devices, "save
 * data" connections or with reduced motion — the aurora and the grid (plain
 * CSS) stay everywhere, so the look barely changes.
 */
export default function AmbientBackground({ techConfig, gridVeil = true, spanCount = 3 }: AmbientBackgroundProps) {
  const [conCanvas, setConCanvas] = useState(false);

  useEffect(() => {
    if (!puedeAnimarFondo(window)) return;
    const w = window as Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    if (w.requestIdleCallback) {
      const id = w.requestIdleCallback(() => setConCanvas(true), { timeout: 2500 });
      return () => w.cancelIdleCallback?.(id);
    }
    const id = window.setTimeout(() => setConCanvas(true), 1500);
    return () => window.clearTimeout(id);
  }, []);

  return (
    <>
      {conCanvas && <TechCanvas config={techConfig} />}
      <div className="eos-aurora" aria-hidden="true">
        {Array.from({ length: spanCount }).map((_, i) => (
          <span key={i} />
        ))}
      </div>
      {gridVeil && <div className="eos-grid-veil" aria-hidden="true" />}
    </>
  );
}
