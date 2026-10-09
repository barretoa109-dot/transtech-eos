"use client";

import { useEffect, useState } from "react";

/**
 * "Cómo venís": catorce barras, una por día, con las acciones completadas de
 * ese día. Pieza de la reorganización de Personal maquetada y aprobada en el
 * canal de diseño (09/10/2026) — la que faltaba después del sidebar agrupado
 * (#256) y el detalle colapsable (#258).
 *
 * No inventa una tendencia con poca historia: si no hubo ni una acción en los
 * catorce días, no se muestra (un gráfico en cero no dice nada y ocupa lugar
 * de algo que sí lo diría).
 */

type Dia = { fecha: string; cantidad: number; esHoy: boolean };

const DIA_SEMANA = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];

function etiquetaDia(fecha: string): string {
  const [a, m, d] = fecha.split("-").map(Number);
  return DIA_SEMANA[new Date(Date.UTC(a, m - 1, d)).getUTCDay()];
}

export default function ComoVenis() {
  const [dias, setDias] = useState<Dia[] | null>(null);

  useEffect(() => {
    let vigente = true;
    fetch("/api/finanzas/progreso", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("fallo"))))
      .then((d: { dias: Dia[] }) => {
        if (vigente) setDias(d.dias);
      })
      .catch(() => {
        if (vigente) setDias(null);
      });
    return () => {
      vigente = false;
    };
  }, []);

  if (!dias || dias.every((d) => d.cantidad === 0)) return null;

  const max = Math.max(...dias.map((d) => d.cantidad));

  return (
    <div className="card fin-card">
      <div className="fin-head">
        <span className="card-title">Cómo venís</span>
        <span className="como-venis-rango">Últimos 14 días</span>
      </div>
      <div className="como-venis-barras" role="img" aria-label={`Acciones completadas por día, últimos 14 días: ${dias.map((d) => `${etiquetaDia(d.fecha)} ${d.cantidad}`).join(", ")}`}>
        {dias.map((d) => (
          <div
            key={d.fecha}
            className={d.esHoy ? "como-venis-barra como-venis-barra-hoy" : "como-venis-barra"}
            style={{ height: `${8 + (d.cantidad / max) * 56}px` }}
            title={`${etiquetaDia(d.fecha)} ${d.fecha.slice(8, 10)}: ${d.cantidad} acci${d.cantidad === 1 ? "ón" : "ones"}`}
          />
        ))}
      </div>
    </div>
  );
}
