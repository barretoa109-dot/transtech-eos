"use client";

import { useState } from "react";
import { Check, Wallet } from "lucide-react";

type Props = {
  moneda: string;
  saldoCalculado: number;
  vecesConciliado: number;
  onListo: () => void;
};

/**
 * Le pide al usuario el único dato que EOS no puede conseguir solo.
 *
 * Todo el diseño de este componente responde a una regla: la honestidad sobre
 * lo que EOS no sabe NO puede convertirse en tarea para el usuario. Si EOS
 * dijera "faltan datos, cargalos", le devolvió el problema y rompió la
 * promesa del producto.
 *
 * Por eso:
 *  - Pide UN número, no una lista de movimientos.
 *  - Dice explícitamente que va a dejar de preguntar. Es una promesa que el
 *    cálculo cumple: con dos datos aprende el ritmo y se arregla solo.
 *  - No aparece nunca si EOS ya aprendió. El componente sabe callarse.
 *  - No hay alarma, ni rojo, ni "atención": es una conversación, no un error.
 */
export default function FinanzasConciliar({
  moneda,
  saldoCalculado,
  vecesConciliado,
  onListo,
}: Props) {
  const [valor, setValor] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  const [listo, setListo] = useState(false);

  if (listo) {
    return (
      <div className="card fin-card">
        <p className="prose">
          <Check size={14} style={{ display: "inline", marginRight: 6, verticalAlign: -2 }} />
          {vecesConciliado === 0
            ? "Listo, ajusté el cálculo. Una vez más en unos días y ya no necesito preguntarte."
            : "Listo. Ya aprendí tu ritmo: de acá en más lo descuento solo."}
        </p>
      </div>
    );
  }

  async function guardar() {
    const limpio = valor.replace(/[^\d,-]/g, "").replace(",", ".");
    const monto = Number(limpio);

    if (!Number.isFinite(monto) || limpio === "") {
      setError("Escribí el monto en números.");
      return;
    }

    setGuardando(true);
    setError("");

    try {
      const res = await fetch("/api/finanzas/conciliar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ saldo: monto, saldo_calculado: saldoCalculado }),
      });

      if (!res.ok) throw new Error("fallo");

      setListo(true);
      onListo();
    } catch {
      setError("No pudimos guardarlo. Probá de nuevo.");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="card fin-card">
      <div className="fin-head">
        <span className="fin-badge fin-badge-neutral">
          <Wallet size={14} />
          AJUSTAR CON LA REALIDAD
        </span>
      </div>

      <p className="prose" style={{ marginTop: 10 }}>
        {vecesConciliado === 0 ? (
          <>
            EOS no ve los pagos con billetera ni el efectivo. Decime una sola vez cuánto tenés de
            verdad y ajusto todo el cálculo.
          </>
        ) : (
          <>
            Una vez más y listo: con este segundo dato aprendo cuánto se te va en pagos que no veo, y
            de ahí en adelante lo descuento solo.
          </>
        )}
      </p>

      <div style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "center" }}>
        <span style={{ fontSize: 15, opacity: 0.7 }}>{moneda === "PYG" ? "₲" : "US$"}</span>
        <input
          type="text"
          inputMode="numeric"
          value={valor}
          onChange={(e) => setValor(e.target.value)}
          placeholder="Lo que tenés hoy"
          style={{
            flex: 1,
            padding: "10px 12px",
            borderRadius: 9,
            border: "1px solid var(--border, #e2e8f0)",
            fontSize: 15,
          }}
        />
        <button
          type="button"
          className="chip"
          onClick={() => void guardar()}
          disabled={guardando || valor.trim() === ""}
          style={{ cursor: guardando ? "wait" : "pointer" }}
        >
          {guardando ? "Guardando…" : "Listo"}
        </button>
      </div>

      <p className="prose" style={{ marginTop: 10, fontSize: 13, opacity: 0.7 }}>
        No hace falta que sea exacto al guaraní. Con el saldo de tu cuenta principal alcanza.
      </p>

      {error && (
        <p className="prose" style={{ marginTop: 8, color: "var(--amber)" }}>
          {error}
        </p>
      )}
    </div>
  );
}
