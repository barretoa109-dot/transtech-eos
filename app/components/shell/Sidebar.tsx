"use client";

import {
  BarChart3,
  BrainCircuit,
  ChevronLeft,
  ChevronRight,
  CircleUserRound,
  FileText,
  LayoutDashboard,
  Menu,
  MessageSquareText,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Search,
  Settings,
  Sparkles,
  Target,
  X,
} from "lucide-react";

import type { ReactNode } from "react";

import SidebarItem from "../ui/navigation/SidebarItem";
import { eosTheme } from "../ui/theme/theme";

import SidebarScore from "./SidebarScore";
import SidebarSection from "./SidebarSection";

export type EOSView =
  | "dashboard"
  | "chat"
  | "objectives"
  | "documents"
  | "briefing"
  | "profile"
  | "settings";

export type SidebarConversation = {
  id: string;
  title: string;
  updatedAt?: string;
  active?: boolean;
  unread?: number;
};

type SidebarProps = {
  activeView: EOSView;
  onNavigate: (view: EOSView) => void;

  userName?: string;
  userPlan?: string;
  userEmail?: string;

  eosScore?: number;
  activeObjectives?: number;
  generatedDocuments?: number;
  unreadConversations?: number;

  conversations?: SidebarConversation[];
  activeConversationId?: string | null;

  onSelectConversation?: (conversationId: string) => void;
  onNewConversation?: () => void;
  onSearch?: () => void;

  collapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;

  mobileOpen?: boolean;
  onMobileOpenChange?: (open: boolean) => void;

  logo?: ReactNode;
};

const sidebarWidth = 292;
const collapsedWidth = 88;

