"use client";

import {
  BarChart3,
  BrainCircuit,
  ChevronRight,
  FileText,
  Scale,
  MessageSquareText,
  Plus,
  Search,
  Sparkles,
  X,
} from "lucide-react";

import { Brand } from "@/app/components/ui";

type Conversacion = {
  id: string;
  titulo: string | null;
  created_at?: string;
};

type Vista = "chat" | "briefing" | "decisions" | "learnings" | "dashboard" | "perfil";

type SidebarProps = {
  nombre: string;
  plan: string;
  vista: Vista;
  busqueda: string;
  conversacionId: string;
  conversaciones: Conversacion[];
  onVistaChange: (vista: Vista) => void;
  onBusquedaChange: (value: string) => void;
  onNuevoChat: () => void;
  onAbrirConversacion: (id: string) => void;
};

type NavButtonProps = {
  icono: React.ReactNode;
  texto: string;
  descripcion: string;
  activo: boolean;
  onClick: () => void;
};

export default function Sidebar({
  nombre,
  plan,
  vista,
  busqueda,
  conversacionId,
  conversaciones,
  onVistaChange,
  onBusquedaChange,
  onNuevoChat,
  onAbrirConversacion,
}: SidebarProps) {
  const conversacionesFiltradas = conversaciones.filter((conversacion) =>
    (conversacion.titulo || "Nuevo chat")
      .toLowerCase()
      .includes(busqueda.toLowerCase()),
  );

  const iniciales =
    nombre
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((parte) => parte.charAt(0).toUpperCase())
      .join("") || "U";

  const planFormateado = capitalizar(plan || "free");

  return (
    <aside className="transtech-sidebar">
      <div className="sidebar-background" aria-hidden="true">
        <div className="sidebar-grid" />
        <div className="sidebar-glow sidebar-glow-one" />
        <div className="sidebar-glow sidebar-glow-two" />
      </div>

      <div className="sidebar-header">
        <Brand
  product="EOS"
  subtitle="Executive Operating System"
  compact
  logoSize={43}
/>

        <button
          type="button"
          className="new-chat-button"
          onClick={onNuevoChat}
        >
          <span className="new-chat-icon">
            <Plus size={20} strokeWidth={2.5} />
          </span>

          <span className="new-chat-copy">
            <strong>Nuevo chat</strong>
            <small>Iniciar conversación</small>
          </span>

          <ChevronRight
            size={18}
            className="new-chat-chevron"
          />
        </button>

        <div className="search-wrapper">
          <Search
            size={16}
            className="search-icon"
          />

          <input
            value={busqueda}
            onChange={(event) =>
              onBusquedaChange(event.target.value)
            }
            placeholder="Buscar conversaciones"
            aria-label="Buscar conversaciones"
            className="search-input"
          />

          {busqueda ? (
            <button
              type="button"
              onClick={() => onBusquedaChange("")}
              aria-label="Limpiar búsqueda"
              className="clear-search"
            >
              <X size={15} />
            </button>
          ) : null}
        </div>

        <nav className="navigation">
          <NavButton
            icono={<Sparkles size={18} />}
            texto="EOS"
            descripcion="Asistente inteligente"
            activo={vista === "chat"}
            onClick={() => onVistaChange("chat")}
          />

          <NavButton
            icono={<FileText size={18} />}
            texto="Briefing"
            descripcion="Resumen ejecutivo"
            activo={vista === "briefing"}
            onClick={() => onVistaChange("briefing")}
          />

          <NavButton
            icono={<Scale size={18} />}
            texto="Decisiones"
            descripcion="Resultados y aprendizaje"
            activo={vista === "decisions"}
            onClick={() => onVistaChange("decisions")}
          />

          <NavButton
            icono={<BrainCircuit size={18} />}
            texto="Aprendizajes"
            descripcion="Patrones comprobados"
            activo={vista === "learnings"}
            onClick={() => onVistaChange("learnings")}
          />

          <NavButton
            icono={<BarChart3 size={18} />}
            texto="Dashboard"
            descripcion="Centro de control"
            activo={vista === "dashboard"}
            onClick={() => onVistaChange("dashboard")}
          />
        </nav>
      </div>

      <div className="sidebar-divider" />

      <section className="conversation-section">
        <div className="conversation-heading">
          <div>
            <span>CONVERSACIONES</span>
            <p>Historial reciente</p>
          </div>

          <span className="conversation-count">
            {conversacionesFiltradas.length}
          </span>
        </div>

        {conversacionesFiltradas.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">
              <MessageSquareText size={18} />
            </div>

            <strong>
              {busqueda
                ? "No encontramos resultados"
                : "Todavía no hay conversaciones"}
            </strong>

            <p>
              {busqueda
                ? "Probá buscando con otras palabras."
                : "Iniciá un nuevo chat para comenzar."}
            </p>
          </div>
        ) : (
          <div className="conversation-list">
            {conversacionesFiltradas.map((conversacion) => {
              const activa =
                conversacion.id === conversacionId;

              return (
                <button
                  type="button"
                  key={conversacion.id}
                  onClick={() =>
                    onAbrirConversacion(conversacion.id)
                  }
                  title={conversacion.titulo || "Nuevo chat"}
                  className={`conversation-button ${
                    activa ? "conversation-button-active" : ""
                  }`}
                >
                  <span className="conversation-icon">
                    <MessageSquareText size={14} />
                  </span>

                  <span className="conversation-copy">
                    <strong>
                      {conversacion.titulo || "Nuevo chat"}
                    </strong>

                    <small>
                      {formatearFecha(
                        conversacion.created_at,
                      )}
                    </small>
                  </span>

                  {activa ? (
                    <span className="active-conversation-dot" />
                  ) : (
                    <ChevronRight
                      size={14}
                      className="conversation-chevron"
                    />
                  )}
                </button>
              );
            })}
          </div>
        )}
      </section>

      <div className="sidebar-footer">
        <button
          type="button"
          onClick={() => onVistaChange("perfil")}
          className={`profile-button ${
            vista === "perfil" ? "profile-button-active" : ""
          }`}
        >
          <span className="profile-avatar">
            {iniciales}
            <span className="profile-online-dot" />
          </span>

          <span className="profile-copy">
            <strong>{nombre || "Usuario"}</strong>
            <small>Plan {planFormateado}</small>
          </span>

          <ChevronRight
            size={17}
            className="profile-chevron"
          />
        </button>

        <div className="connection-status">
          <span className="connection-dot" />

          <span>EOS conectado</span>
        </div>
      </div>

      <style jsx>{`
  .transtech-sidebar {
    position: relative;
    width: 100%;
    height: 100vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    border-right: 1px solid #e2e8f0;
    background: #ffffff;
    color: #071226;
    font-family: var(--font-inter), Inter, Arial, Helvetica, sans-serif;
    box-shadow: 14px 0 45px rgba(15, 23, 42, 0.055);
  }

  .sidebar-background {
    position: absolute;
    inset: 0;
    overflow: hidden;
    pointer-events: none;
  }

  .sidebar-grid {
    position: absolute;
    inset: 0;
    opacity: 0.32;
    background-image:
      linear-gradient(
        rgba(15, 23, 42, 0.035) 1px,
        transparent 1px
      ),
      linear-gradient(
        90deg,
        rgba(15, 23, 42, 0.035) 1px,
        transparent 1px
      );
    background-size: 34px 34px;
    mask-image: linear-gradient(
      to bottom,
      black,
      transparent 88%
    );
  }

  .sidebar-glow {
    position: absolute;
    border-radius: 50%;
    filter: blur(100px);
  }

  .sidebar-glow-one {
    top: -180px;
    left: -160px;
    width: 380px;
    height: 380px;
    background: rgba(37, 99, 235, 0.13);
  }

  .sidebar-glow-two {
    right: -190px;
    bottom: -210px;
    width: 410px;
    height: 410px;
    background: rgba(96, 165, 250, 0.12);
  }

  .sidebar-header,
  .conversation-section,
  .sidebar-footer,
  .sidebar-divider {
    position: relative;
    z-index: 1;
  }

  .sidebar-header {
    flex-shrink: 0;
    padding: 19px 16px 15px;
  }

  .new-chat-button {
    width: 100%;
    min-height: 61px;
    display: flex;
    align-items: center;
    gap: 12px;
    margin-top: 23px;
    padding: 10px 12px;
    border: 1px solid #1656bd;
    border-radius: 17px;
    background: linear-gradient(
      135deg,
      #1656bd,
      #113f8c
    );
    color: #ffffff;
    font-family: inherit;
    text-align: left;
    cursor: pointer;
    box-shadow: 0 14px 30px rgba(37, 99, 235, 0.2);
    transition:
      transform 180ms ease,
      background 180ms ease,
      box-shadow 180ms ease;
  }

  .new-chat-button:hover {
    transform: translateY(-2px);
    background: linear-gradient(
      135deg,
      #113f8c,
      #113f8c
    );
    box-shadow: 0 18px 38px rgba(37, 99, 235, 0.26);
  }

  .new-chat-icon {
    width: 40px;
    height: 40px;
    flex-shrink: 0;
    display: grid;
    place-items: center;
    border: 1px solid rgba(255, 255, 255, 0.22);
    border-radius: 13px;
    background: rgba(255, 255, 255, 0.14);
    color: #ffffff;
  }

  .new-chat-copy {
    min-width: 0;
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .new-chat-copy strong {
    font-size: 14px;
    font-weight: 850;
  }

  .new-chat-copy small {
    color: #e9f0fb;
    font-size: 10px;
  }

  .new-chat-chevron {
    color: #e9f0fb;
    transition: transform 180ms ease;
  }

  .new-chat-button:hover .new-chat-chevron {
    transform: translateX(2px);
  }

  .search-wrapper {
    position: relative;
    margin-top: 13px;
  }

  .search-icon {
    position: absolute;
    top: 50%;
    left: 14px;
    transform: translateY(-50%);
    color: #64748b;
    pointer-events: none;
  }

  .search-input {
    width: 100%;
    height: 44px;
    box-sizing: border-box;
    padding: 0 39px;
    border: 1px solid #e2e8f0;
    border-radius: 14px;
    outline: none;
    background: #f8fafc;
    color: #071226;
    font-family: inherit;
    font-size: 12px;
    transition:
      border-color 180ms ease,
      background 180ms ease,
      box-shadow 180ms ease;
  }

  .search-input::placeholder {
    color: #94a3b8;
  }

  .search-input:focus {
    border-color: #2f72d6;
    background: #ffffff;
    box-shadow: 0 0 0 4px rgba(37, 99, 235, 0.08);
  }

  .clear-search {
    position: absolute;
    top: 50%;
    right: 10px;
    width: 26px;
    height: 26px;
    display: grid;
    place-items: center;
    transform: translateY(-50%);
    border: 0;
    border-radius: 8px;
    background: transparent;
    color: #64748b;
    cursor: pointer;
  }

  .clear-search:hover {
    background: #eef3fb;
    color: #1656bd;
  }

  .navigation {
    display: grid;
    gap: 5px;
    margin-top: 15px;
  }

  .sidebar-divider {
    height: 1px;
    flex-shrink: 0;
    margin: 0 16px;
    background: linear-gradient(
      90deg,
      transparent,
      #dbe3ef,
      transparent
    );
  }

  .conversation-section {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 17px 12px 14px;
    scrollbar-width: thin;
    scrollbar-color: rgba(37, 99, 235, 0.25) transparent;
  }

  .conversation-section::-webkit-scrollbar {
    width: 5px;
  }

  .conversation-section::-webkit-scrollbar-thumb {
    border-radius: 999px;
    background: rgba(37, 99, 235, 0.22);
  }

  .conversation-heading {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 10px;
    padding: 0 8px;
    margin-bottom: 10px;
  }

  .conversation-heading span:first-child {
    color: #64748b;
    font-size: 9px;
    font-weight: 900;
    letter-spacing: 0.14em;
  }

  .conversation-heading p {
    margin: 4px 0 0;
    color: #94a3b8;
    font-size: 9px;
  }

  .conversation-count {
    min-width: 23px;
    height: 21px;
    display: grid;
    place-items: center;
    padding: 0 6px;
    border: 1px solid #e9f0fb;
    border-radius: 999px;
    background: #eef3fb;
    color: #1656bd;
    font-size: 9px;
    font-weight: 850;
  }

  .conversation-list {
    display: grid;
    gap: 4px;
  }

  .conversation-button {
    position: relative;
    width: 100%;
    min-height: 48px;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 10px;
    border: 1px solid transparent;
    border-radius: 13px;
    background: transparent;
    color: #64748b;
    font-family: inherit;
    text-align: left;
    cursor: pointer;
    transition:
      background 160ms ease,
      border-color 160ms ease,
      color 160ms ease,
      transform 160ms ease;
  }

  .conversation-button:hover {
    transform: translateX(2px);
    border-color: #e9f0fb;
    background: #f8fbff;
    color: #071226;
  }

  .conversation-button-active {
    border-color: #a9c6ee;
    background: linear-gradient(
      90deg,
      #eef3fb,
      #f8fbff
    );
    color: #071226;
    box-shadow: 0 9px 24px rgba(37, 99, 235, 0.08);
  }

  .conversation-icon {
    width: 29px;
    height: 29px;
    flex-shrink: 0;
    display: grid;
    place-items: center;
    border-radius: 9px;
    background: #f1f5f9;
    color: #64748b;
  }

  .conversation-button-active .conversation-icon {
    background: #e9f0fb;
    color: #1656bd;
  }

  .conversation-copy {
    min-width: 0;
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .conversation-copy strong {
    overflow: hidden;
    color: inherit;
    font-size: 12px;
    font-weight: 750;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .conversation-copy small {
    overflow: hidden;
    color: #94a3b8;
    font-size: 8px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .conversation-chevron {
    flex-shrink: 0;
    color: #94a3b8;
  }

  .active-conversation-dot {
    width: 6px;
    height: 6px;
    flex-shrink: 0;
    border-radius: 999px;
    background: #1656bd;
    box-shadow: 0 0 12px rgba(37, 99, 235, 0.55);
  }

  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 34px 18px;
    text-align: center;
  }

  .empty-icon {
    width: 42px;
    height: 42px;
    display: grid;
    place-items: center;
    border: 1px solid #e9f0fb;
    border-radius: 14px;
    background: #eef3fb;
    color: #1656bd;
  }

  .empty-state strong {
    margin-top: 13px;
    color: #334155;
    font-size: 12px;
  }

  .empty-state p {
    margin: 7px 0 0;
    color: #94a3b8;
    font-size: 10px;
    line-height: 1.5;
  }

  .sidebar-footer {
    flex-shrink: 0;
    padding: 13px 14px 15px;
    border-top: 1px solid #e2e8f0;
    background: rgba(255, 255, 255, 0.9);
    backdrop-filter: blur(18px);
  }

  .profile-button {
    width: 100%;
    min-height: 57px;
    display: flex;
    align-items: center;
    gap: 11px;
    padding: 9px 10px;
    border: 1px solid transparent;
    border-radius: 15px;
    background: transparent;
    color: #071226;
    font-family: inherit;
    text-align: left;
    cursor: pointer;
    transition:
      background 180ms ease,
      border-color 180ms ease,
      transform 180ms ease;
  }

  .profile-button:hover,
  .profile-button-active {
    transform: translateY(-1px);
    border-color: #a9c6ee;
    background: #eef3fb;
  }

  .profile-avatar {
    position: relative;
    width: 39px;
    height: 39px;
    flex-shrink: 0;
    display: grid;
    place-items: center;
    border: 1px solid #a9c6ee;
    border-radius: 13px;
    background: linear-gradient(
      135deg,
      #e9f0fb,
      #eef3fb
    );
    color: #1656bd;
    font-size: 10px;
    font-weight: 900;
  }

  .profile-online-dot {
    position: absolute;
    right: -2px;
    bottom: -2px;
    width: 11px;
    height: 11px;
    border: 3px solid #ffffff;
    border-radius: 999px;
    background: #22c55e;
  }

  .profile-copy {
    min-width: 0;
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .profile-copy strong {
    overflow: hidden;
    color: #071226;
    font-size: 12px;
    font-weight: 800;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .profile-copy small {
    color: #64748b;
    font-size: 9px;
  }

  .profile-chevron {
    color: #94a3b8;
  }

  .connection-status {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 7px;
    margin-top: 8px;
    color: #64748b;
    font-size: 9px;
    font-weight: 700;
  }

  .connection-dot {
    width: 6px;
    height: 6px;
    border-radius: 999px;
    background: #22c55e;
    box-shadow: 0 0 10px rgba(34, 197, 94, 0.55);
  }
`}</style>
    </aside>
  );
}

