"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Plus, Repeat, X } from "lucide-react";
import { formatearMonto } from "@/lib/finanzas/formato";
import { simboloDe } from "@/lib/finanzas/monedas";

type Fijo = {
  tipo: "ingreso" | "gasto";
  descripcion: string;
  monto: string;
  dia_del_mes: string;
};

const VACIO: Fijo = { tipo: "gasto", descripcion: "", monto: "", dia_del_mes: "" };

/**
 * Declaración única de ingresos y gastos fijos.
 *
 * Existe porque el detector de recurrencia necesita ver un movimiento dos
 * veces, y para el alquiler eso son dos meses en los que el panel no sirve.
 *
 * El texto insiste en que es UNA vez y en que después la realidad lo corrige
 * sola, porque de otro modo se leería como "cargá todos tus gastos" — que es
 * exactamente lo que EOS promete no pedir.
 */
export default function FinanzasFijos({
  moneda,
  confirmados,
  onGuardado,
}: {
  moneda: string;
  confirmados: number;
  onGuardado: () => void;
}) {
  const [fijos, setFijos] = useState<Fijo[] | null>(null);
  const [editando, setEditando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");

  const cargar = useCallback(() => {
    return fetch("/api/finanzas/fijos", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("fallo"))))
      .then((payload) => {
        const lista: Fijo[] = (payload.fijos ?? []).map(
          (f: { tipo: string; descripcion: string; monto: number; dia_del_mes: number }) => ({
            tipo: f.tipo === "ingreso" ? "ingreso" : "gasto",
            descripcion: f.descripcion,
            monto: String(f.monto),
            dia_del_mes: String(f.dia_del_mes),
          }),
        );
        setFijos(lista);
      })
      .catch(() => setFijos([]));
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  if (fijos === null) return null;

  const simbolo = simboloDe(moneda);

  async function guardar() {
    setGuardando(true);
    setError("");

    try {
      const res = await fetch("/api/finanzas/fijos", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fijos: (fijos ?? []).map((f) => ({
            tipo: f.tipo,
            descripcion: f.descripcion,
            monto: Number(f.monto.replace(/[^\d,.-]/g, "").replace(",", ".")),
            dia_del_mes: Number(f.dia_del_mes),
          })),
        }),
      });

      if (!res.ok) throw new Error("fallo");

      setEditando(false);
      await cargar();
      onGuardado();
    } catch {
      setError("No pudimos guardarlo. Probá de nuevo.");
    } finally {
      setGuardando(false);
    }
  }

  const actualizar = (i: number, campo: keyof Fijo, valor: string) =>
    setFijos((prev) => (prev ?? []).map((f, j) => (j === i ? { ...f, [campo]: valor } : f)));

  /* ---------- vista compacta ---------- */
  if (!editando) {
    return (
      <div className="card fin-card">
        <div className="fin-head">
          <span className="fin-badge fin-badge-neutral">
            <Repeat size={14} />
            INGRESOS Y GASTOS FIJOS
          </span>
        </div>

        {fijos.length === 0 ? (
          <p className="prose" style={{ marginTop: 10 }}>
            EOS aprende tus gastos fijos viéndolos repetirse, pero eso tarda un par de meses.
            Decíselos una vez y el panel te sirve desde hoy. Después, cuando lleguen por correo,
            EOS corrige solo los importes.
          </p>
        ) : (
          <>
            <div className="fin-rows" style={{ marginTop: 4 }}>
              {fijos.map((f, i) => (
                <div className="fin-row" key={`${f.descripcion}-${i}`}>
                  <span className="fin-row-label">
                    {f.descripcion} · día {f.dia_del_mes}
                  </span>
                  <span className={`fin-row-value ${f.tipo === "ingreso" ? "is-ok" : ""}`}>
                    {f.tipo === "ingreso" ? "+" : "−"} {formatearMonto(Number(f.monto) || 0, moneda)}
                  </span>
                </div>
              ))}
            </div>
            {confirmados > 0 && (
              <p className="prose" style={{ marginTop: 10, fontSize: 13, opacity: 0.75 }}>
                <Check size={12} style={{ display: "inline", marginRight: 4, verticalAlign: -1 }} />
                {confirmados === 1
                  ? "EOS ya está viendo uno de estos llegar por correo y usa el importe real."
                  : `EOS ya está viendo ${confirmados} de estos llegar por correo y usa los importes reales.`}
              </p>
            )}
          </>
        )}

        <button
          type="button"
          className="chip"
          style={{ marginTop: 12, cursor: "pointer" }}
          onClick={() => {
            setEditando(true);
            if (fijos.length === 0) setFijos([{ ...VACIO }]);
          }}
        >
          {fijos.length === 0 ? "Decirle a EOS" : "Editar"}
        </button>
      </div>
    );
  }

  /* ---------- editor ---------- */
  return (
    <div className="card fin-card">
      <div className="fin-head">
        <span className="fin-badge fin-badge-neutral">
          <Repeat size={14} />
          INGRESOS Y GASTOS FIJOS
        </span>
      </div>

      <p className="prose" style={{ marginTop: 10, fontSize: 13, opacity: 0.8 }}>
        Solo lo que se repite todos los meses: sueldo, alquiler, cuotas, colegio. Los gastos del
        día a día no van acá — esos EOS los ve solo.
      </p>

      <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
        {fijos.map((f, i) => (
          <div key={i} style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            <select
              value={f.tipo}
              onChange={(e) => actualizar(i, "tipo", e.target.value)}
              style={campo(80)}
            >
              <option value="gasto">Gasto</option>
              <option value="ingreso">Ingreso</option>
            </select>
            <input
              type="text"
              value={f.descripcion}
              onChange={(e) => actualizar(i, "descripcion", e.target.value)}
              placeholder="Alquiler"
              style={{ ...campo(0), flex: 2, minWidth: 110 }}
            />
            <input
              type="text"
              inputMode="numeric"
              value={f.monto}
              onChange={(e) => actualizar(i, "monto", e.target.value)}
              placeholder={simbolo}
              style={{ ...campo(0), flex: 1, minWidth: 90 }}
            />
            <input
              type="text"
              inputMode="numeric"
              value={f.dia_del_mes}
              onChange={(e) => actualizar(i, "dia_del_mes", e.target.value)}
              placeholder="día"
              style={campo(58)}
            />
            <button
              type="button"
              onClick={() => setFijos((prev) => (prev ?? []).filter((_, j) => j !== i))}
              aria-label="Quitar"
              style={{ background: "none", border: "none", cursor: "pointer", opacity: 0.5 }}
            >
              <X size={15} />
            </button>
          </div>
        ))}
      </div>

      <button
        type="button"
        className="chip"
        style={{ marginTop: 10, cursor: "pointer" }}
        onClick={() => setFijos((prev) => [...(prev ?? []), { ...VACIO }])}
      >
        <Plus size={12} /> Agregar
      </button>

      {error && (
        <p className="prose" style={{ marginTop: 10, color: "var(--amber)" }}>
          {error}
        </p>
      )}

      <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
        <button
          type="button"
          className="reco-btn"
          onClick={() => {
            setEditando(false);
            void cargar();
          }}
          disabled={guardando}
        >
          Cancelar
        </button>
        <button
          type="button"
          className="chip"
          onClick={() => void guardar()}
          disabled={guardando}
          style={{ cursor: guardando ? "wait" : "pointer" }}
        >
          {guardando ? "Guardando…" : "Guardar"}
        </button>
      </div>
    </div>
  );
}

function campo(ancho: number) {
  return {
    padding: "9px 10px",
    borderRadius: 8,
    border: "1px solid var(--border, #e2e8f0)",
    fontSize: 14,
    ...(ancho ? { width: ancho } : {}),
  } as const;
}
