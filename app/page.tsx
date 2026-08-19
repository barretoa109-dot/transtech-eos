"use client";

import { useState } from "react";
import Link from "next/link";
import AmbientBackground from "@/components/effects/AmbientBackground";
import AnimatedTitle from "@/components/effects/AnimatedTitle";
import Reveal from "@/components/effects/Reveal";
import { homeTechCanvas } from "@/components/effects/techCanvasPresets";
import { useNavScrolled } from "@/components/effects/useNavScrolled";
import { supabase } from "../lib/supabase";

const transtechIntelligence = [
  {
    title: "Decisiones basadas en contexto",
    text: "Información interpretada antes de ejecutar.",
    icon: (
      <svg viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="9" />
        <circle cx="12" cy="12" r="5" />
        <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
      </svg>
    ),
  },
  {
    title: "Automatización inteligente",
    text: "Menos tareas repetitivas y mayor productividad.",
    icon: (
      <svg viewBox="0 0 24 24">
        <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
      </svg>
    ),
  },
  {
    title: "Documentos en segundos",
    text: "Archivos profesionales listos para utilizar.",
    icon: (
      <svg viewBox="0 0 24 24">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="16" y1="13" x2="8" y2="13" />
        <line x1="16" y1="17" x2="8" y2="17" />
      </svg>
    ),
  },
  {
    title: "Información centralizada",
    text: "Datos organizados, medibles y disponibles.",
    icon: (
      <svg viewBox="0 0 24 24">
        <polygon points="12 2 2 7 12 12 22 7 12 2" />
        <polyline points="2 17 12 22 22 17" />
        <polyline points="2 12 12 17 22 12" />
      </svg>
    ),
  },
];

const queHacemos = [
  {
    title: "Inteligencia artificial",
    text: "Diseñamos soluciones inteligentes que analizan información, acompañan decisiones y convierten datos en acciones concretas.",
    icon: (
      <svg viewBox="0 0 24 24">
        <rect x="4" y="4" width="16" height="16" rx="3" />
        <rect x="9" y="9" width="6" height="6" />
        <line x1="9" y1="1" x2="9" y2="4" />
        <line x1="15" y1="1" x2="15" y2="4" />
        <line x1="9" y1="20" x2="9" y2="23" />
        <line x1="15" y1="20" x2="15" y2="23" />
        <line x1="20" y1="9" x2="23" y2="9" />
        <line x1="20" y1="14" x2="23" y2="14" />
        <line x1="1" y1="9" x2="4" y2="9" />
        <line x1="1" y1="14" x2="4" y2="14" />
      </svg>
    ),
  },
  {
    title: "Automatización",
    text: "Conectamos procesos, sistemas y canales para reducir tareas manuales, errores operativos y tiempos de respuesta.",
    icon: (
      <svg viewBox="0 0 24 24">
        <polyline points="17 1 21 5 17 9" />
        <path d="M3 11V9a4 4 0 0 1 4-4h14" />
        <polyline points="7 23 3 19 7 15" />
        <path d="M21 13v2a4 4 0 0 1-4 4H3" />
      </svg>
    ),
  },
  {
    title: "Gestión empresarial",
    text: "Creamos herramientas para organizar objetivos, tareas, finanzas, clientes, documentos y seguimiento.",
    icon: (
      <svg viewBox="0 0 24 24">
        <rect x="2" y="7" width="20" height="14" rx="2" />
        <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
      </svg>
    ),
  },
  {
    title: "Transformación digital",
    text: "Ayudamos a empresas y profesionales a modernizar su operación con tecnología práctica, escalable y medible.",
    icon: (
      <svg viewBox="0 0 24 24">
        <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
        <polyline points="17 6 23 6 23 12" />
      </svg>
    ),
  },
];

