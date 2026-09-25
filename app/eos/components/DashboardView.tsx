"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, Check, Lightbulb, Target, TrendingDown, TrendingUp } from "lucide-react";
import PanelIndicadores from "./PanelIndicadores";
import Hallazgos from "./Hallazgos";
import EvolucionScore, { type FuenteScore } from "./graficos/EvolucionScore";
import type { Briefing, ScorePunto, SeriesScore } from "../types/briefing";

type DashboardViewProps = {
  briefing: Briefing;
  briefingHistory: Briefing[];
  /** La serie de un año del score. null si la API no la mandó. */
  scoreHistory: ScorePunto[] | null;
  /** El score del negocio y el personal de cada día. null si la API no lo mandó. */
  scoreSeries: SeriesScore | null;
  plan: string;
  totalConversations: number;
  totalMessages: number;
  onOpenChat: () => void;
};

export default function DashboardView({
  briefing,
  briefingHistory,
  scoreHistory,
  scoreSeries,
  totalConversations,
  totalMessages,
  onOpenChat,
}: DashboardViewProps) {
  const fuentes = briefing.fuentes ?? {};

  const prioridades = [briefing.prioridad_1, briefing.prioridad_2, briefing.prioridad_3].filter(
    (p): p is string => Boolean(p && p.trim()),
  );

  // La maqueta muestra varias recomendaciones; acá las adicionales salen de
  // los riesgos reales que detectó el briefing, no de texto inventado.
  const riesgos = (briefing.riesgos ?? []).filter((r) => r?.titulo?.trim()).slice(0, 2);

  const [completadas, setCompletadas] = useState<Record<number, boolean>>({});

  // Sin la serie de la API se cae al historial corto, que alcanza para la
  // última semana.
  const puntosScore = useMemo<ScorePunto[]>(
    () =>
      scoreHistory ??
      briefingHistory
        .filter((b) => typeof b.score === "number" && b.briefing_date)
        .map((b) => ({ fecha: b.briefing_date!, score: b.score! }))
        .reverse(),
    [scoreHistory, briefingHistory],
  );

  /*
   * Qué se grafica.
   *
   * El score de cada día rearmado desde los indicadores —el del negocio y el
   * personal, cada uno por separado— es el que se mueve con los datos. El del
   * briefing queda solo como último recurso: para casi todas las cuentas es un
   * 0 de relleno (ver `lib/kpi/scoreDiario.ts`).
   */
  const fuentesScore = useMemo<FuenteScore[]>(() => {
    const fuentes: FuenteScore[] = [];
    if (scoreSeries?.negocio.length) {
      fuentes.push({ clave: "negocio", label: "Negocio", puntos: scoreSeries.negocio, unidad: "día" });
    }
    if (scoreSeries?.personal.length) {
      fuentes.push({ clave: "personal", label: "Personal", puntos: scoreSeries.personal, unidad: "día" });
    }
    if (fuentes.length === 0) {
      fuentes.push({ clave: "briefing", label: "Briefing", puntos: puntosScore, unidad: "briefing" });
    }
    return fuentes;
  }, [scoreSeries, puntosScore]);

  // La tarjeta de arriba muestra el último punto de la misma serie que abre el
  // gráfico, para que los dos números no se contradigan.
  const ultimoScore = fuentesScore[0].puntos.length
    ? [...fuentesScore[0].puntos].sort((a, b) => (a.fecha < b.fecha ? -1 : 1)).at(-1)!.score
    : (briefing.score ?? 0);

  return (
    <div className="view" id="view-dashboard">
      <div className="page page-in">
        <div className="page-header">
          <div className="page-eyebrow">Dashboard</div>
          <div className="page-title">Centro de control</div>
          <div className="page-sub">Métricas, prioridades y recomendaciones en un solo lugar.</div>
        </div>

        {/* El bloque financiero PERSONAL —"¿estoy bien?", la trayectoria del
            saldo, en qué se fue, las deudas y el informe— se fue a Personal.

            Estaba acá arriba por una buena razón: la doctrina pide contestar
            "¿estoy bien?" antes que cualquier métrica. Pero desde la v136 la
            plata de la persona y la del negocio están separadas de verdad —dos
            ámbitos, dos paneles, filas que no se suman entre sí— y dejar el
            panel personal encima de los indicadores del negocio reponía en la
            pantalla exactamente la mezcla que se acababa de deshacer en la
            base.

            El efecto secundario era peor de lo que parece: Personal quedaba
            siendo un campo de texto y una lista, porque todo lo que le daba
            sentido estaba en esta pantalla. Quien entraba a ver cómo estaba se
            encontraba con un formulario.

            La regla no cambió, cambió dónde se aplica: en Personal, "¿estoy
            bien?" sigue yendo arriba de todo. Acá manda la pregunta del
            negocio.

            Y la LECTURA va antes que los números: los indicadores son el
            material, los hallazgos son la conclusión. Un panel con veinte
            cifras y ninguna conclusión le deja el trabajo de analista al
            empresario. */}
        <Hallazgos />
        <PanelIndicadores />

        <div className="kpi-grid">
          <div className="kpi-card" style={{ animationDelay: ".04s" }}>
            <div className="l">EOS Score</div>
            <div className="v">{ultimoScore}</div>
            <div className={`d ${ultimoScore >= 50 ? "up" : "warn"}`}>
              {ultimoScore >= 50 ? <TrendingUp size={13} /> : <TrendingDown size={13} />}
              sobre 100
            </div>
          </div>
          <div className="kpi-card" style={{ animationDelay: ".09s" }}>
            <div className="l">Objetivos activos</div>
            <div className="v">{fuentes.objetivos_activos ?? 0}</div>
            <div className="d">&nbsp;</div>
          </div>
          <div className="kpi-card" style={{ animationDelay: ".14s" }}>
            <div className="l">Progreso promedio</div>
            <div className="v">{fuentes.progreso_promedio ?? 0}%</div>
            <div className="d">&nbsp;</div>
          </div>
          <div className="kpi-card" style={{ animationDelay: ".19s" }}>
            <div className="l">Tareas pendientes</div>
            <div className="v">{fuentes.tareas_pendientes ?? 0}</div>
            <div className={`d ${(fuentes.acciones_con_error ?? 0) > 0 ? "warn" : ""}`}>
              {(fuentes.acciones_con_error ?? 0) > 0 ? `⚠ ${fuentes.acciones_con_error} con error` : ""}
            </div>
          </div>
        </div>

        <EvolucionScore fuentes={fuentesScore} />

        <div className="card">
          <div className="card-title">Prioridades de hoy</div>
          <div className="card-sub">{prioridades.length} del briefing de EOS</div>
          {prioridades.length === 0 ? (
            <p className="empty-note">Todavía no hay prioridades generadas.</p>
          ) : (
            <div className="priority-list">
              {prioridades.map((texto, i) => (
                <div className="priority-item" key={i}>
                  <button
                    type="button"
                    className={`p-check ${completadas[i] ? "done" : ""}`}
                    onClick={() => setCompletadas((actual) => ({ ...actual, [i]: !actual[i] }))}
                    aria-label={completadas[i] ? "Marcar como pendiente" : "Marcar como completada"}
                  >
                    {completadas[i] && <Check size={12} />}
                  </button>
                  <div className="p-text">{texto}</div>
                  <div className={`p-tag ${i === 0 ? "alta" : i === 1 ? "media" : "baja"}`}>
                    {i === 0 ? "Alta" : i === 1 ? "Media" : "Normal"}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card">
          <div className="card-title">Recomendaciones de EOS</div>
          <div className="card-sub">Basadas en tu actividad reciente</div>

          <div className="reco">
            <div className="ric">
              <Lightbulb size={16} />
            </div>
            <div>
              <div className="rt">{briefing.recomendacion_principal}</div>
              <div className="rs">
                {totalConversations} conversaciones · {totalMessages} mensajes intercambiados con EOS.
              </div>
              <button type="button" className="reco-btn" onClick={onOpenChat}>
                <Target size={12} style={{ display: "inline", marginRight: 4, verticalAlign: -2 }} />
                Conversar con EOS
              </button>
            </div>
          </div>

          {riesgos.map((riesgo, i) => (
            <div className="reco" key={`riesgo-${i}`}>
              <div className="ric" style={{ background: "var(--amber-light)", color: "var(--amber)" }}>
                <AlertTriangle size={16} />
              </div>
              <div>
                <div className="rt">{riesgo.titulo}</div>
                {riesgo.descripcion && <div className="rs">{riesgo.descripcion}</div>}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
