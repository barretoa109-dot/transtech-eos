"use client";

import { Sparkles } from "lucide-react";

export default function TopBar() {
  return (
    <div className="topbar">
      <div className="status">
        <span className="dot-wrap">
          <span className="dot" />
          <span className="dot-ping" />
        </span>
        Sistema activo
      </div>
      <div className="status mem">
        <Sparkles size={14} />
        Memoria contextual
      </div>
    </div>
  );
}