const eosFeatures = [
  {
    text: "Conversación ejecutiva y contextual",
    icon: (
      <svg viewBox="0 0 24 24">
        <path d="M21 11.5a8.38 8.38 0 0 1-9 8.38 8.5 8.5 0 0 1-7.6-4.7L3 21l1.9-5.7A8.5 8.5 0 1 1 21 11.5z" />
      </svg>
    ),
  },
  {
    text: "Generación de documentos y archivos",
    icon: (
      <svg viewBox="0 0 24 24">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
      </svg>
    ),
  },
  {
    text: "Memoria y continuidad entre conversaciones",
    icon: (
      <svg viewBox="0 0 24 24">
        <polygon points="12 2 2 7 12 12 22 7 12 2" />
        <polyline points="2 17 12 22 22 17" />
      </svg>
    ),
  },
  {
    text: "Objetivos, tareas y seguimiento",
    icon: (
      <svg viewBox="0 0 24 24">
        <polyline points="9 11 12 14 22 4" />
        <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
      </svg>
    ),
  },
  {
    text: "Dashboard y métricas de progreso",
    icon: (
      <svg viewBox="0 0 24 24">
        <line x1="18" y1="20" x2="18" y2="10" />
        <line x1="12" y1="20" x2="12" y2="4" />
        <line x1="6" y1="20" x2="6" y2="14" />
      </svg>
    ),
  },
  {
    text: "Automatización de procesos empresariales",
    icon: (
      <svg viewBox="0 0 24 24">
        <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
      </svg>
    ),
  },
];

const metodologia = [
  {
    title: "Diagnóstico",
    text: "Identificamos el problema real, las prioridades y las oportunidades.",
    icon: (
      <svg viewBox="0 0 24 24" style={{ width: 19, height: 19 }}>
        <circle cx="11" cy="11" r="8" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>
    ),
  },
  {
    title: "Estrategia",
    text: "Diseñamos una solución clara, viable y alineada con los objetivos.",
    icon: (
      <svg viewBox="0 0 24 24" style={{ width: 19, height: 19 }}>
        <circle cx="12" cy="12" r="9" />
        <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" />
      </svg>
    ),
  },
  {
    title: "Implementación",
    text: "Construimos, conectamos y ponemos en funcionamiento la tecnología.",
    icon: (
      <svg viewBox="0 0 24 24" style={{ width: 19, height: 19 }}>
        <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94z" />
      </svg>
    ),
  },
  {
    title: "Seguimiento",
    text: "Medimos resultados, detectamos mejoras y acompañamos la evolución.",
    icon: (
      <svg viewBox="0 0 24 24" style={{ width: 19, height: 19 }}>
        <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
        <polyline points="17 6 23 6 23 12" />
      </svg>
    ),
  },
];

const audiencias = ["Personas", "Emprendedores", "Profesionales", "Comercios", "Pymes", "Empresas"];

