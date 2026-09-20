"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, Settings2 } from "lucide-react";

/**
 * Cómo llama esta empresa a las etapas de su embudo.
 *
 * Se puede cambiar el NOMBRE, el ORDEN, si se muestra, y qué PROBABILIDAD lleva por defecto. No se
 * pueden agregar ni quitar etapas: los indicadores, el aviso de oportunidades estancadas y el
 * paso automático a «ganada» al registrar una venta dependen de que existan estas seis. «Ganada»
 * y «perdida» son el final del camino: solo se les puede cambiar el nombre.
 *
 * Una etapa oculta que todavía tiene oportunidades sigue apareciendo: ocultarla no las borra, y
 * un embudo donde desaparecen tarjetas es peor que uno con una columna de más.
 */

export type EtapaCfg = {
  clave: string;
  etiqueta: string;
  orden: number;
  visible: boolean;
  /** De 0 a 1. */
  probabilidad: number;
  personalizada: boolean;
};

const FINALES = new Set(["ganada", "perdida"]);

export default function ConfigurarEtapas({ etapas, onGuardado }: { etapas: EtapaCfg[]; onGuardado: () => void }) {
  const [abierto, setAbierto] = useState(false);
  const [filas, setFilas] = useState(() => etapas.map((e) => ({ ...e, prob: String(Math.round(e.probabilidad * 100)) })));
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");

  if (!abierto) {
    return (
      <button
        type="button"
        className="chip"
        onClick={() => {
          setFilas(etapas.map((e) => ({ ...e, prob: String(Math.round(e.probabilidad * 100)) })));
          setError("");
          setAbierto(true);
        }}
      >
        <Settings2 size={12} /> Configurar etapas
      </button>
    );
  }

  const mover = (i: number, d: -1 | 1) =>
    setFilas((prev) => {
      const j = i + d;
      // Las finales quedan siempre al final: no se mueven ni se les pasa por encima.
      if (j < 0 || j >= prev.length || FINALES.has(prev[i].clave) || FINALES.has(prev[j].clave)) return prev;
      const copia = [...prev];
      [copia[i], copia[j]] = [copia[j], copia[i]];
      return copia;
    });

  const cambiar = (i: number, cambios: Partial<(typeof filas)[number]>) =>
    setFilas((prev) => prev.map((f, k) => (k === i ? { ...f, ...cambios } : f)));

  async function guardar() {
    if (guardando) return;
    setGuardando(true);
    setError("");

    try {
      const r = await fetch("/api/crm/etapas", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          etapas: filas.map((f, indice) => ({
            etapa: f.clave,
            etiqueta: f.etiqueta,
            orden: indice,
            visible: f.visible,
            probabilidad: FINALES.has(f.clave) || f.prob === "" ? null : Number(f.prob),
          })),
        }),
      });
      const cuerpo = await r.json().catch(() => null);
      if (!r.ok) throw new Error(cuerpo?.error || "No pudimos guardar las etapas.");
      setAbierto(false);
      onGuardado();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No pudimos guardar las etapas.");
    } finally {
      setGuardando(false);
    }
  }

  async function restablecer() {
    if (guardando) return;
    setGuardando(true);
    setError("");

    try {
      const r = await fetch("/api/crm/etapas", { method: "DELETE" });
      const cuerpo = await r.json().catch(() => null);
      if (!r.ok) throw new Error(cuerpo?.error || "No pudimos restablecer las etapas.");
      setAbierto(false);
      onGuardado();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No pudimos restablecer las etapas.");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <div className="card-title">Etapas de tu embudo</div>
      <div className="card-sub">
        Cambiá cómo se llaman, en qué orden van y qué probabilidad de cerrar tiene cada una. La
        probabilidad es la que se usa en el «esperado» cuando una oportunidad no tiene la suya.
      </div>

      <div className="neg-lista">
        {filas.map((f, i) => {
          const final = FINALES.has(f.clave);
          return (
            <div className="neg-fila" key={f.clave} style={{ flexWrap: "wrap", gap: 6 }}>
              <div style={{ display: "flex", flexDirection: "column" }}>
                <button type="button" className="chip" disabled={final} onClick={() => mover(i, -1)} aria-label={`Subir ${f.etiqueta}`}>
                  <ArrowUp size={11} />
                </button>
                <button type="button" className="chip" disabled={final} onClick={() => mover(i, 1)} aria-label={`Bajar ${f.etiqueta}`}>
                  <ArrowDown size={11} />
                </button>
              </div>

              <input
                className="neg-input"
                style={{ flex: "1 1 140px" }}
                maxLength={40}
                value={f.etiqueta}
                onChange={(e) => cambiar(i, { etiqueta: e.target.value })}
                aria-label={`Nombre de la etapa ${f.clave}`}
              />

              {final ? (
                <small style={{ flex: "0 0 auto" }}>{f.clave === "ganada" ? "100 %" : "0 %"} (fijo)</small>
              ) : (
                <>
                  <label style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 4 }}>
                    <input
                      className="neg-input neg-cantidad"
                      inputMode="numeric"
                      value={f.prob}
                      onChange={(e) => cambiar(i, { prob: e.target.value.replace(/[^\d]/g, "").slice(0, 3) })}
                      aria-label={`Probabilidad de ${f.etiqueta}`}
                    />
                    %
                  </label>
                  <label className="neg-check">
                    <input type="checkbox" checked={f.visible} onChange={(e) => cambiar(i, { visible: e.target.checked })} />
                    Mostrar
                  </label>
                </>
              )}
            </div>
          );
        })}
      </div>

      {error && <p className="neg-error" role="alert">{error}</p>}

      <div className="chip-row">
        <button type="button" className="reco-btn" disabled={guardando} onClick={guardar}>
          {guardando ? "Guardando…" : "Guardar etapas"}
        </button>
        <button type="button" className="chip" disabled={guardando} onClick={restablecer}>
          Volver a las de fábrica
        </button>
        <button type="button" className="chip" disabled={guardando} onClick={() => setAbierto(false)}>
          Cancelar
        </button>
      </div>
    </div>
  );
}
