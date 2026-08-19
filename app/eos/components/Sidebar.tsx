"use client";

import Image from "next/image";
import { BarChart3, FileText, Lightbulb, Plus, ScrollText, PanelLeftClose } from "lucide-react";

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
  colapsado: boolean;
  onToggleColapsado: () => void;
  onVistaChange: (vista: Vista) => void;
  onBusquedaChange: (value: string) => void;
  onNuevoChat: () => void;
  onAbrirConversacion: (id: string) => void;
};

const NAV_ITEMS: { vista: Vista; label: string; icon: React.ReactNode }[] = [
  { vista: "briefing", label: "Briefing", icon: <FileText size={16} /> },
  { vista: "dashboard", label: "Dashboard", icon: <BarChart3 size={16} /> },
  { vista: "decisions", label: "Decisiones", icon: <ScrollText size={16} /> },
  { vista: "learnings", label: "Aprendizajes", icon: <Lightbulb size={16} /> },
];

export default function Sidebar({
  nombre,
  plan,
  vista,
  busqueda,
  conversacionId,
  conversaciones,
  onToggleColapsado,
  onVistaChange,
  onBusquedaChange,
  onNuevoChat,
  onAbrirConversacion,
}: SidebarProps) {
  const conversacionesFiltradas = conversaciones.filter((c) =>
    (c.titulo || "Nuevo chat").toLowerCase().includes(busqueda.toLowerCase()),
  );

  const iniciales =
    nombre
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((p) => p.charAt(0).toUpperCase())
      .join("") || "U";

  const planFormateado = capitalizar(plan || "free");

  return (
    <>
      <div className="side-top">
        <div className="brand">
          <Image className="brand-logo" src="/transtech-logo.png" alt="TransTech" width={26} height={26} />
          <div>
            <div className="brand-word">EOS</div>
            <div className="brand-sub">Executive Operating System</div>
          </div>
        </div>
        <button type="button" className="sidebar-toggle" onClick={onToggleColapsado} aria-label="Colapsar menú">
          <PanelLeftClose size={16} />
        </button>
      </div>

      <button type="button" className="row-item new" onClick={onNuevoChat}>
        <div className="ic">
          <Plus size={16} />
        </div>
        <span className="label">Nuevo chat</span>
      </button>

      <div className="search-row">
        <input
          type="text"
          placeholder="Buscar conversaciones"
          value={busqueda}
          onChange={(e) => onBusquedaChange(e.target.value)}
        />
      </div>

      {NAV_ITEMS.map((item) => (
        <button
          key={item.vista}
          type="button"
          className={`row-item nav-item ${vista === item.vista ? "active-view" : ""}`}
          onClick={() => onVistaChange(item.vista)}
        >
          <div className="ic">{item.icon}</div>
          <span className="label">{item.label}</span>
        </button>
      ))}

      <div className="conv-scroll">
        <div className="section-label">Conversaciones</div>

        {conversacionesFiltradas.length === 0 ? (
          <div className="conv" style={{ color: "var(--muted)", cursor: "default" }}>
            {busqueda ? "Sin resultados" : "Todavía no hay conversaciones"}
          </div>
        ) : (
          conversacionesFiltradas.map((c) => (
            <button
              key={c.id}
              type="button"
              className={`conv ${vista === "chat" && c.id === conversacionId ? "active" : ""}`}
              onClick={() => onAbrirConversacion(c.id)}
            >
              {c.titulo || "Nuevo chat"}
              <span className="d">{formatearFecha(c.created_at)}</span>
            </button>
          ))
        )}
      </div>

      <div className="side-bottom">
        <button type="button" className="profile-row" onClick={() => onVistaChange("perfil")}>
          <div className="avatar">{iniciales}</div>
          <div>
            <div className="pname">{nombre || "Usuario"}</div>
            <div className="plan">Plan {planFormateado}</div>
          </div>
        </button>
      </div>
    </>
  );
}

function capitalizar(value: string) {
  const normalizado = value.trim();
  if (!normalizado) return "Free";
  return normalizado.charAt(0).toUpperCase() + normalizado.slice(1).toLowerCase();
}

function formatearFecha(fecha?: string) {
  if (!fecha) return "";

  const valor = new Date(fecha);
  if (Number.isNaN(valor.getTime())) return "";

  return valor.toLocaleDateString("es-PY", { day: "2-digit", month: "short" });
}
