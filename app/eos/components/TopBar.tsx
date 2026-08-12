"use client";

import Link from "next/link";
import { BrainCircuit, Files, ShieldCheck } from "lucide-react";

type TopBarProps = {
  onOpenDocuments?: () => void;
  onOpenAutonomy?: () => void;
};

export default function TopBar({
  onOpenDocuments,
  onOpenAutonomy,
}: TopBarProps) {
  return (
    <header className="tt-header">
      <div className="tt-background" />

      <div className="tt-actions">
        <Link href="/eos/twin" className="tt-navigation-pill tt-link-pill">
          <BrainCircuit size={15} />
          Twin
        </Link>

        {onOpenAutonomy && (
          <button
            type="button"
            className="tt-navigation-pill"
            onClick={onOpenAutonomy}
          >
            <ShieldCheck size={15} />
            Autonomía
          </button>
        )}

        {onOpenDocuments && (
          <button
            type="button"
            className="tt-navigation-pill"
            onClick={onOpenDocuments}
          >
            <Files size={15} />
            Documentos
          </button>
        )}

        <div className="tt-status">
          <span className="tt-dot" />
          Sistema activo
        </div>

        <div className="tt-pill">Memoria contextual</div>
      </div>

      <style jsx>{`
        .tt-header {
          position: relative;
          z-index: 50;
          min-height: 86px;
          display: flex;
          align-items: center;
          justify-content: flex-end;
          padding: 0 32px;
          overflow: hidden;
          border-bottom: 1px solid rgba(148, 163, 184, 0.18);
          background: rgba(255, 255, 255, 0.86);
          backdrop-filter: blur(22px);
          -webkit-backdrop-filter: blur(22px);
        }

        .tt-background {
          position: absolute;
          inset: 0;
          pointer-events: none;
          background:
            radial-gradient(
              circle at top right,
              rgba(59, 130, 246, 0.1),
              transparent 40%
            ),
            radial-gradient(
              circle at left,
              rgba(37, 99, 235, 0.05),
              transparent 35%
            ),
            linear-gradient(
              180deg,
              rgba(255, 255, 255, 0.96),
              rgba(255, 255, 255, 0.88)
            );
        }

        .tt-actions {
          position: relative;
          z-index: 1;
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 10px;
        }

        .tt-navigation-pill {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 10px 15px;
          border: 1px solid #bfdbfe;
          border-radius: 999px;
          background: #eff6ff;
          color: #1d4ed8;
          font-family: inherit;
          font-size: 12px;
          font-weight: 800;
          cursor: pointer;
          box-shadow: 0 8px 24px rgba(37, 99, 235, 0.08);
          transition:
            transform 180ms ease,
            border-color 180ms ease,
            box-shadow 180ms ease;
        }

        :global(.tt-link-pill) {
          text-decoration: none;
        }

        .tt-navigation-pill:hover,
        :global(.tt-link-pill:hover) {
          transform: translateY(-1px);
          border-color: #60a5fa;
          box-shadow: 0 12px 28px rgba(37, 99, 235, 0.14);
        }

        .tt-status {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 11px 22px;
          border: 1px solid #bbf7d0;
          border-radius: 999px;
          background: #f0fdf4;
          color: #0f8b4c;
          font-size: 13px;
          font-weight: 700;
          box-shadow: 0 10px 30px rgba(34, 197, 94, 0.1);
        }

        .tt-dot {
          width: 8px;
          height: 8px;
          border-radius: 999px;
          background: #22c55e;
          box-shadow: 0 0 12px rgba(34, 197, 94, 0.8);
        }

        .tt-pill {
          padding: 11px 22px;
          border: 1px solid #dbeafe;
          border-radius: 999px;
          background: #ffffff;
          color: #334155;
          font-size: 13px;
          font-weight: 700;
          cursor: default;
          box-shadow: 0 8px 24px rgba(37, 99, 235, 0.05);
        }

        @media (max-width: 820px) {
          .tt-header {
            min-height: 72px;
            padding: 0 12px 0 64px;
          }

          .tt-actions {
            gap: 6px;
          }

          .tt-status,
          .tt-pill,
          .tt-navigation-pill,
          :global(.tt-link-pill) {
            padding: 8px 9px;
            font-size: 9px;
          }

          .tt-pill {
            display: none;
          }
        }

        @media (max-width: 540px) {
          .tt-status {
            display: none;
          }
        }
      `}</style>
    </header>
  );
}