export default function Sidebar({
  activeView,
  onNavigate,

  userName = "Augusto",
  userPlan = "Free",
  userEmail,

  eosScore = 84,
  activeObjectives = 0,
  generatedDocuments = 0,
  unreadConversations = 0,

  conversations = [],
  activeConversationId = null,

  onSelectConversation,
  onNewConversation,
  onSearch,

  collapsed = false,
  onCollapsedChange,

  mobileOpen = false,
  onMobileOpenChange,

  logo,
}: SidebarProps) {
  const visibleConversations = conversations.slice(0, 5);

  function closeMobileSidebar() {
    onMobileOpenChange?.(false);
  }

  function navigate(view: EOSView) {
    onNavigate(view);
    closeMobileSidebar();
  }

  function selectConversation(conversationId: string) {
    onSelectConversation?.(conversationId);
    closeMobileSidebar();
  }

  return (
    <>
      <button
        type="button"
        aria-label="Abrir menú"
        className="eos-sidebar-mobile-trigger"
        onClick={() => onMobileOpenChange?.(true)}
        style={{
          position: "fixed",
          top: 16,
          left: 16,
          zIndex: 80,
          width: 44,
          height: 44,
          display: "none",
          placeItems: "center",
          borderRadius: 14,
          border: `1px solid ${eosTheme.colors.border.default}`,
          background: eosTheme.colors.background.elevated,
          color: eosTheme.colors.text.primary,
          boxShadow: eosTheme.shadows.card,
          cursor: "pointer",
        }}
      >
        <Menu size={21} />
      </button>

      <div
        aria-hidden={!mobileOpen}
        className={`eos-sidebar-overlay ${
          mobileOpen ? "eos-sidebar-overlay-open" : ""
        }`}
        onClick={closeMobileSidebar}
      />

      <aside
        className={[
          "eos-sidebar",
          collapsed ? "eos-sidebar-collapsed" : "",
          mobileOpen ? "eos-sidebar-mobile-open" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        style={{
          position: "fixed",
          inset: "0 auto 0 0",
          zIndex: 90,
          width: collapsed ? collapsedWidth : sidebarWidth,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          borderRight: `1px solid ${eosTheme.colors.border.subtle}`,
          background:
            "linear-gradient(180deg, rgba(8, 20, 35, 0.99), rgba(6, 16, 29, 0.99))",
          boxShadow: "18px 0 55px rgba(2, 8, 23, 0.18)",
          backdropFilter: eosTheme.blur.strong,
          transition: "width 220ms ease, transform 220ms ease",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: collapsed ? "center" : "space-between",
            gap: 12,
            minHeight: 82,
            padding: collapsed ? "16px 12px" : "16px 18px",
            borderBottom: `1px solid ${eosTheme.colors.border.subtle}`,
          }}
        >
          <div
            style={{
              minWidth: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: collapsed ? "center" : "flex-start",
              gap: 12,
            }}
          >
            <div
              style={{
                width: 44,
                height: 44,
                flexShrink: 0,
                display: "grid",
                placeItems: "center",
                overflow: "hidden",
                borderRadius: 15,
                border: `1px solid ${eosTheme.colors.border.accent}`,
                background: eosTheme.colors.gradient.accent,
                color: "#ffffff",
                boxShadow: eosTheme.shadows.accent,
              }}
            >
              {logo ?? <BrainCircuit size={24} strokeWidth={2.1} />}
            </div>

            {!collapsed ? (
              <div
                style={{
                  minWidth: 0,
                }}
              >
                <div
                  style={{
                    color: eosTheme.colors.text.primary,
                    fontSize: 15,
                    fontWeight: 900,
                    letterSpacing: "-0.02em",
                    whiteSpace: "nowrap",
                  }}
                >
                  TransTech EOS
                </div>

                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    marginTop: 4,
                    color: eosTheme.colors.text.muted,
                    fontSize: 10,
                  }}
                >
                  <span
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: "50%",
                      background: eosTheme.colors.state.success,
                      boxShadow: `0 0 10px ${eosTheme.colors.glow.success}`,
                    }}
                  />

                  Inteligencia empresarial
                </div>
              </div>
            ) : null}
          </div>

          {!collapsed ? (
            <button
              type="button"
              aria-label="Cerrar menú"
              className="eos-sidebar-mobile-close"
              onClick={closeMobileSidebar}
              style={iconControlStyle}
            >
              <X size={18} />
            </button>
          ) : null}
        </div>

        <div
          className="eos-sidebar-scroll"
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            gap: 22,
            overflowY: "auto",
            overflowX: "hidden",
            padding: collapsed ? "18px 12px" : "18px 14px",
          }}
        >
          {!collapsed ? (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 44px",
                gap: 9,
              }}
            >
              <button
                type="button"
                onClick={onNewConversation}
                style={{
                  minWidth: 0,
                  minHeight: 44,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 9,
                  padding: "0 14px",
                  border: 0,
                  borderRadius: 14,
                  background: eosTheme.colors.gradient.accent,
                  color: "#ffffff",
                  boxShadow: eosTheme.shadows.accent,
                  fontSize: 12,
                  fontWeight: 800,
                  cursor: "pointer",
                }}
              >
                <Plus size={17} />
                Nueva conversación
              </button>

              <button
                type="button"
                aria-label="Buscar"
                onClick={onSearch}
                style={{
                  ...iconControlStyle,
                  width: 44,
                  height: 44,
                  borderColor: eosTheme.colors.border.default,
                  background: eosTheme.colors.surface.secondary,
                }}
              >
                <Search size={18} />
              </button>
            </div>
          ) : (
            <div
              style={{
                display: "grid",
                gap: 9,
              }}
            >
              <CollapsedAction
                label="Nueva conversación"
                icon={<Plus size={19} />}
                onClick={onNewConversation}
                accent
              />

              <CollapsedAction
                label="Buscar"
                icon={<Search size={18} />}
                onClick={onSearch}
              />
            </div>
          )}

          <SidebarSection title={collapsed ? undefined : "Navegación"}>
            <SidebarItem
              icon={<LayoutDashboard size={20} />}
              label={collapsed ? "" : "Dashboard"}
              subtitle={
                collapsed ? undefined : "Centro general de control"
              }
              active={activeView === "dashboard"}
              onClick={() => navigate("dashboard")}
            />

            <SidebarItem
              icon={<MessageSquareText size={20} />}
              label={collapsed ? "" : "EOS Chat"}
              subtitle={
                collapsed ? undefined : "Conversaciones inteligentes"
              }
              badge={
                !collapsed && unreadConversations > 0
                  ? String(unreadConversations)
                  : undefined
              }
              active={activeView === "chat"}
              onClick={() => navigate("chat")}
            />

            <SidebarItem
              icon={<Target size={20} />}
              label={collapsed ? "" : "Objetivos"}
              subtitle={
                collapsed ? undefined : "Seguimiento y ejecución"
              }
              badge={
                !collapsed && activeObjectives > 0
                  ? String(activeObjectives)
                  : undefined
              }
              active={activeView === "objectives"}
              onClick={() => navigate("objectives")}
            />

            <SidebarItem
              icon={<FileText size={20} />}
              label={collapsed ? "" : "Documentos"}
              subtitle={
                collapsed ? undefined : "Archivos generados por EOS"
              }
              badge={
                !collapsed && generatedDocuments > 0
                  ? String(generatedDocuments)
                  : undefined
              }
              active={activeView === "documents"}
              onClick={() => navigate("documents")}
            />

            <SidebarItem
              icon={<BarChart3 size={20} />}
              label={collapsed ? "" : "Briefing"}
              subtitle={
                collapsed ? undefined : "Análisis y recomendaciones"
              }
              active={activeView === "briefing"}
              onClick={() => navigate("briefing")}
            />
          </SidebarSection>

          {!collapsed && visibleConversations.length > 0 ? (
            <SidebarSection title="Conversaciones recientes">
              <div
                style={{
                  display: "grid",
                  gap: 5,
                }}
              >
                {visibleConversations.map((conversation) => {
                  const isActive =
                    conversation.id === activeConversationId ||
                    conversation.active;

                  return (
                    <button
                      key={conversation.id}
                      type="button"
                      onClick={() =>
                        selectConversation(conversation.id)
                      }
                      style={{
                        width: "100%",
                        minWidth: 0,
                        display: "grid",
                        gridTemplateColumns: "9px minmax(0, 1fr) auto",
                        alignItems: "center",
                        gap: 10,
                        padding: "10px 11px",
                        borderRadius: 13,
                        border: `1px solid ${
                          isActive
                            ? eosTheme.colors.border.accent
                            : "transparent"
                        }`,
                        background: isActive
                          ? eosTheme.colors.surface.secondary
                          : "transparent",
                        color: eosTheme.colors.text.secondary,
                        textAlign: "left",
                        cursor: "pointer",
                        transition: eosTheme.transition.fast,
                      }}
                    >
                      <span
                        style={{
                          width: 7,
                          height: 7,
                          borderRadius: "50%",
                          background: isActive
                            ? eosTheme.colors.accent.cyan
                            : eosTheme.colors.text.disabled,
                          boxShadow: isActive
                            ? `0 0 10px ${eosTheme.colors.glow.cyan}`
                            : "none",
                        }}
                      />

                      <span
                        style={{
                          minWidth: 0,
                        }}
                      >
                        <span
                          style={{
                            display: "block",
                            overflow: "hidden",
                            color: isActive
                              ? eosTheme.colors.text.primary
                              : eosTheme.colors.text.secondary,
                            fontSize: 12,
                            fontWeight: isActive ? 750 : 600,
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {conversation.title || "Nueva conversación"}
                        </span>

                        {conversation.updatedAt ? (
                          <span
                            style={{
                              display: "block",
                              marginTop: 3,
                              color: eosTheme.colors.text.subtle,
                              fontSize: 9,
                            }}
                          >
                            {conversation.updatedAt}
                          </span>
                        ) : null}
                      </span>

                      {conversation.unread ? (
                        <span
                          style={{
                            minWidth: 20,
                            height: 20,
                            display: "grid",
                            placeItems: "center",
                            padding: "0 5px",
                            borderRadius: 999,
                            background:
                              eosTheme.colors.state.infoSoft,
                            color: eosTheme.colors.accent.cyan,
                            fontSize: 9,
                            fontWeight: 900,
                          }}
                        >
                          {conversation.unread}
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </SidebarSection>
          ) : null}

          {!collapsed ? (
            <SidebarScore
              score={eosScore}
              onOpenDashboard={() => navigate("dashboard")}
            />
          ) : null}

          <div
            style={{
              marginTop: "auto",
            }}
          >
            <SidebarSection title={collapsed ? undefined : "Cuenta"}>
              <SidebarItem
                icon={<CircleUserRound size={20} />}
                label={collapsed ? "" : "Perfil"}
                subtitle={
                  collapsed ? undefined : "Información y preferencias"
                }
                active={activeView === "profile"}
                onClick={() => navigate("profile")}
              />

              <SidebarItem
                icon={<Settings size={20} />}
                label={collapsed ? "" : "Configuración"}
                subtitle={
                  collapsed ? undefined : "Sistema y conexiones"
                }
                active={activeView === "settings"}
                onClick={() => navigate("settings")}
              />
            </SidebarSection>
          </div>
        </div>

        <div
          style={{
            padding: collapsed ? 12 : 14,
            borderTop: `1px solid ${eosTheme.colors.border.subtle}`,
          }}
        >
          {!collapsed ? (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 11,
                padding: 11,
                borderRadius: 15,
                border: `1px solid ${eosTheme.colors.border.subtle}`,
                background: eosTheme.colors.surface.transparent,
              }}
            >
              <div
                style={{
                  width: 38,
                  height: 38,
                  flexShrink: 0,
                  display: "grid",
                  placeItems: "center",
                  borderRadius: 13,
                  background: eosTheme.colors.state.infoSoft,
                  color: eosTheme.colors.accent.cyan,
                  fontSize: 13,
                  fontWeight: 900,
                }}
              >
                {getInitials(userName)}
              </div>

              <div
                style={{
                  minWidth: 0,
                  flex: 1,
                }}
              >
                <div
                  style={{
                    overflow: "hidden",
                    color: eosTheme.colors.text.primary,
                    fontSize: 12,
                    fontWeight: 800,
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {userName}
                </div>

                <div
                  style={{
                    overflow: "hidden",
                    marginTop: 3,
                    color: eosTheme.colors.text.muted,
                    fontSize: 9,
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {userEmail || `Plan ${userPlan}`}
                </div>
              </div>

              <div
                style={{
                  padding: "4px 7px",
                  borderRadius: 999,
                  background: eosTheme.colors.state.infoSoft,
                  color: eosTheme.colors.accent.cyan,
                  fontSize: 9,
                  fontWeight: 900,
                  textTransform: "uppercase",
                }}
              >
                {userPlan}
              </div>
            </div>
          ) : (
            <div
              title={userName}
              style={{
                width: 44,
                height: 44,
                margin: "0 auto",
                display: "grid",
                placeItems: "center",
                borderRadius: 14,
                background: eosTheme.colors.state.infoSoft,
                color: eosTheme.colors.accent.cyan,
                fontSize: 12,
                fontWeight: 900,
              }}
            >
              {getInitials(userName)}
            </div>
          )}

          <button
            type="button"
            aria-label={
              collapsed ? "Expandir barra lateral" : "Contraer barra lateral"
            }
            onClick={() => onCollapsedChange?.(!collapsed)}
            className="eos-sidebar-collapse-control"
            style={{
              width: "100%",
              minHeight: 40,
              display: "flex",
              alignItems: "center",
              justifyContent: collapsed ? "center" : "space-between",
              gap: 10,
              marginTop: 9,
              padding: collapsed ? 0 : "0 10px",
              border: 0,
              borderRadius: 12,
              background: "transparent",
              color: eosTheme.colors.text.muted,
              fontSize: 10,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            {!collapsed ? <span>Contraer menú</span> : null}

            {collapsed ? (
              <PanelLeftOpen size={17} />
            ) : (
              <PanelLeftClose size={17} />
            )}
          </button>
        </div>
      </aside>

      <style jsx global>{`
        .eos-sidebar-scroll {
          scrollbar-width: thin;
          scrollbar-color: rgba(100, 116, 139, 0.35) transparent;
        }

        .eos-sidebar-scroll::-webkit-scrollbar {
          width: 5px;
        }

        .eos-sidebar-scroll::-webkit-scrollbar-track {
          background: transparent;
        }

        .eos-sidebar-scroll::-webkit-scrollbar-thumb {
          border-radius: 999px;
          background: rgba(100, 116, 139, 0.32);
        }

        .eos-sidebar-overlay {
          position: fixed;
          inset: 0;
          z-index: 85;
          visibility: hidden;
          background: rgba(2, 8, 23, 0.64);
          opacity: 0;
          backdrop-filter: blur(4px);
          transition:
            opacity 200ms ease,
            visibility 200ms ease;
        }

        .eos-sidebar-overlay-open {
          visibility: visible;
          opacity: 1;
        }

        @media (max-width: 900px) {
          .eos-sidebar-mobile-trigger {
            display: grid !important;
          }

          .eos-sidebar {
            width: min(292px, calc(100vw - 30px)) !important;
            transform: translateX(-105%);
          }

          .eos-sidebar-mobile-open {
            transform: translateX(0);
          }

          .eos-sidebar-collapse-control {
            display: none !important;
          }

          .eos-sidebar-mobile-close {
            display: grid !important;
          }
        }

        @media (min-width: 901px) {
          .eos-sidebar-overlay {
            display: none;
          }

          .eos-sidebar-mobile-close {
            display: none !important;
          }
        }
      `}</style>
    </>
  );
}

function CollapsedAction({
  label,
  icon,
  onClick,
  accent = false,
}: {
  label: string;
  icon: ReactNode;
  onClick?: () => void;
  accent?: boolean;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      style={{
        width: 48,
        height: 48,
        margin: "0 auto",
        display: "grid",
        placeItems: "center",
        border: accent
          ? "none"
          : `1px solid ${eosTheme.colors.border.default}`,
        borderRadius: 15,
        background: accent
          ? eosTheme.colors.gradient.accent
          : eosTheme.colors.surface.secondary,
        color: accent ? "#ffffff" : eosTheme.colors.text.secondary,
        boxShadow: accent ? eosTheme.shadows.accent : "none",
        cursor: "pointer",
      }}
    >
      {icon}
    </button>
  );
}

function getInitials(name: string) {
  const normalizedName = name.trim();

  if (!normalizedName) return "EO";

  return normalizedName
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
}

const iconControlStyle: React.CSSProperties = {
  width: 36,
  height: 36,
  flexShrink: 0,
  display: "grid",
  placeItems: "center",
  borderRadius: 12,
  border: `1px solid ${eosTheme.colors.border.subtle}`,
  background: eosTheme.colors.surface.transparent,
  color: eosTheme.colors.text.secondary,
  cursor: "pointer",
};