function NavButton({
  icono,
  texto,
  descripcion,
  activo,
  onClick,
}: NavButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`nav-button ${
        activo ? "nav-button-active" : ""
      }`}
    >
      <span className="nav-icon">{icono}</span>

      <span className="nav-copy">
        <strong>{texto}</strong>
        <small>{descripcion}</small>
      </span>

      {activo ? (
        <span className="nav-indicator" />
      ) : (
        <ChevronRight
          size={15}
          className="nav-chevron"
        />
      )}

      <style jsx>{`
        .nav-button {
          position: relative;
          width: 100%;
          min-height: 49px;
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 7px 10px;
          border: 1px solid transparent;
          border-radius: 14px;
          background: transparent;
          color: #94a3b8;
          font-family: inherit;
          text-align: left;
          cursor: pointer;
          transition:
            background 180ms ease,
            border-color 180ms ease,
            color 180ms ease;
        }

        .nav-button:hover {
          border-color: rgba(148, 163, 184, 0.1);
          background: rgba(255, 255, 255, 0.04);
          color: #ffffff;
        }

        .nav-button-active {
          border-color: rgba(96, 165, 250, 0.2);
          background: linear-gradient(
            90deg,
            rgba(37, 99, 235, 0.2),
            rgba(37, 99, 235, 0.07)
          );
          color: #ffffff;
        }

        .nav-icon {
          width: 32px;
          height: 32px;
          flex-shrink: 0;
          display: grid;
          place-items: center;
          border-radius: 10px;
          background: rgba(255, 255, 255, 0.045);
          color: #71849d;
        }

        .nav-button-active .nav-icon {
          background: rgba(37, 99, 235, 0.2);
          color: #6fa3e8;
        }

        .nav-copy {
          min-width: 0;
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 3px;
        }

        .nav-copy strong {
          font-size: 12px;
          font-weight: 800;
        }

        .nav-copy small {
          color: #62758d;
          font-size: 8px;
        }

        .nav-indicator {
          width: 6px;
          height: 6px;
          border-radius: 999px;
          background: #2f72d6;
          box-shadow: 0 0 12px rgba(59, 130, 246, 0.7);
        }

        .nav-chevron {
          color: #51657c;
        }
      `}</style>
    </button>
  );
}

function capitalizar(value: string) {
  const normalizado = value.trim();

  if (!normalizado) return "Free";

  return (
    normalizado.charAt(0).toUpperCase() +
    normalizado.slice(1).toLowerCase()
  );
}

function formatearFecha(fecha?: string) {
  if (!fecha) return "Conversación EOS";

  const valor = new Date(fecha);

  if (Number.isNaN(valor.getTime())) {
    return "Conversación EOS";
  }

  return valor.toLocaleDateString("es-PY", {
    day: "2-digit",
    month: "short",
  });
}
