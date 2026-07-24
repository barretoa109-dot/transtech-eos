"use client";

import { eosTheme } from "../theme/theme";

type Status =
  | "success"
  | "warning"
  | "danger"
  | "info";

type Props = {
  status: Status;
  children: React.ReactNode;
};

const map = {
  success: {
    bg: eosTheme.colors.state.successSoft,
    color: eosTheme.colors.state.success,
  },

  warning: {
    bg: eosTheme.colors.state.warningSoft,
    color: eosTheme.colors.state.warning,
  },

  danger: {
    bg: eosTheme.colors.state.dangerSoft,
    color: eosTheme.colors.state.danger,
  },

  info: {
    bg: eosTheme.colors.state.infoSoft,
    color: eosTheme.colors.state.info,
  },
};

export default function StatusBadge({
  status,
  children,
}: Props) {
  return (
    <span
      style={{
        padding: "6px 12px",

        borderRadius: 999,

        background: map[status].bg,

        color: map[status].color,

        fontWeight: 700,

        fontSize: 12,
      }}
    >
      {children}
    </span>
  );
}