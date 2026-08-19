"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, FileText, Loader2 } from "lucide-react";

type Candidato = {
  finding_id: string;
  document_id: string;
  tipo: "ingreso" | "gasto" | "compromiso";
  monto: number;
  moneda: "PYG" | "USD";
  descripcion: string;
  fecha: string | null;
  confianza: number;
};

const ETIQUETA: Record<Candidato["tipo"], string> = {
  ingreso: "Ingreso",
  gasto: "Gasto",
  compromiso: "Compromiso",
};

/**
 * Movimientos que EOS detectó solo en los documentos del usuario.
 *
 * Se confirman antes de impactar el disponible real: un importe mal leído
 * arruinaría el número que el usuario usa para decidir. EOS hace todo el
 * trabajo; el usuario solo revisa.
 */
export default function FinanzasCandidatos({ onImportado }: { onImportado: () => void }) {
  const [candidatos, setCandidatos] = useState<Candidato[] | null>(null);
  const [elegidos, setElegidos] = useState<Record<string, boolean>>({});
  const [tipos, setTipos] = useState<Record<string, Candidato["tipo"]>>({});
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");

  const cargar = useCallback(() => {
    return fetch("/api/finanzas/movimientos", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("fallo"))))
      .then((payload) => {
        const lista: Candidato[] = payload.candidatos ?? [];
        setCandidatos(lista);
        // Pre-seleccionamos solo los de confianza alta: los dudosos requieren
        // una decisión explícita del usuario.
        setElegidos(Object.fromEntries(lista.map((c) => [c.finding_id, c.confianza >= 0.7])));
        setTipos(Object.fromEntries(lista.map((c) => [c.finding_id, c.tipo])));
      })
      .catch(() => setCandidatos([]));
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  if (candidatos === null || candidatos.length === 0) return null;

  const seleccionados = candidatos.filter((c) => elegidos[c.finding_id]);

  async function confirmar() {
    if (seleccionados.length === 0) return;

    setGuardando(true);
    setError("");

    try {
      const respuesta = await fetch("/api/finanzas/movimientos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          movimientos: seleccionados.map((c) => ({ ...c, tipo: tipos[c.finding_id] ?? c.tipo })),
        }),
      });

      const payload = await respuesta.json().catch(() => null);
      if (!respuesta.ok) throw new Error(payload?.error || "No pudimos guardar los movimientos.");

      await cargar();
      onImportado();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No pudimos guardar los movimientos.");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="card fin-card">
      <div className="card-title">
        <FileText size={14} style={{ display: "inline", marginRight: 6, verticalAlign: -2 }} />
        EOS detectó movimientos en tus documentos
      </div>
      <div className="card-sub">
        Revisá y confirmá. Solo los que marques van a afectar tu disponible real.
      </div>

      <div className="fin-cand-lista">
        {candidatos.map((c) => {
          const marcado = Boolean(elegidos[c.finding_id]);
          const dudoso = c.confianza < 0.7;

          return (
            <div key={c.finding_id} className={`fin-cand ${marcado ? "is-on" : ""}`}>
              <button
                type="button"
                className={`p-check ${marcado ? "done" : ""}`}
                onClick={() => setElegidos((prev) => ({ ...prev, [c.finding_id]: !prev[c.finding_id] }))}
                aria-label={marcado ? "No importar" : "Importar"}
              >
                {marcado && <Check size={12} />}
              </button>

              <div className="fin-cand-cuerpo">
                <div className="fin-cand-top">
                  <span className="fin-cand-monto">{formatear(c.monto, c.moneda)}</span>
                  <select
                    className="fin-cand-tipo"
                    value={tipos[c.finding_id] ?? c.tipo}
                    onChange={(e) =>
                      setTipos((prev) => ({ ...prev, [c.finding_id]: e.target.value as Candidato["tipo"] }))
                    }
                  >
                    {(Object.keys(ETIQUETA) as Candidato["tipo"][]).map((t) => (
                      <option key={t} value={t}>
                        {ETIQUETA[t]}
                      </option>
                    ))}
                  </select>
                  {dudoso && <span className="fin-cand-dudoso">Revisar</span>}
                </div>
                <div className="fin-cand-desc">{c.descripcion}</div>
                {c.fecha && <div className="fin-cand-fecha">{c.fecha}</div>}
              </div>
            </div>
          );
        })}
      </div>

      {error && <p className="fin-setup-error">{error}</p>}

      <button
        type="button"
        className="reco-btn"
        style={{ marginTop: 14 }}
        onClick={() => void confirmar()}
        disabled={guardando || seleccionados.length === 0}
      >
        {guardando ? (
          <>
            <Loader2 size={12} className="fin-spin" style={{ display: "inline", marginRight: 6, verticalAlign: -2 }} />
            Guardando…
          </>
        ) : (
          `Confirmar ${seleccionados.length} movimiento${seleccionados.length === 1 ? "" : "s"}`
        )}
      </button>
    </div>
  );
}

function formatear(valor: number, moneda: string) {
  const simbolo = moneda === "USD" ? "US$" : "₲";
  return `${simbolo} ${new Intl.NumberFormat("es-PY", { maximumFractionDigits: 0 }).format(Math.round(valor))}`;
}
