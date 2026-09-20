"use client";

import { useState } from "react";
import { CalendarClock, CalendarDays, ChevronRight, Pencil } from "lucide-react";
import { formatearMonto } from "@/lib/finanzas/formato";
import type { Oportunidad } from "./tipos";

/**
 * Una oportunidad del embudo: se ve, se mueve de etapa y se edita en el lugar.
 *
 * Mover sigue siendo UN clic. Lo nuevo es lo que se puede decir de una oportunidad sin salir de
 * la tarjeta: qué se vende, qué probabilidad de cerrar tiene y cuándo es el próximo paso.
 *
 * PERDER PIDE EL MOTIVO. No es un trámite: es lo que EOS usa para aprender por qué se pierden
 * las ventas («se perdieron 3 de 5 por precio»). Sin motivo no hay nada que aprender, y una
 * pérdida sin motivo es una lección desperdiciada. Se elige con un toque de una lista corta, y
 * se puede escribir uno propio.
 */

const MOTIVOS = ["Precio", "Plazo", "Eligió a otro", "No contestó", "Ya no lo necesita"] as const;

type Props = {
  oportunidad: Oportunidad;
  hoy: string;
  moviendo: boolean;
  /** La etapa a la que pasa con un clic, y cómo la llama esta empresa. */
  siguiente: { clave: string; etiqueta: string };
  onMover: (etapa: string, motivo?: string) => void;
  onGuardado: () => void;
};

function formatearFecha(fecha: string) {
  const [anio, mes, dia] = fecha.split("-");
  return anio && mes && dia ? `${dia}/${mes}/${anio}` : fecha;
}

export default function TarjetaOportunidad({ oportunidad: o, hoy, moviendo, siguiente, onMover, onGuardado }: Props) {
  const [modo, setModo] = useState<"ver" | "perder" | "editar">("ver");
  const [motivo, setMotivo] = useState("");

  const abierta = o.etapa !== "ganada" && o.etapa !== "perdida";
  const vencida = abierta && Boolean(o.proxima_accion_en) && (o.proxima_accion_en as string) < hoy;

  return (
    <article className="crm-oportunidad">
      <div className="neg-fila-texto">
        <strong>{o.titulo}</strong>
        <small>
          {o.contacto?.nombre ?? "Sin cliente"}
          {o.producto_servicio ? ` · ${o.producto_servicio}` : ""}
        </small>
      </div>

      <strong className="neg-fila-monto">{formatearMonto(o.monto, o.moneda)}</strong>

      {abierta && typeof o.probabilidad === "number" && <small className="crm-fecha">{o.probabilidad} % de probabilidad</small>}

      {o.cierre_estimado && (
        <small className="crm-fecha">
          <CalendarDays size={12} /> Cierre {formatearFecha(o.cierre_estimado)}
        </small>
      )}

      {abierta && o.proxima_accion_en && (
        <small className="crm-fecha" style={vencida ? { color: "var(--danger, #b00020)", fontWeight: 600 } : undefined}>
          <CalendarClock size={12} /> Próximo paso {formatearFecha(o.proxima_accion_en)}
          {vencida ? " (vencido)" : ""}
        </small>
      )}

      {o.etapa === "perdida" && o.motivo_perdida && <small className="crm-fecha">Motivo: {o.motivo_perdida}</small>}

      {modo === "perder" && (
        <div style={{ marginTop: 6 }}>
          <small style={{ display: "block", marginBottom: 4 }}>¿Por qué se perdió? EOS aprende de esto.</small>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 6 }}>
            {MOTIVOS.map((m) => (
              <button key={m} type="button" className={`chip ${motivo === m ? "active" : ""}`} onClick={() => setMotivo(m)}>
                {m}
              </button>
            ))}
          </div>
          <input
            className="neg-input"
            style={{ width: "100%" }}
            placeholder="U otro motivo"
            maxLength={500}
            value={MOTIVOS.includes(motivo as (typeof MOTIVOS)[number]) ? "" : motivo}
            onChange={(e) => setMotivo(e.target.value)}
          />
          <div className="crm-acciones" style={{ marginTop: 6 }}>
            <button
              type="button"
              className="chip"
              disabled={moviendo || !motivo.trim()}
              onClick={() => {
                onMover("perdida", motivo.trim());
                setModo("ver");
              }}
            >
              Marcar como perdida
            </button>
            <button type="button" className="chip" onClick={() => setModo("ver")}>
              Cancelar
            </button>
          </div>
        </div>
      )}

      {modo === "editar" && <Editar oportunidad={o} onCerrar={() => setModo("ver")} onGuardado={() => { setModo("ver"); onGuardado(); }} />}

      {abierta && modo === "ver" && (
        <div className="crm-acciones">
          <button
            type="button"
            className="chip"
            disabled={moviendo}
            onClick={() => onMover(siguiente.clave)}
            title={`Pasar a ${siguiente.etiqueta}`}
          >
            {siguiente.etiqueta}
            <ChevronRight size={12} style={{ verticalAlign: -2 }} />
          </button>
          <button type="button" className="chip" onClick={() => setModo("perder")}>
            Perdida
          </button>
          <button type="button" className="chip" onClick={() => setModo("editar")} aria-label={`Editar ${o.titulo}`}>
            <Pencil size={11} />
          </button>
        </div>
      )}
    </article>
  );
}

function Editar({ oportunidad: o, onCerrar, onGuardado }: { oportunidad: Oportunidad; onCerrar: () => void; onGuardado: () => void }) {
  const [producto, setProducto] = useState(o.producto_servicio ?? "");
  const [probabilidad, setProbabilidad] = useState(typeof o.probabilidad === "number" ? String(o.probabilidad) : "");
  const [proximo, setProximo] = useState(o.proxima_accion_en ?? "");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");

  async function guardar() {
    if (guardando) return;
    setGuardando(true);
    setError("");

    try {
      const r = await fetch("/api/crm/oportunidades", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        // Vacío = «sin estimar» / «sin fecha»: el servidor lo entiende como quitar el dato.
        body: JSON.stringify({ id: o.id, producto_servicio: producto, probabilidad: probabilidad === "" ? null : Number(probabilidad), proxima_accion_en: proximo || null }),
      });
      const cuerpo = await r.json().catch(() => null);
      if (!r.ok) throw new Error(cuerpo?.error || "No se pudo guardar.");
      onGuardado();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar.");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div style={{ marginTop: 6, display: "grid", gap: 6 }}>
      <input className="neg-input" placeholder="Qué se le vende" maxLength={200} value={producto} onChange={(e) => setProducto(e.target.value)} />
      <input
        className="neg-input"
        placeholder="Probabilidad de cerrar (0 a 100, vacío = sin estimar)"
        inputMode="numeric"
        value={probabilidad}
        onChange={(e) => setProbabilidad(e.target.value.replace(/[^\d]/g, "").slice(0, 3))}
      />
      <label style={{ fontSize: 12 }}>
        Próximo paso
        <input className="neg-input" type="date" value={proximo} onChange={(e) => setProximo(e.target.value)} style={{ display: "block", width: "100%" }} />
      </label>
      {error && <p className="neg-error" role="alert">{error}</p>}
      <div className="crm-acciones">
        <button type="button" className="chip" disabled={guardando} onClick={guardar}>
          {guardando ? "Guardando…" : "Guardar"}
        </button>
        <button type="button" className="chip" onClick={onCerrar}>
          Cancelar
        </button>
      </div>
    </div>
  );
}
