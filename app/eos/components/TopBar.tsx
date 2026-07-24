"use client";

export default function TopBar() {
  return (
    <header className="tt-header">
      <div className="tt-background" />

      <div className="tt-actions">
        <div className="tt-status">
          <span className="tt-dot" />
          Sistema activo
        </div>

        <div className="tt-pill">
          Memoria contextual
        </div>
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
          gap: 14px;
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
          transition:
            transform 180ms ease,
            border-color 180ms ease,
            box-shadow 180ms ease;
        }

        .tt-pill:hover {
          transform: translateY(-2px);
          border-color: #3b82f6;
          box-shadow: 0 14px 30px rgba(37, 99, 235, 0.12);
        }

        @media (max-width: 640px) {
          .tt-header {
            min-height: 72px;
            padding: 0 16px;
          }

          .tt-actions {
            gap: 8px;
          }

          .tt-status,
          .tt-pill {
            padding: 9px 13px;
            font-size: 10px;
          }
        }
      `}</style>
    </header>
  );
}