export default function Home() {
  const scrolled = useNavScrolled();

  const [nombre, setNombre] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [empresa, setEmpresa] = useState("");
  const [problema, setProblema] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [enviado, setEnviado] = useState(false);

  async function enviarLead() {
    if (!nombre.trim() || !whatsapp.trim() || !problema.trim()) {
      alert("Completá tu nombre, WhatsApp y principal necesidad.");
      return;
    }

    setEnviando(true);
    setEnviado(false);

    const { error } = await supabase.from("leads").insert([
      {
        nombre: nombre.trim(),
        whatsapp: whatsapp.trim(),
        empresa: empresa.trim(),
        problema: problema.trim(),
      },
    ]);

    setEnviando(false);

    if (error) {
      console.error(error);
      alert("No se pudo registrar la solicitud. Probá nuevamente.");
      return;
    }

    setNombre("");
    setWhatsapp("");
    setEmpresa("");
    setProblema("");
    setEnviado(true);
  }

  return (
    <main className="home-page" data-eos-theme="light">
      <AmbientBackground techConfig={homeTechCanvas} spanCount={3} />

      <nav className={scrolled ? "scrolled" : ""}>
        <div className="wrap nav-inner">
          <div className="nav-brand">
            <img src="/transtech-logo.png" alt="TransTech" />
            <span>TRANSTECH</span>
          </div>
          <div className="nav-links">
            <a href="#empresa">Empresa</a>
            <a href="#servicios">Servicios</a>
            <a href="#eos">EOS</a>
            <a href="#metodologia">Metodología</a>
            <a href="#contacto">Contacto</a>
          </div>
          <div className="nav-actions">
            <Link className="ghost" href="/login">
              Ingresar
            </Link>
            <Link className="btn btn-primary" href="/login">
              Probar EOS
            </Link>
          </div>
        </div>
      </nav>

      <header className="hero wrap">
        <div className="eyebrow">
          <span className="dot" /> Tecnología &amp; inteligencia · Asunción, Paraguay
        </div>
        <h1 className="hero-title">
          <AnimatedTitle
            text="Tecnología inteligente para transformar la forma de trabajar"
            accentWords={["transformar", "la", "forma", "de", "trabajar"]}
          />
        </h1>
        <p className="hero-sub">
          En TRANSTECH desarrollamos soluciones de inteligencia artificial, automatización y gestión para ayudar a
          personas y empresas a tomar mejores decisiones, optimizar procesos y crecer con mayor control.
        </p>
        <div className="hero-ctas">
          <a className="btn btn-outline btn-lg" href="#empresa">
            Conocer TRANSTECH
          </a>
          <Link className="btn btn-primary btn-lg" href="/login">
            Probar EOS →
          </Link>
        </div>
      </header>

      {/* TransTech Intelligence */}
      <section id="servicios">
        <div className="wrap">
          <Reveal className="section-head">
            <div className="section-eyebrow">TransTech Intelligence</div>
            <div className="section-title">Tecnología que entiende, ejecuta y mejora</div>
          </Reveal>
          <div className="grid-4">
            {transtechIntelligence.map((item, i) => (
              <Reveal key={item.title} delay={0.02 + i * 0.06} className="card">
                <div className="card-ic">{item.icon}</div>
                <div className="card-title">{item.title}</div>
                <div className="card-text">{item.text}</div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* About */}
      <section id="empresa">
        <div className="wrap">
          <Reveal className="section-head">
            <div className="section-eyebrow">Sobre nosotros</div>
            <div className="section-title">Construimos tecnología con propósito empresarial</div>
          </Reveal>
          <Reveal className="about-copy">
            <p>
              TRANSTECH es una empresa paraguaya enfocada en inteligencia artificial, automatización, gestión y
              transformación digital. Creamos soluciones que ayudan a ordenar información, reducir tareas manuales,
              generar documentos, controlar procesos y convertir objetivos en acciones medibles.
            </p>
          </Reveal>
          <div className="attr-row">
            {[
              { label: "Visión", value: "Tecnología útil, accesible y escalable" },
              { label: "Enfoque", value: "Resultados, control y ejecución" },
              { label: "Origen", value: "Empresa paraguaya" },
              { label: "Alcance", value: "Personas, pymes y empresas" },
            ].map((attr, i) => (
              <Reveal key={attr.label} delay={0.02 + i * 0.06} className="attr">
                <div className="attr-label">{attr.label}</div>
                <div className="attr-value">{attr.value}</div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* Qué hacemos */}
      <section>
        <div className="wrap">
          <Reveal className="section-head">
            <div className="section-eyebrow">Qué hacemos</div>
            <div className="section-title">Soluciones para trabajar mejor, decidir antes y crecer con control</div>
          </Reveal>
          <div className="grid-4">
            {queHacemos.map((item, i) => (
              <Reveal key={item.title} delay={0.02 + i * 0.06} className="card">
                <div className="card-ic">{item.icon}</div>
                <div className="card-title">{item.title}</div>
                <div className="card-text">{item.text}</div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* EOS spotlight */}
      <section id="eos">
        <Reveal className="eos-section">
          <div className="eos-grid">
            <div>
              <div className="eos-eyebrow">Producto insignia</div>
              <div className="eos-title">EOS</div>
              <div className="eos-desc">
                El sistema operativo ejecutivo de TRANSTECH. EOS combina conversación, inteligencia artificial,
                documentos, memoria, tareas, objetivos, seguimiento y dashboards dentro de una sola experiencia.
              </div>
              <div className="eos-highlight">
                No es solamente un chat: está diseñado para acompañar decisiones y ejecutar acciones concretas.
              </div>
              <div className="eos-features">
                {eosFeatures.map((f) => (
                  <div key={f.text} className="eos-feat">
                    <span className="fic">{f.icon}</span>
                    {f.text}
                  </div>
                ))}
              </div>
              <div className="eos-ctas">
                <Link className="btn btn-primary btn-lg" href="/login">
                  Abrir EOS →
                </Link>
                <Link className="btn btn-outline btn-lg" href="/login">
                  Iniciar sesión
                </Link>
              </div>
            </div>

            <div className="mock">
              <div className="mock-bar">
                <span />
                <span />
                <span />
              </div>
              <div className="mock-body">
                <div className="mock-line" style={{ width: "40%", height: 12, marginBottom: 18 }} />
                <div className="mock-bubble">
                  <div className="mock-line l1" />
                  <div className="mock-line l2" />
                </div>
                <div className="mock-input">
                  <span style={{ fontSize: 12.5, color: "var(--muted)" }}>Escribile a EOS</span>
                  <span className="mock-cursor" />
                  <div className="mock-send">
                    <svg viewBox="0 0 24 24">
                      <line x1="12" y1="19" x2="12" y2="5" />
                      <polyline points="5 12 12 5 19 12" />
                    </svg>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </Reveal>
      </section>

      {/* Methodology */}
      <section id="metodologia">
        <div className="wrap">
          <Reveal className="section-head">
            <div className="section-eyebrow">Metodología</div>
            <div className="section-title">De un problema real a una solución medible</div>
          </Reveal>
          <div className="steps">
            {metodologia.map((step, i) => (
              <Reveal key={step.title} delay={0.02 + i * 0.08} className="step">
                <div className="step-num">{step.icon}</div>
                <div className="step-title">{step.title}</div>
                <div className="step-text">{step.text}</div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* Audiences */}
      <section>
        <div className="wrap">
          <Reveal className="section-head">
            <div className="section-eyebrow">Para quién</div>
            <div className="section-title">Tecnología adaptable a distintas etapas y necesidades</div>
          </Reveal>
          <Reveal className="chip-cloud">
            {audiencias.map((a) => (
              <div key={a} className="audience-chip">
                {a}
              </div>
            ))}
          </Reveal>
        </div>
      </section>

      {/* Contact */}
      <section id="contacto">
        <div className="wrap">
          <Reveal className="contact-card">
            <div className="section-title">Contanos qué querés mejorar</div>
            <p>
              Analizaremos tu situación y te indicaremos qué solución de TRANSTECH o EOS puede generar mayor
              impacto.
            </p>

            <div className="contact-form">
              <input
                placeholder="Nombre y apellido"
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
                autoComplete="name"
              />
              <input
                placeholder="WhatsApp"
                type="tel"
                value={whatsapp}
                onChange={(e) => setWhatsapp(e.target.value)}
                autoComplete="tel"
              />
              <input
                placeholder="Empresa, negocio o profesión"
                value={empresa}
                onChange={(e) => setEmpresa(e.target.value)}
              />
              <textarea
                placeholder="¿Cuál es tu principal problema o qué querés mejorar?"
                value={problema}
                onChange={(e) => setProblema(e.target.value)}
              />
            </div>

            <button type="button" className="btn btn-primary btn-lg" onClick={enviarLead} disabled={enviando}>
              {enviando ? "Enviando solicitud..." : "Solicitar diagnóstico"}
            </button>

            {enviado && <div className="contact-success">Solicitud registrada correctamente. TRANSTECH se pondrá en contacto contigo.</div>}
          </Reveal>
        </div>
      </section>

      <footer>
        <div className="wrap">
          <div className="footer-top">
            <div>
              <div className="footer-brand-row">
                <img src="/transtech-logo.png" alt="TransTech" />
                <div className="footer-brand">TRANSTECH</div>
              </div>
              <div className="footer-tag">TECNOLOGÍA E INTELIGENCIA</div>
            </div>
            <div className="footer-cols">
              <div className="footer-col">
                <h4>Empresa</h4>
                <a href="#empresa">Sobre nosotros</a>
                <a href="#servicios">Servicios</a>
                <a href="#metodologia">Metodología</a>
                <a href="#contacto">Contacto</a>
              </div>
              <div className="footer-col">
                <h4>EOS</h4>
                <Link href="/eos">Conocer EOS</Link>
                <Link href="/planes">Planes</Link>
                <Link href="/login">Abrir EOS</Link>
                <Link href="/login">Iniciar sesión</Link>
              </div>
            </div>
          </div>
          <div className="footer-bottom">
            <span>© 2026 TRANSTECH. Todos los derechos reservados.</span>
            <span>Asunción, Paraguay</span>
          </div>
        </div>
      </footer>

      <style jsx>{`
        .home-page {
          --bg: #ffffff;
          --bg-2: #f1f5fb;
          --surface: #f6f8fc;
          --surface-hover: #eef3fb;
          --border: #e5e9f0;
          --border-hover: rgba(22, 86, 189, 0.5);
          --text: #07132a;
          --muted: #6b7280;
          --blue: #1656bd;
          --blue-dark: #113f8c;
          --blue-bright: #2f72d6;
          --blue-soft: #1656bd;
          --blue-light: #e9f0fb;
          --green: #10a37f;
          --ease: cubic-bezier(0.22, 1, 0.36, 1);
          position: relative;
          font-family: var(--font-inter), Inter, Arial, Helvetica, sans-serif;
          background: var(--bg);
          color: var(--text);
          overflow-x: hidden;
        }
        .home-page :global(svg) {
          width: 18px;
          height: 18px;
          stroke: currentColor;
          stroke-width: 1.8;
          fill: none;
          stroke-linecap: round;
          stroke-linejoin: round;
          display: block;
        }
        .home-page a {
          color: inherit;
          text-decoration: none;
        }
        .home-page button {
          font-family: inherit;
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
          transition: background 0.25s, border-color 0.25s, backdrop-filter 0.25s, padding 0.25s;
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
        .nav-brand span {
          font-size: 18px;
          font-weight: 800;
          letter-spacing: -0.3px;
          background: linear-gradient(90deg, #113f8c, #1656bd 55%, #2f72d6);
          -webkit-background-clip: text;
          background-clip: text;
          color: transparent;
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
          background: var(--blue-soft);
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
        .nav-actions :global(.ghost) {
          font-size: 13px;
          font-weight: 600;
          color: var(--muted);
          transition: color 0.15s;
        }
        .nav-actions :global(.ghost:hover) {
          color: var(--text);
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
          box-shadow: 0 6px 20px rgba(22, 86, 189, 0.35);
          position: relative;
          overflow: hidden;
        }
        :global(.btn-primary:hover) {
          transform: translateY(-2px);
          box-shadow: 0 10px 28px rgba(22, 86, 189, 0.48);
        }
        :global(.btn-primary:active) {
          transform: translateY(0) scale(0.97);
        }
        :global(.btn-primary:disabled) {
          opacity: 0.65;
          cursor: not-allowed;
          transform: none;
        }
        :global(.btn-outline) {
          background: transparent;
          color: var(--text);
          border: 1px solid var(--border);
        }
        :global(.btn-outline:hover) {
          border-color: var(--border-hover);
          background: var(--surface);
          transform: translateY(-2px);
        }
        :global(.btn-lg) {
          padding: 14px 26px;
          font-size: 14.5px;
          border-radius: 12px;
        }

        .hero {
          padding: 100px 0 90px;
          text-align: center;
          position: relative;
        }
        .eyebrow {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          font-size: 12px;
          font-weight: 700;
          color: var(--blue-soft);
          background: var(--blue-light);
          border: 1px solid rgba(22, 86, 189, 0.3);
          padding: 7px 16px;
          border-radius: 999px;
          margin-bottom: 26px;
        }
        .eyebrow .dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: var(--green);
          display: inline-block;
        }
        .hero-title {
          font-size: 56px;
          font-weight: 800;
          letter-spacing: -1.8px;
          line-height: 1.08;
          max-width: 840px;
          margin: 0 auto 24px;
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
          background: linear-gradient(90deg, #113f8c, #1656bd 50%, #2f72d6);
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
          font-size: 16.5px;
          line-height: 1.7;
          color: var(--muted);
          max-width: 620px;
          margin: 0 auto 38px;
        }
        .hero-ctas {
          display: flex;
          gap: 14px;
          justify-content: center;
          margin-bottom: 70px;
        }

        section {
          padding: 90px 0;
          position: relative;
        }
        .home-page :global(.section-head) {
          max-width: 640px;
          margin: 0 auto 48px;
          text-align: center;
        }
        .section-eyebrow {
          font-size: 12px;
          font-weight: 700;
          color: var(--blue-soft);
          letter-spacing: 1.5px;
          text-transform: uppercase;
          margin-bottom: 12px;
        }
        .section-title {
          font-size: 34px;
          font-weight: 800;
          letter-spacing: -0.8px;
          line-height: 1.2;
        }

        .grid-4 {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 16px;
        }

        .home-page :global(.card) {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 18px;
          padding: 26px 24px;
          transition: border-color 0.2s, background 0.2s, transform 0.2s, box-shadow 0.2s;
          backdrop-filter: blur(6px);
        }
        .home-page :global(.card:hover) {
          border-color: var(--border-hover);
          background: var(--surface-hover);
          transform: translateY(-4px);
          box-shadow: 0 16px 36px rgba(22, 86, 189, 0.14);
        }
        .card-ic {
          width: 42px;
          height: 42px;
          border-radius: 12px;
          background: var(--blue-light);
          color: var(--blue-soft);
          display: flex;
          align-items: center;
          justify-content: center;
          margin-bottom: 18px;
        }
        .card-title {
          font-size: 15.5px;
          font-weight: 700;
          margin-bottom: 8px;
        }
        .card-text {
          font-size: 13.5px;
          color: var(--muted);
          line-height: 1.6;
        }

        .attr-row {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 16px;
          margin-top: 44px;
        }
        .home-page :global(.attr) {
          text-align: center;
          padding: 22px 14px;
          border-top: 1px solid var(--border);
        }
        .attr-label {
          font-size: 11px;
          font-weight: 700;
          color: var(--blue-soft);
          text-transform: uppercase;
          letter-spacing: 1.2px;
          margin-bottom: 8px;
        }
        .attr-value {
          font-size: 14.5px;
          font-weight: 600;
          line-height: 1.4;
        }
        .home-page :global(.about-copy) p {
          max-width: 720px;
          margin: 0 auto;
          text-align: center;
          font-size: 15.5px;
          line-height: 1.75;
          color: var(--muted);
        }

        .home-page :global(.eos-section) {
          border-radius: 32px;
          margin: 0 32px;
          padding: 80px 56px;
          background: linear-gradient(160deg, rgba(22, 86, 189, 0.14), rgba(2, 8, 23, 0) 60%), var(--bg-2);
          border: 1px solid var(--border);
          position: relative;
          overflow: hidden;
        }
        .eos-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 56px;
          align-items: center;
        }
        .eos-eyebrow {
          font-size: 12px;
          font-weight: 700;
          color: var(--blue-soft);
          letter-spacing: 1.5px;
          text-transform: uppercase;
          margin-bottom: 14px;
        }
        .eos-title {
          font-size: 38px;
          font-weight: 800;
          letter-spacing: -1px;
          margin-bottom: 18px;
        }
        .eos-desc {
          font-size: 15px;
          color: var(--muted);
          line-height: 1.7;
          margin-bottom: 10px;
        }
        .eos-highlight {
          font-size: 15.5px;
          font-weight: 700;
          color: var(--text);
          margin: 18px 0 26px;
        }
        .eos-features {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 10px 18px;
          margin-bottom: 32px;
        }
        .eos-feat {
          display: flex;
          align-items: center;
          gap: 10px;
          font-size: 13.5px;
          color: var(--text);
        }
        .eos-feat .fic {
          width: 26px;
          height: 26px;
          border-radius: 8px;
          background: var(--blue-light);
          color: var(--blue-soft);
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }
        .eos-feat .fic :global(svg) {
          width: 13px;
          height: 13px;
        }
        .eos-ctas {
          display: flex;
          gap: 14px;
        }

        .mock {
          border-radius: 18px;
          border: 1px solid var(--border);
          background: #ffffff;
          box-shadow: 0 30px 70px rgba(15, 23, 42, 0.14), 0 0 0 1px rgba(22, 86, 189, 0.1);
          overflow: hidden;
          backdrop-filter: blur(10px);
          transform: perspective(1200px) rotateY(-6deg) rotateX(2deg);
          transition: transform 0.4s var(--ease);
        }
        .eos-grid:hover .mock {
          transform: perspective(1200px) rotateY(-2deg) rotateX(1deg);
        }
        .mock-bar {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 12px 14px;
          border-bottom: 1px solid var(--border);
        }
        .mock-bar span {
          width: 9px;
          height: 9px;
          border-radius: 50%;
          background: rgba(15, 23, 42, 0.14);
        }
        .mock-body {
          padding: 22px;
        }
        .mock-line {
          height: 9px;
          border-radius: 5px;
          background: rgba(15, 23, 42, 0.08);
          margin-bottom: 10px;
        }
        .mock-bubble {
          max-width: 76%;
          background: var(--blue-light);
          border: 1px solid rgba(22, 86, 189, 0.25);
          border-radius: 12px 12px 12px 3px;
          padding: 12px 14px;
          margin-bottom: 16px;
        }
        .mock-bubble .l1 {
          width: 90%;
        }
        .mock-bubble .l2 {
          width: 60%;
          margin-bottom: 0;
        }
        .mock-input {
          display: flex;
          align-items: center;
          gap: 10px;
          border: 1px solid var(--border);
          border-radius: 999px;
          padding: 10px 16px;
          margin-top: 6px;
          background: #fafbfd;
        }
        .mock-cursor {
          width: 2px;
          height: 14px;
          background: var(--blue-soft);
          animation: blink 1s step-end infinite;
        }
        @keyframes blink {
          50% {
            opacity: 0;
          }
        }
        .mock-send {
          width: 26px;
          height: 26px;
          border-radius: 50%;
          background: var(--blue);
          display: flex;
          align-items: center;
          justify-content: center;
          margin-left: auto;
          flex-shrink: 0;
        }
        .mock-send :global(svg) {
          width: 12px;
          height: 12px;
          stroke: #fff;
        }

        .steps {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 0;
          position: relative;
          margin-top: 20px;
        }
        .steps::before {
          content: "";
          position: absolute;
          top: 23px;
          left: 12.5%;
          right: 12.5%;
          height: 1px;
          background: linear-gradient(90deg, transparent, var(--border) 10%, var(--border) 90%, transparent);
        }
        .home-page :global(.step) {
          text-align: center;
          padding: 0 14px;
          position: relative;
        }
        .step-num {
          width: 46px;
          height: 46px;
          border-radius: 50%;
          margin: 0 auto 20px;
          position: relative;
          z-index: 1;
          background: var(--bg-2);
          border: 1.5px solid var(--border);
          display: flex;
          align-items: center;
          justify-content: center;
          color: var(--blue-soft);
          transition: border-color 0.2s, box-shadow 0.2s;
        }
        .home-page :global(.step:hover) .step-num {
          border-color: var(--blue);
          box-shadow: 0 0 0 5px rgba(22, 86, 189, 0.12);
        }
        .step-title {
          font-size: 14.5px;
          font-weight: 700;
          margin-bottom: 8px;
        }
        .step-text {
          font-size: 12.8px;
          color: var(--muted);
          line-height: 1.6;
        }

        .home-page :global(.chip-cloud) {
          display: flex;
          flex-wrap: wrap;
          gap: 12px;
          justify-content: center;
          margin-top: 36px;
        }
        .audience-chip {
          padding: 12px 24px;
          border-radius: 999px;
          border: 1px solid var(--border);
          font-size: 14px;
          font-weight: 600;
          background: var(--surface);
          transition: all 0.2s ease;
          cursor: default;
        }
        .audience-chip:hover {
          border-color: var(--border-hover);
          background: var(--blue-light);
          color: var(--blue-soft);
          transform: translateY(-2px);
        }

        .home-page :global(.contact-card) {
          max-width: 680px;
          margin: 0 auto;
          text-align: center;
          padding: 56px 48px;
          border-radius: 24px;
          border: 1px solid var(--border);
          background: radial-gradient(ellipse at 50% 0%, rgba(22, 86, 189, 0.16), transparent 60%), var(--surface);
        }
        .home-page :global(.contact-card .section-title) {
          margin-bottom: 14px;
        }
        .home-page :global(.contact-card p) {
          font-size: 15px;
          color: var(--muted);
          line-height: 1.7;
          margin-bottom: 30px;
        }
        .contact-form {
          display: grid;
          gap: 12px;
          text-align: left;
          margin-bottom: 26px;
        }
        .contact-form input,
        .contact-form textarea {
          width: 100%;
          box-sizing: border-box;
          border: 1px solid var(--border);
          border-radius: 12px;
          background: #ffffff;
          color: var(--text);
          font-family: inherit;
          font-size: 14px;
          padding: 12px 16px;
          outline: none;
          transition: border-color 0.15s, box-shadow 0.15s;
        }
        .contact-form textarea {
          min-height: 100px;
          resize: vertical;
          line-height: 1.6;
        }
        .contact-form input:focus,
        .contact-form textarea:focus {
          border-color: var(--blue);
          box-shadow: 0 0 0 4px rgba(22, 86, 189, 0.12);
        }
        .contact-success {
          margin-top: 18px;
          padding: 14px 18px;
          border-radius: 12px;
          background: #e6f7f1;
          color: #0d7d5f;
          font-size: 13.5px;
          font-weight: 600;
        }

        footer {
          border-top: 1px solid var(--border);
          padding: 50px 0 34px;
        }
        .footer-top {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          margin-bottom: 34px;
          flex-wrap: wrap;
          gap: 24px;
        }
        .footer-brand-row {
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .footer-brand-row img {
          height: 20px;
          width: auto;
          display: block;
        }
        .footer-brand {
          font-size: 16px;
          font-weight: 800;
        }
        .footer-tag {
          font-size: 12px;
          color: var(--muted);
          margin-top: 4px;
          letter-spacing: 0.4px;
        }
        .footer-cols {
          display: flex;
          gap: 56px;
        }
        .footer-col h4 {
          font-size: 11px;
          font-weight: 700;
          color: var(--muted);
          text-transform: uppercase;
          letter-spacing: 1px;
          margin-bottom: 14px;
        }
        .footer-col :global(a) {
          display: block;
          font-size: 13.5px;
          color: var(--text);
          opacity: 0.75;
          margin-bottom: 10px;
          transition: opacity 0.15s, color 0.15s;
        }
        .footer-col :global(a:hover) {
          opacity: 1;
          color: var(--blue-soft);
        }
        .footer-bottom {
          display: flex;
          justify-content: space-between;
          padding-top: 26px;
          border-top: 1px solid var(--border);
          font-size: 12.5px;
          color: var(--muted);
          flex-wrap: wrap;
          gap: 10px;
        }

        @media (max-width: 900px) {
          .grid-4,
          .eos-features {
            grid-template-columns: repeat(2, 1fr);
          }
          .eos-grid,
          .attr-row {
            grid-template-columns: 1fr;
          }
          .nav-links {
            display: none;
          }
          .nav-brand span {
            display: none;
          }
          .nav-actions :global(.ghost) {
            display: none;
          }
          .hero-title {
            font-size: 38px;
          }
          .steps {
            grid-template-columns: 1fr;
            gap: 28px;
          }
          .steps::before {
            display: none;
          }
        }
      `}</style>
    </main>
  );
}
