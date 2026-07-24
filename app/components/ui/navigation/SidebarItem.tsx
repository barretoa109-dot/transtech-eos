"use client";

import type { ReactNode } from "react";
import { eosTheme } from "../theme/theme";

type SidebarItemProps = {
  icon: ReactNode;
  label: string;
  active?: boolean;
  badge?: string;
  subtitle?: string;
  onClick?: () => void;
  disabled?: boolean;
};

export default function SidebarItem({
  icon,
  label,
  active = false,
  badge,
  subtitle,
  onClick,
  disabled = false,
}: SidebarItemProps) {
  const compact = !label;

  return (
    <button
      type="button"
      title={compact ? subtitle : undefined}
      aria-label={compact ? subtitle : label}
      onClick={onClick}
      disabled={disabled}
      style={{
        width: compact ? 48 : "100%",
        minHeight: compact ? 48 : 58,
        margin: compact ? "0 auto" : 0,
        display: "flex",
        alignItems: "center",
        justifyContent: compact ? "center" : "flex-start",
        gap: compact ? 0 : 13,
        padding: compact ? 0 : "9px 11px",
        borderRadius: 15,
        border: `1px solid ${
          active
            ? eosTheme.colors.border.accent
            : "transparent"
        }`,
        background: active
          ? eosTheme.colors.surface.secondary
          : "transparent",
        color: active
          ? eosTheme.colors.accent.cyan
          : eosTheme.colors.text.secondary,
        textAlign: "left",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
        transition: eosTheme.transition.normal,
      }}
      onMouseEnter={(event) => {
        if (active || disabled) return;

        event.currentTarget.style.background =
          eosTheme.colors.surface.transparent;

        event.currentTarget.style.color =
          eosTheme.colors.text.primary;
      }}
      onMouseLeave={(event) => {
        if (active || disabled) return;

        event.currentTarget.style.background = "transparent";

        event.currentTarget.style.color =
          eosTheme.colors.text.secondary;
      }}
    >
      <span
        style={{
          width: compact ? 48 : 39,
          height: compact ? 48 : 39,
          flexShrink: 0,
          display: "grid",
          placeItems: "center",
          borderRadius: compact ? 15 : 13,
          background: active
            ? eosTheme.colors.state.infoSoft
            : compact
              ? eosTheme.colors.surface.transparent
              : "transparent",
          color: active
            ? eosTheme.colors.accent.cyan
            : "inherit",
        }}
      >
        {icon}
      </span>

      {!compact ? (
        <>
          <span
            style={{
              minWidth: 0,
              flex: 1,
            }}
          >
            <span
              style={{
                display: "block",
                overflow: "hidden",
                color: active
                  ? eosTheme.colors.text.primary
                  : "inherit",
                fontSize: 12,
                fontWeight: active ? 800 : 700,
                lineHeight: 1.25,
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {label}
            </span>

            {subtitle ? (
              <span
                style={{
                  display: "block",
                  overflow: "hidden",
                  marginTop: 4,
                  color: eosTheme.colors.text.muted,
                  fontSize: 9,
                  lineHeight: 1.3,
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {subtitle}
              </span>
            ) : null}
          </span>

          {badge ? (
            <span
              style={{
                minWidth: 24,
                height: 24,
                display: "grid",
                placeItems: "center",
                padding: "0 7px",
                borderRadius: 999,
                background: eosTheme.colors.state.infoSoft,
                color: eosTheme.colors.accent.cyan,
                fontSize: 9,
                fontWeight: 900,
              }}
            >
              {badge}
            </span>
          ) : null}
        </>
      ) : null}
    </button>
  );
}