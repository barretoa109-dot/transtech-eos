"use client";

import { useState } from "react";
import { Check, Wallet } from "lucide-react";

type Props = {
  moneda: string;
  saldoCalculado: number;
  vecesConciliado: number;
  onListo: () => void;
  /**
   * Versión angosta, para vivir adentro de `.fin-aviso-compacto` en Inicio,
   * al lado del aviso de "calculado desde tus cuentas" — las dos cosas le
   * piden algo parecido a la persona (un dato o una decisión) y antes eran
   * dos tarjetas grandes separadas que decían casi lo mismo.
   */
  compacto?: boolean;
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
  compacto = false,
}: Props) {
  const [valor, setValor] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  const [listo, setListo] = useState(false);

  if (listo) {
    const texto =
      vecesConciliado === 0
        ? "Listo, ajusté el cálculo. Una vez más en unos días y ya no necesito preguntarte."
        : "Listo. Ya aprendí tu ritmo: de acá en más lo descuento solo.";

    if (compacto) {
      return (
        <p className="fin-aviso-compacto-linea">
          <Check size={14} style={{ display: "inline", marginRight: 6, verticalAlign: -2 }} />
          {texto}
        </p>
      );
    }

    return (
      <div className="card fin-card">
        <p className="prose">
          <Check size={14} style={{ display: "inline", marginRight: 6, verticalAlign: -2 }} />
          {texto}
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

  const textoPrincipal =
    vecesConciliado === 0 ? (
      <>EOS no ve los pagos con billetera ni efectivo. Decí cuánto tenés hoy y ajusto todo el cálculo.</>
    ) : (
      <>Una vez más y listo: con este segundo dato aprendo cuánto se te va en pagos que no veo.</>
    );

  const campo = (
    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
      <span style={{ fontSize: compacto ? 13 : 15, opacity: 0.7 }}>{moneda === "PYG" ? "₲" : "US$"}</span>
      <input
        type="text"
        inputMode="numeric"
        value={valor}
        onChange={(e) => setValor(e.target.value)}
        placeholder="Lo que tenés hoy"
        style={{
          flex: compacto ? "0 1 140px" : 1,
          padding: compacto ? "7px 10px" : "10px 12px",
          borderRadius: 9,
          border: "1px solid var(--border, #e2e8f0)",
          fontSize: compacto ? 13 : 15,
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
  );

  if (compacto) {
    return (
      <div className="fin-aviso-compacto-linea">
        <Wallet size={14} style={{ flexShrink: 0, opacity: 0.7 }} />
        <span style={{ flex: "1 1 220px" }}>
          <b>Ajustá con la realidad.</b> {textoPrincipal}
        </span>
        {campo}
        {error && <span style={{ color: "var(--amber)", fontSize: 12 }}>{error}</span>}
      </div>
    );
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
        {textoPrincipal}
      </p>

      <div style={{ marginTop: 12 }}>{campo}</div>

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
