"use client";

import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  Home,
  MessageSquareText,
  Sparkles,
} from "lucide-react";

type DashboardHeaderProps = {
  userName: string;
  plan: string;
};

export default function DashboardHeader({
  userName,
  plan,
}: DashboardHeaderProps) {
  return (
    <header className="dashboard-header">
      <div className="header-background" />

      <div className="header-content">
        <div className="header-copy">
          <div className="header-brand">
            <div className="header-logo">
              <Image
                src="/transtech-logo.png"
                alt="Logo de TRANSTECH"
                fill
                priority
                sizes="44px"
                className="header-logo-image"
              />
            </div>

            <div>
              <span className="header-company">
                TRANSTECH EOS
              </span>

              <h1>
                Hola, {obtenerPrimerNombre(userName)}.
              </h1>
            </div>
          </div>

          <p>
            Tu centro de gestión, análisis y seguimiento ejecutivo.
          </p>

          <div className="header-plan">
            <span className="header-plan-dot" />
            Plan {capitalizar(plan)}
          </div>
        </div>

        <nav
          className="header-actions"
          aria-label="Acciones del dashboard"
        >
          <Link
            href="/eos/chat"
            className="header-primary-action"
          >
            <MessageSquareText size={17} />
            Abrir EOS
            <ArrowRight size={16} />
          </Link>

          <Link
            href="/"
            className="header-secondary-action"
          >
            <Home size={17} />
            Inicio
          </Link>
        </nav>
      </div>

      <style jsx>{`
        .dashboard-header {
          position: relative;
          overflow: hidden;
          border: 1px solid rgba(148, 163, 184, 0.18);
          border-radius: 32px;
          background: rgba(255, 255, 255, 0.9);
          box-shadow:
            0 24px 70px rgba(15, 23, 42, 0.08),
            inset 0 1px 0 rgba(255, 255, 255, 0.96);
          backdrop-filter: blur(22px);
        }

        .header-background {
          position: absolute;
          inset: 0;
          pointer-events: none;
          background:
            radial-gradient(
              circle at 92% 4%,
              rgba(37, 99, 235, 0.14),
              transparent 42%
            ),
            radial-gradient(
              circle at 5% 100%,
              rgba(96, 165, 250, 0.11),
              transparent 37%
            ),
            linear-gradient(
              135deg,
              #ffffff,
              #f5f9ff
            );
        }

        .header-content {
          position: relative;
          z-index: 1;
          min-height: 220px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 36px;
          padding: 36px 40px;
        }

        .header-copy {
          min-width: 0;
        }

        .header-brand {
          display: flex;
          align-items: center;
          gap: 18px;
        }

        .header-logo {
          position: relative;
          width: 58px;
          height: 58px;
          flex-shrink: 0;
          padding: 9px;
          border: 1px solid rgba(37, 99, 235, 0.14);
          border-radius: 18px;
          background: white;
          box-shadow: 0 14px 34px rgba(37, 99, 235, 0.12);
        }

        .header-logo :global(.header-logo-image) {
          object-fit: contain;
          width: 100%;
          height: 100%;
        }

        .header-company {
          display: inline-flex;
          align-items: center;
          gap: 7px;
          color: #2563eb;
          font-size: 10px;
          font-weight: 950;
          letter-spacing: 0.18em;
        }

        .header-company::before {
          content: "";
          width: 7px;
          height: 7px;
          border-radius: 999px;
          background: #2563eb;
          box-shadow: 0 0 11px rgba(37, 99, 235, 0.55);
        }

        .header-brand h1 {
          margin: 9px 0 0;
          color: #071226;
          font-size: clamp(36px, 4vw, 56px);
          font-weight: 950;
          line-height: 1;
          letter-spacing: -0.055em;
        }

        .header-copy > p {
          max-width: 660px;
          margin: 19px 0 0;
          color: #64748b;
          font-size: 15px;
          line-height: 1.7;
        }

        .header-plan {
          width: fit-content;
          display: inline-flex;
          align-items: center;
          gap: 7px;
          margin-top: 21px;
          padding: 8px 12px;
          border: 1px solid #dbeafe;
          border-radius: 999px;
          background: #eff6ff;
          color: #2563eb;
          font-size: 10px;
          font-weight: 850;
        }

        .header-plan-dot {
          width: 6px;
          height: 6px;
          border-radius: 999px;
          background: #22c55e;
          box-shadow: 0 0 9px rgba(34, 197, 94, 0.55);
        }

        .header-actions {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          flex-wrap: wrap;
          gap: 11px;
        }

        .header-primary-action,
        .header-secondary-action {
          min-height: 48px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 9px;
          padding: 0 20px;
          border-radius: 999px;
          font-size: 12px;
          font-weight: 850;
          text-decoration: none;
          transition:
            transform 180ms ease,
            border-color 180ms ease,
            background 180ms ease,
            box-shadow 180ms ease;
        }

        .header-primary-action {
          border: 1px solid #2563eb;
          background: #2563eb;
          color: white;
          box-shadow: 0 14px 32px rgba(37, 99, 235, 0.23);
        }

        .header-primary-action:hover {
          transform: translateY(-2px);
          background: #1d4ed8;
          box-shadow: 0 18px 38px rgba(37, 99, 235, 0.28);
        }

        .header-secondary-action {
          border: 1px solid #dbe3ef;
          background: white;
          color: #071226;
          box-shadow: 0 10px 27px rgba(15, 23, 42, 0.05);
        }

        .header-secondary-action:hover {
          transform: translateY(-2px);
          border-color: #93c5fd;
          color: #2563eb;
        }

        @media (max-width: 860px) {
          .header-content {
            align-items: flex-start;
            flex-direction: column;
            padding: 28px;
          }

          .header-actions {
            justify-content: flex-start;
          }
        }

        @media (max-width: 560px) {
          .header-brand {
            align-items: flex-start;
          }

          .header-logo {
            width: 50px;
            height: 50px;
          }

          .header-actions {
            width: 100%;
            display: grid;
            grid-template-columns: 1fr;
          }

          .header-primary-action,
          .header-secondary-action {
            width: 100%;
          }
        }
      `}</style>
    </header>
  );
}

function obtenerPrimerNombre(nombre: string) {
  const limpio = nombre.trim();

  if (!limpio) return "Usuario";

  return limpio.split(/\s+/)[0];
}

function capitalizar(value: string) {
  const limpio = value.trim();

  if (!limpio) return "Free";

  return (
    limpio.charAt(0).toUpperCase() +
    limpio.slice(1).toLowerCase()
  );
}