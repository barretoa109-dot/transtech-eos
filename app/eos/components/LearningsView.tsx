"use client";

import { BrainCircuit, RefreshCw, TrendingDown, TrendingUp } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

type Learning = {
  id: string;
  categoria: string;
  patron: string;
  recomendacion: string;
  /** Lo que EOS había escrito antes de que el usuario lo corrigiera. */
  recomendacion_original: string | null;
  tendencia: "positiva" | "neutral" | "negativa" | "mixta";
  confianza: number;
  evidence_count: number;
  positive_count: number;
  negative_count: number;
  last_observed_at: string | null;
  estado: "activo" | "descartado" | "en_revision";
  corregido_en: string | null;
  descartado_en: string | null;
  descartado_motivo: string | null;
};

type Accion = "corregir" | "descartar" | "restaurar" | "eliminar";

type Summary = {
  evidence_count: number;
  positive_count: number;
  negative_count: number;
  neutral_count: number;
  evidence_type_count: number;
  eligible: boolean;
  active_learnings: number;
  average_confidence: number | null;
  latest_learning_at: string | null;
};

const emptySummary: Summary = {
  evidence_count: 0,
  positive_count: 0,
  negative_count: 0,
  neutral_count: 0,
  evidence_type_count: 0,
  eligible: false,
  active_learnings: 0,
  average_confidence: null,
  latest_learning_at: null,
};

function trendIcon(tendencia: Learning["tendencia"]) {
  if (tendencia === "positiva") return <TrendingUp size={17} />;
  if (tendencia === "negativa") return <TrendingDown size={17} />;
  return <BrainCircuit size={17} />;
}

