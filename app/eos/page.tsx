"use client";

import Link from "next/link";
import AmbientBackground from "@/components/effects/AmbientBackground";
import AnimatedTitle from "@/components/effects/AnimatedTitle";
import { eosTechCanvas } from "@/components/effects/techCanvasPresets";
import { useNavScrolled } from "@/components/effects/useNavScrolled";

export default function EOSLandingPage() {
  const scrolled = useNavScrolled();

  return (
    <main className="eos-landing" data-eos-theme="light">
      <AmbientBackground techConfig={eosTechCanvas} spanCount={3} />

      <nav className={scrolled ? "scrolled" : ""}>
        <div className="wrap nav-inner">
          <div className="nav-brand">
            <img src="/transtech-logo.png" alt="TransTech" />
            <div className="nav-brand-txt">
              <span className="name">TRANSTECH</span>
              <span className="sub">
                <span className="dot" />
                EOS
              </span>
            </div>
          </div>

          <div className="nav-links">
            <a href="#que-es">Qué es</a>
            <a href="#como-funciona">Cómo funciona</a>
            <a href="#capacidades">Capacidades</a>
            <a href="#diferencias">Diferencias</a>
            <Link href="/planes">Planes</Link>
          </div>

          <div className="nav-actions">
            <Link className="btn btn-outline" href="/">
              TRANSTECH
            </Link>
            <Link className="btn btn-primary" href="/login">
              Probar EOS →
            </Link>
          </div>
        </div>
      </nav>

      <header className="hero wrap">
        <div className="hero-grid">
          <div>
            <div className="eyebrow">
              <span>✨</span> PRODUCTO ESTRELLA DE TRANSTECH
            </div>
            <h1 className="hero-title">
              <AnimatedTitle text="Un sistema que entiende, decide y ejecuta." accentWords={["ejecuta."]} step={0.05} />
            </h1>
            <p className="hero-sub">
              EOS es el sistema operativo ejecutivo de TRANSTECH. Conversa con contexto, genera archivos, organiza
              objetivos, conserva información y conecta cada interacción con acciones reales.
            </p>
            <div className="hero-ctas">
              <Link className="btn btn-primary btn-lg" href="/login">
                Probar EOS →
              </Link>
              <a className="btn btn-outline btn-lg" href="#como-funciona">
                Ver cómo funciona ›
              </a>
            </div>
            <div className="hero-stats">
              <div>
                <div className="stat-num">24/7</div>
                <div className="stat-label">Disponibilidad</div>
              </div>
              <div>
                <div className="stat-num">1</div>
                <div className="stat-label">Entorno centralizado</div>
              </div>
              <div>
                <div className="stat-num">100%</div>
                <div className="stat-label">Enfoque ejecutivo</div>
              </div>
            </div>
          </div>

          <div className="mock-stage">
            <div className="mock">
              <div className="mock-head">
                <div className="mock-head-left">
                  <div className="mock-ic">
                    <svg viewBox="0 0 24 24">
                      <circle cx="12" cy="12" r="3" />
                      <path d="M12 1v4M12 19v4M4.2 4.2l2.8 2.8M17 17l2.8 2.8M1 12h4M19 12h4M4.2 19.8L7 17M17 7l2.8-2.8" />
                    </svg>
                  </div>
                  <div>
                    <div className="mock-eyebrow">Transtech EOS</div>
                    <div className="mock-title">Executive Operating System</div>
                  </div>
                </div>
                <div className="mock-status">
                  <span className="dot" />
                  ACTIVO
                </div>
              </div>

              <div className="mock-body">
                <div className="bubble-user">
                  Generame un Excel para controlar los ingresos y gastos de mi negocio.
                </div>
                <div className="bubble-ai">
                  Perfecto. Voy a preparar una planilla financiera con ingresos, gastos, resultado y estructura de
                  control.
                </div>
                <div className="mock-file">
                  <div className="mock-file-label">
                    <svg viewBox="0 0 24 24" style={{ width: 11, height: 11 }}>
                      <polyline points="9 11 12 14 22 4" />
                      <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
                    </svg>
                    Archivo generado
                  </div>
                  <div className="mock-file-row">
                    <div className="mock-file-ic">
                      <svg viewBox="0 0 24 24" style={{ width: 18, height: 18 }}>
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                        <polyline points="14 2 14 8 20 8" />
                      </svg>
                    </div>
                    <div>
                      <div className="mock-file-name">control_financiero.xlsx</div>
                      <div className="mock-file-sub">Listo para descargar</div>
                    </div>
                    <div className="mock-dl">Descargar</div>
                  </div>
                </div>
                <div className="mock-chips">
                  <div className="mock-chip">
                    <div className="mock-chip-label">
                      <svg viewBox="0 0 24 24">
                        <ellipse cx="12" cy="5" rx="9" ry="3" />
                        <path d="M3 5v14a9 3 0 0 0 18 0V5" />
                        <path d="M3 12a9 3 0 0 0 18 0" />
                      </svg>
                      Memoria
                    </div>
                    <div className="mock-chip-val">Activa</div>
                  </div>
                  <div className="mock-chip">
                    <div className="mock-chip-label">
                      <svg viewBox="0 0 24 24">
                        <circle cx="12" cy="12" r="9" />
                        <circle cx="12" cy="12" r="4" />
                      </svg>
                      Objetivo
                    </div>
                    <div className="mock-chip-val">Detectado</div>
                  </div>
                  <div className="mock-chip">
                    <div className="mock-chip-label">
                      <svg viewBox="0 0 24 24">
                        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                      </svg>
                      Sistema
                    </div>
                    <div className="mock-chip-val">Seguro</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </header>

      <footer className="wrap">© 2026 TRANSTECH · EOS — Executive Operating System</footer>

      <style jsx>{`
        .eos-landing {
          --blue: #1656bd;
          --blue-dark: #113f8c;
          --blue-bright: #2f72d6;
          --blue-light: #e9f0fb;
          --text: #07132a;
          --muted: #6b7280;
          --border: #e5e9f0;
          --border-hover: rgba(22, 86, 189, 0.5);
          --ease: cubic-bezier(0.22, 1, 0.36, 1);
          position: relative;
          font-family: var(--font-inter), Inter, Arial, Helvetica, sans-serif;
          background: #ffffff;
          color: var(--text);
          overflow-x: hidden;
          min-height: 100vh;
        }
        .eos-landing :global(svg) {
          width: 18px;
          height: 18px;
          stroke: currentColor;
          stroke-width: 1.8;
          fill: none;
          stroke-linecap: round;
          stroke-linejoin: round;
          display: block;
        }
        .eos-landing a {
          color: inherit;
          text-decoration: none;
        }

        .wrap {
          max-width: 1180px;
          margin: 0 auto;
          padding: 0 32px;
          position: relative;
          z-index: 1;
        }

        nav {
          position: sticky;
          top: 0;
          z-index: 50;
          padding: 18px 0;
          transition: background 0.25s, border-color 0.25s, padding 0.25s;
          border-bottom: 1px solid transparent;
        }
        nav.scrolled {
          background: rgba(255, 255, 255, 0.85);
          backdrop-filter: blur(14px);
          border-color: var(--border);
          padding: 13px 0;
        }
        .nav-inner {
          display: flex;
          align-items: center;
          justify-content: space-between;
        }
        .nav-brand {
          display: flex;
          align-items: center;
          gap: 11px;
        }
        .nav-brand img {
          height: 24px;
          width: auto;
          display: block;
        }
        .nav-brand-txt {
          display: flex;
          flex-direction: column;
          line-height: 1.1;
        }
        .nav-brand-txt .name {
          font-size: 16px;
          font-weight: 800;
          letter-spacing: -0.2px;
        }
        .nav-brand-txt .sub {
          font-size: 11px;
          font-weight: 700;
          color: var(--blue);
          display: flex;
          align-items: center;
          gap: 5px;
        }
        .nav-brand-txt .sub .dot {
          width: 5px;
          height: 5px;
          border-radius: 50%;
          background: var(--blue);
        }
        .nav-links {
          display: flex;
          align-items: center;
          gap: 34px;
        }
        .nav-links a {
          font-size: 13.5px;
          font-weight: 500;
          color: var(--muted);
          transition: color 0.15s;
          position: relative;
        }
        .nav-links a::after {
          content: "";
          position: absolute;
          left: 0;
          bottom: -6px;
          width: 0;
          height: 1.5px;
          background: var(--blue);
          transition: width 0.2s var(--ease);
        }
        .nav-links a:hover {
          color: var(--text);
        }
        .nav-links a:hover::after {
          width: 100%;
        }
        .nav-actions {
          display: flex;
          align-items: center;
          gap: 14px;
        }
        :global(.btn) {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 10px 20px;
          border-radius: 10px;
          font-size: 13.5px;
          font-weight: 700;
          cursor: pointer;
          border: none;
          transition: transform 0.15s, box-shadow 0.2s, background 0.2s;
        }
        :global(.btn-primary) {
          background: linear-gradient(135deg, var(--blue-bright), var(--blue-dark));
          color: #fff;
          box-shadow: 0 6px 20px rgba(22, 86, 189, 0.3);
          position: relative;
          overflow: hidden;
        }
        :global(.btn-primary:hover) {
          transform: translateY(-2px);
          box-shadow: 0 10px 28px rgba(22, 86, 189, 0.42);
        }
        :global(.btn-primary:active) {
          transform: translateY(0) scale(0.97);
        }
        :global(.btn-outline) {
          background: #fff;
          color: var(--text);
          border: 1px solid var(--border);
        }
        :global(.btn-outline:hover) {
          border-color: var(--border-hover);
          background: #f6f8fc;
          transform: translateY(-2px);
        }
        :global(.btn-lg) {
          padding: 14px 26px;
          font-size: 14.5px;
          border-radius: 12px;
        }

        .hero {
          padding: 70px 0 100px;
          position: relative;
        }
        .hero-grid {
          display: grid;
          grid-template-columns: 1.05fr 0.95fr;
          gap: 56px;
          align-items: center;
        }
        .eyebrow {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          font-size: 12px;
          font-weight: 700;
          color: var(--blue);
          background: var(--blue-light);
          border: 1px solid rgba(22, 86, 189, 0.22);
          padding: 7px 16px;
          border-radius: 999px;
          margin-bottom: 26px;
          opacity: 0;
          animation: rise 0.6s var(--ease) 0.1s forwards;
        }
        @keyframes rise {
          from {
            opacity: 0;
            transform: translateY(14px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        .hero-title {
          font-size: 52px;
          font-weight: 800;
          letter-spacing: -1.6px;
          line-height: 1.12;
          margin-bottom: 22px;
          perspective: 1000px;
        }
        .hero-title :global(.word) {
          display: inline-block;
          opacity: 0;
          transform: translateY(30px) rotateX(-65deg);
          transform-origin: 50% 100%;
          animation: wordIn 0.75s var(--ease) forwards;
        }
        @keyframes wordIn {
          to {
            opacity: 1;
            transform: translateY(0) rotateX(0);
          }
        }
        .hero-title :global(.accent) {
          background: linear-gradient(90deg, #1656bd, #2f72d6 55%, #20b8c9);
          -webkit-background-clip: text;
          background-clip: text;
          color: transparent;
          background-size: 200% auto;
          animation-name: wordIn, sheen;
          animation-duration: 0.75s, 6s;
          animation-timing-function: var(--ease), linear;
          animation-iteration-count: 1, infinite;
          animation-delay: inherit, 1.6s;
          animation-fill-mode: forwards, none;
        }
        @keyframes sheen {
          to {
            background-position: 200% center;
          }
        }
        .hero-sub {
          font-size: 16px;
          line-height: 1.7;
          color: var(--muted);
          max-width: 520px;
          margin-bottom: 34px;
          opacity: 0;
          animation: rise 0.6s var(--ease) 0.9s forwards;
        }
        .hero-ctas {
          display: flex;
          gap: 14px;
          margin-bottom: 56px;
          opacity: 0;
          animation: rise 0.6s var(--ease) 1.05s forwards;
        }
        .hero-stats {
          display: flex;
          gap: 40px;
          opacity: 0;
          animation: rise 0.6s var(--ease) 1.2s forwards;
        }
        .stat-num {
          font-size: 26px;
          font-weight: 800;
          letter-spacing: -0.5px;
        }
        .stat-label {
          font-size: 12.5px;
          color: var(--muted);
          margin-top: 2px;
        }

        .mock-stage {
          opacity: 0;
          animation: rise 0.8s var(--ease) 1.3s forwards;
          perspective: 1400px;
        }
        .mock {
          border-radius: 20px;
          border: 1px solid rgba(255, 255, 255, 0.08);
          background: #0a1730;
          box-shadow: 0 30px 70px rgba(11, 23, 54, 0.28), 0 0 0 1px rgba(22, 86, 189, 0.1);
          overflow: hidden;
          transform: perspective(1400px) rotateY(-4deg) rotateX(1.5deg);
          transition: transform 0.4s var(--ease);
          color: #f1f5fb;
        }
        .mock:hover {
          transform: perspective(1400px) rotateY(-1deg) rotateX(0.5deg);
        }
        .mock-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 16px 20px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.08);
        }
        .mock-head-left {
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .mock-ic {
          width: 34px;
          height: 34px;
          border-radius: 9px;
          background: linear-gradient(135deg, #1656bd, #113f8c);
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }
        .mock-ic :global(svg) {
          width: 17px;
          height: 17px;
          stroke: #fff;
        }
        .mock-eyebrow {
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 0.6px;
          color: #6fa3e8;
          text-transform: uppercase;
        }
        .mock-title {
          font-size: 14px;
          font-weight: 700;
        }
        .mock-status {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          font-size: 11px;
          font-weight: 700;
          color: #4ade80;
          background: rgba(74, 222, 128, 0.12);
          padding: 5px 11px;
          border-radius: 999px;
        }
        .mock-status .dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: #4ade80;
          animation: twinkle 2.2s ease-in-out infinite;
        }
        @keyframes twinkle {
          0%,
          100% {
            opacity: 1;
          }
          50% {
            opacity: 0.4;
          }
        }
        .mock-body {
          padding: 20px;
        }
        .bubble-user {
          max-width: 82%;
          margin-left: auto;
          background: linear-gradient(135deg, #1656bd, #2f72d6);
          color: #fff;
          padding: 12px 15px;
          border-radius: 13px 13px 3px 13px;
          font-size: 13px;
          line-height: 1.55;
          margin-bottom: 14px;
          opacity: 0;
          animation: msgIn 0.5s var(--ease) 1.7s forwards;
        }
        .bubble-ai {
          max-width: 88%;
          background: rgba(255, 255, 255, 0.05);
          border: 1px solid rgba(255, 255, 255, 0.07);
          padding: 12px 15px;
          border-radius: 13px 13px 13px 3px;
          font-size: 13px;
          line-height: 1.6;
          color: #cbd5e1;
          margin-bottom: 16px;
          opacity: 0;
          animation: msgIn 0.5s var(--ease) 2.35s forwards;
        }
        @keyframes msgIn {
          from {
            opacity: 0;
            transform: translateY(8px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        .mock-file {
          border: 1px solid rgba(255, 255, 255, 0.08);
          background: rgba(255, 255, 255, 0.03);
          border-radius: 12px;
          padding: 14px 16px;
          margin-bottom: 16px;
          opacity: 0;
          animation: msgIn 0.5s var(--ease) 2.85s forwards;
        }
        .mock-file-label {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 0.5px;
          color: #6fa3e8;
          text-transform: uppercase;
          margin-bottom: 10px;
        }
        .mock-file-row {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .mock-file-ic {
          width: 36px;
          height: 36px;
          border-radius: 9px;
          background: rgba(16, 163, 127, 0.15);
          color: #34d399;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }
        .mock-file-name {
          font-size: 13px;
          font-weight: 700;
        }
        .mock-file-sub {
          font-size: 11px;
          color: #8b96a8;
          margin-top: 2px;
        }
        .mock-dl {
          margin-left: auto;
          background: linear-gradient(135deg, #1656bd, #2f72d6);
          color: #fff;
          font-size: 11.5px;
          font-weight: 700;
          padding: 8px 13px;
          border-radius: 8px;
          flex-shrink: 0;
        }
        .mock-chips {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 10px;
          opacity: 0;
          animation: msgIn 0.5s var(--ease) 3.2s forwards;
        }
        .mock-chip {
          border: 1px solid rgba(255, 255, 255, 0.07);
          background: rgba(255, 255, 255, 0.03);
          border-radius: 10px;
          padding: 10px 12px;
        }
        .mock-chip-label {
          display: flex;
          align-items: center;
          gap: 5px;
          font-size: 9.5px;
          font-weight: 700;
          letter-spacing: 0.4px;
          color: #8b96a8;
          text-transform: uppercase;
          margin-bottom: 4px;
        }
        .mock-chip-label :global(svg) {
          width: 11px;
          height: 11px;
        }
        .mock-chip-val {
          font-size: 12.5px;
          font-weight: 700;
        }

        footer {
          border-top: 1px solid var(--border);
          padding: 34px 0;
          text-align: center;
          font-size: 12.5px;
          color: var(--muted);
        }

        @media (max-width: 900px) {
          .hero-grid {
            grid-template-columns: 1fr;
          }
          .nav-links {
            display: none;
          }
          .hero-title {
            font-size: 36px;
          }
          .hero-stats {
            flex-wrap: wrap;
            gap: 24px;
          }
        }
      `}</style>
    </main>
  );
}
