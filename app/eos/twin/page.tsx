"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import BusinessTwinView from "../components/BusinessTwinView";

export default function BusinessTwinPage() {
  return (
    <main className="twin-shell">
      <div className="twin-shell-topbar">
        <Link href="/eos/chat" className="back-link">
          <ArrowLeft size={15} />
          Volver a EOS
        </Link>

        <div className="shell-brand">
          <strong>TransTech EOS</strong>
          <span>Business Twin</span>
        </div>
      </div>

      <div className="twin-content">
        <BusinessTwinView />
      </div>

      <style jsx>{`
        .twin-shell {
          width: 100vw;
          min-height: 100dvh;
          overflow-x: hidden;
          background: #07111f;
          font-family: Inter, Arial, Helvetica, sans-serif;
        }

        .twin-shell-topbar {
          position: sticky;
          top: 0;
          z-index: 50;
          min-height: 68px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 18px;
          padding: 0 24px;
          border-bottom: 1px solid rgba(148, 163, 184, 0.18);
          background: rgba(7, 17, 31, 0.9);
          backdrop-filter: blur(20px);
        }

        .twin-content {
          min-height: calc(100dvh - 68px);
        }

        .shell-brand {
          display: flex;
          align-items: center;
          gap: 10px;
          color: #e2e8f0;
        }

        .shell-brand strong {
          color: #ffffff;
          font-size: 12px;
        }

        .shell-brand span {
          padding-left: 10px;
          border-left: 1px solid rgba(148, 163, 184, 0.28);
          color: #60a5fa;
          font-size: 10px;
          font-weight: 800;
        }

        :global(.back-link) {
          display: inline-flex;
          align-items: center;
          gap: 7px;
          padding: 9px 12px;
          border: 1px solid rgba(96, 165, 250, 0.28);
          border-radius: 10px;
          color: #bfdbfe;
          background: rgba(37, 99, 235, 0.1);
          font-size: 10px;
          font-weight: 800;
          text-decoration: none;
        }

        @media (max-width: 600px) {
          .twin-shell-topbar {
            padding: 0 13px;
          }

          .shell-brand strong {
            display: none;
          }
        }
      `}</style>
    </main>
  );
}