export default function LearningsView() {
  const [summary, setSummary] = useState<Summary>(emptySummary);
  const [learnings, setLearnings] = useState<Learning[]>([]);
  const [minimumEvidence, setMinimumEvidence] = useState(3);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  /** Cuál se está corrigiendo, y con qué texto. */
  const [corrigiendo, setCorrigiendo] = useState<string | null>(null);
  const [borrador, setBorrador] = useState("");
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [verDescartados, setVerDescartados] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const response = await fetch("/api/learnings", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error);
      setSummary(payload.summary ?? emptySummary);
      setLearnings(payload.learnings ?? []);
      setMinimumEvidence(payload.minimum_evidence ?? 3);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "No pudimos cargar los aprendizajes.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timeout);
  }, [load]);

  /**
   * Eliminar pregunta; las otras tres no.
   *
   * Descartar, restaurar y corregir se deshacen con un clic, así que pedir
   * confirmación para ellas sería ruido que entrena a apretar "sí" sin leer —
   * y entonces la confirmación que SÍ importa tampoco se lee.
   */
  async function accionar(learning: Learning, accion: Accion, texto?: string) {
    if (accion === "eliminar") {
      const seguro = window.confirm(
        `Se borra "${learning.patron}" y no se puede recuperar.\n\n` +
          "Si solo querés que EOS deje de usarlo, descartalo: eso se puede deshacer.",
      );

      if (!seguro) return;
    }

    setOcupado(learning.id);
    setError("");

    try {
      const respuesta = await fetch("/api/learnings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: learning.id, accion, texto: texto ?? null }),
      });

      const payload = await respuesta.json().catch(() => null);
      if (!respuesta.ok) throw new Error(payload?.error || "No pudimos guardar el cambio.");

      setCorrigiendo(null);
      setBorrador("");
      await load();
    } catch (fallo) {
      setError(fallo instanceof Error ? fallo.message : "No pudimos guardar el cambio.");
    } finally {
      setOcupado(null);
    }
  }

  const activos = learnings.filter((l) => l.estado !== "descartado");
  const descartados = learnings.filter((l) => l.estado === "descartado");

  const progress = Math.min(100, Math.round((summary.evidence_count / minimumEvidence) * 100));

  return (
    <div className="view" id="view-aprendizajes">
      <div className="page page-in">
        <div className="page-header">
          <div className="page-eyebrow">Aprendizajes</div>
          <div className="page-title">Patrones comprobados</div>
          <div className="page-sub">Lo que EOS fue detectando sobre tu negocio a partir de los datos reales.</div>
        </div>

        <div className="chip-row">
          <button
            type="button"
            className="chip"
            onClick={() => void load()}
            disabled={loading}
            style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
          >
            <RefreshCw size={12} className={loading ? "learn-spin" : ""} />
            {loading ? "Actualizando…" : "Actualizar"}
          </button>
        </div>

        <div className="kpi-grid">
          <div className="kpi-card">
            <div className="l">Patrones aprendidos</div>
            <div className="v">{summary.active_learnings}</div>
          </div>
          <div className="kpi-card">
            <div className="l">Evidencias válidas</div>
            <div className="v">{summary.evidence_count}</div>
          </div>
          <div className="kpi-card">
            <div className="l">Confianza media</div>
            <div className="v">{formatConfidence(summary.average_confidence)}</div>
          </div>
          <div className="kpi-card">
            <div className="l">Tipos de evidencia</div>
            <div className="v">{summary.evidence_type_count}</div>
          </div>
        </div>

        {error && (
          <div className="card" style={{ borderColor: "var(--red)", color: "var(--red)" }}>
            {error}
          </div>
        )}

        {!loading && !summary.eligible && (
          <div className="card">
            <div className="card-title">Recopilando evidencia</div>
            <p className="prose">
              EOS todavía no tiene resultados suficientes para aprender. Necesita al menos {minimumEvidence} resultados
              verificables — actualmente hay {summary.evidence_count}. Las decisiones sin resultado no se usan para
              inferir patrones.
            </p>
            <div className="usage-bar" style={{ marginTop: 14 }}>
              <div className="usage-fill" style={{ width: `${progress}%` }} />
            </div>
            <div className="usage-text">
              {summary.evidence_count} de {minimumEvidence} evidencias mínimas
            </div>
          </div>
        )}

        {activos.length > 0 && (
          <div className="pattern-grid">
            {activos.map((learning) => (
              <Patron
                key={learning.id}
                learning={learning}
                ocupado={ocupado === learning.id}
                corrigiendo={corrigiendo === learning.id}
                borrador={borrador}
                onBorrador={setBorrador}
                onCorregir={() => {
                  setCorrigiendo(learning.id);
                  setBorrador(learning.recomendacion ?? "");
                }}
                onCancelar={() => {
                  setCorrigiendo(null);
                  setBorrador("");
                }}
                onAccion={(accion, texto) => void accionar(learning, accion, texto)}
              />
            ))}
          </div>
        )}

        {/*
          Los descartados no desaparecen: quedan acá, plegados. Descartar sin
          poder deshacer no es una opción, es un borrado disfrazado.
        */}
        {descartados.length > 0 && (
          <div className="card" style={{ marginTop: 16 }}>
            <button
              type="button"
              className="chip"
              onClick={() => setVerDescartados((v) => !v)}
            >
              {verDescartados ? "Ocultar" : "Ver"} los {descartados.length} que descartaste
            </button>

            {verDescartados && (
              <div className="pattern-grid" style={{ marginTop: 14 }}>
                {descartados.map((learning) => (
                  <Patron
                    key={learning.id}
                    learning={learning}
                    ocupado={ocupado === learning.id}
                    corrigiendo={false}
                    borrador=""
                    onBorrador={() => {}}
                    onCorregir={() => {}}
                    onCancelar={() => {}}
                    onAccion={(accion, texto) => void accionar(learning, accion, texto)}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <style jsx>{`
        .learn-spin {
          animation: spin 800ms linear infinite;
        }
        @keyframes spin {
          to {
            transform: rotate(360deg);
          }
        }
      `}</style>
    </div>
  );
}

/**
 * Un patrón, con lo que EOS concluyó y qué puede hacer el usuario al respecto.
 *
 * La recomendación se muestra —antes no se mostraba, solo el patrón— porque es
 * la parte que EOS efectivamente usa al contestar. Discutir una conclusión que
 * no se ve es imposible.
 */
function Patron({
  learning,
  ocupado,
  corrigiendo,
  borrador,
  onBorrador,
  onCorregir,
  onCancelar,
  onAccion,
}: {
  learning: Learning;
  ocupado: boolean;
  corrigiendo: boolean;
  borrador: string;
  onBorrador: (texto: string) => void;
  onCorregir: () => void;
  onCancelar: () => void;
  onAccion: (accion: Accion, texto?: string) => void;
}) {
  const descartado = learning.estado === "descartado";
  const confianza = Math.round(Number(learning.confianza) * 100);

  return (
    <div className={`pattern-card${descartado ? " pattern-card-descartado" : ""}`}>
      <div className="pattern-ic">{trendIcon(learning.tendencia)}</div>
      <div className="pattern-title">{learning.patron}</div>

      {learning.recomendacion && !corrigiendo && (
        <p className="pattern-reco">
          {learning.recomendacion}
          {learning.corregido_en && (
            <span className="pattern-corregido"> · lo corregiste vos</span>
          )}
        </p>
      )}

      {corrigiendo && (
        <div className="pattern-editor">
          <label htmlFor={`corregir-${learning.id}`}>
            Escribilo como tendría que decirlo EOS
          </label>
          <textarea
            id={`corregir-${learning.id}`}
            value={borrador}
            onChange={(e) => onBorrador(e.target.value)}
            rows={3}
            maxLength={1000}
          />
          <div className="chip-row">
            <button
              type="button"
              className="reco-btn"
              disabled={ocupado || borrador.trim().length === 0}
              onClick={() => onAccion("corregir", borrador)}
            >
              {ocupado ? "Guardando…" : "Guardar"}
            </button>
            <button type="button" className="chip" onClick={onCancelar} disabled={ocupado}>
              Cancelar
            </button>
          </div>
        </div>
      )}

      <div className="conf-row">
        <span className="conf-label">{confianza}% confianza</span>
        <div className="conf-bar">
          <div className="conf-fill" style={{ width: `${confianza}%` }} />
        </div>
      </div>

      <div className="pattern-meta">
        {learning.evidence_count} evidencias ({learning.positive_count} positivas ·{" "}
        {learning.negative_count} negativas)
        {learning.last_observed_at ? ` · Observado ${formatDate(learning.last_observed_at)}` : ""}
      </div>

      {descartado ? (
        <div className="chip-row pattern-acciones">
          <span className="pattern-meta">
            Descartado{learning.descartado_en ? ` el ${formatDate(learning.descartado_en)}` : ""}
            {learning.descartado_motivo ? ` · ${learning.descartado_motivo}` : ""}
          </span>
          <button
            type="button"
            className="chip"
            disabled={ocupado}
            onClick={() => onAccion("restaurar")}
          >
            Volver a usarlo
          </button>
          <button
            type="button"
            className="chip pattern-eliminar"
            disabled={ocupado}
            onClick={() => onAccion("eliminar")}
          >
            Eliminar
          </button>
        </div>
      ) : (
        !corrigiendo && (
          <div className="chip-row pattern-acciones">
            <button type="button" className="chip" disabled={ocupado} onClick={onCorregir}>
              No es así
            </button>
            <button
              type="button"
              className="chip"
              disabled={ocupado}
              onClick={() => onAccion("descartar")}
            >
              Ya no me representa
            </button>
          </div>
        )
      )}
    </div>
  );
}

function formatConfidence(value: number | null) {
  return value === null ? "—" : `${Math.round(Number(value) * 100)}%`;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("es-PY", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(value));
}
