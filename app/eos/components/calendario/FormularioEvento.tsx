"use client";

import { useState } from "react";

import { CATEGORIAS_PROPIAS, ETIQUETAS, type CategoriaPropia } from "@/lib/calendario/agenda";
import { ETIQUETAS_REPITE, REPETICIONES } from "@/lib/calendario/repeticion";

export type BorradorEvento = {
  id?: string;
  /**
   * Una tarea que EOS anotó desde el chat. Tiene título, fecha, hora y notas;
   * no tiene tipo, hora de fin ni contacto, así que esos campos no se ofrecen.
   */
  esTarea?: boolean;
  titulo: string;
  categoria: CategoriaPropia;
  fecha: string;
  hora_inicio: string;
  hora_fin: string;
  contacto_nombre: string;
  detalle: string;
  /** "" = no se repite; si no, uno de `REPETICIONES`. */
  repite: string;
  /** Hasta cuándo se repite ("" = sin fin). */
  repite_hasta: string;
};

const AYUDA: Record<CategoriaPropia, string> = {
  agenda: "Una cita o reunión con hora",
  recordatorio: "Algo que no querés olvidar",
  actividad: "Algo que hacés o hiciste",
  seguimiento: "Volver a hablar con alguien",
  trabajo: "Un trabajo que ya realizaste",
};

type Props = {
  inicial: BorradorEvento;
  /** Con la fecha guardada, para que el calendario se ubique en ese día. */
  onGuardado: (fecha: string) => void;
  onCancelar: () => void;
};

/**
 * Alta y edición de un evento propio.
 *
 * Un solo formulario para las dos cosas: crear y editar piden los mismos campos,
 * y mantener dos copias es la manera de que una de las dos se quede sin el campo
 * nuevo el día que se agregue.
 */
export default function FormularioEvento({ inicial, onGuardado, onCancelar }: Props) {
  const [datos, setDatos] = useState<BorradorEvento>(inicial);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");

  const editando = Boolean(inicial.id);

  function cambiar<K extends keyof BorradorEvento>(campo: K, valor: BorradorEvento[K]) {
    setDatos((d) => ({ ...d, [campo]: valor }));
  }

  async function guardar(evento: React.FormEvent) {
    evento.preventDefault();
    if (guardando) return;

    setGuardando(true);
    setError("");

    try {
      const respuesta = await fetch("/api/calendario", {
        method: editando ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: datos.id,
          titulo: datos.titulo,
          categoria: datos.categoria,
          fecha: datos.fecha,
          hora_inicio: datos.hora_inicio || null,
          hora_fin: datos.hora_fin || null,
          contacto_nombre: datos.contacto_nombre || null,
          detalle: datos.detalle || null,
          repite: datos.repite || null,
          repite_hasta: datos.repite ? datos.repite_hasta || null : null,
        }),
      });

      const resultado = await respuesta.json().catch(() => null);
      if (!respuesta.ok) throw new Error(resultado?.error || "No se pudo guardar.");

      onGuardado(datos.fecha);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar.");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <form className="card cal-form" onSubmit={guardar}>
      <div className="card-title">{editando ? "Editar evento" : "Nuevo evento"}</div>

      <div className="cal-form-grid">
        <label className="cal-campo cal-campo-ancho">
          <span>Título</span>
          <input
            className="neg-input"
            value={datos.titulo}
            maxLength={200}
            placeholder="Ej.: Reunión con el contador"
            onChange={(e) => cambiar("titulo", e.target.value)}
            autoFocus
          />
        </label>

        {!datos.esTarea && (
          <label className="cal-campo">
            <span>Tipo</span>
            <select
              className="neg-input"
              value={datos.categoria}
              onChange={(e) => cambiar("categoria", e.target.value as CategoriaPropia)}
            >
              {CATEGORIAS_PROPIAS.map((c) => (
                <option key={c} value={c}>
                  {ETIQUETAS[c]}
                </option>
              ))}
            </select>
            <small>{AYUDA[datos.categoria]}</small>
          </label>
        )}

        <label className="cal-campo">
          <span>{datos.repite ? "Primera vez" : "Fecha"}</span>
          <input
            className="neg-input"
            type="date"
            value={datos.fecha}
            onChange={(e) => cambiar("fecha", e.target.value)}
          />
        </label>

        <label className="cal-campo">
          <span>Desde</span>
          <input
            className="neg-input"
            type="time"
            value={datos.hora_inicio}
            onChange={(e) => cambiar("hora_inicio", e.target.value)}
          />
          <small>Sin hora = todo el día</small>
        </label>

        {!datos.esTarea && (
          <label className="cal-campo">
            <span>Hasta</span>
            <input
              className="neg-input"
              type="time"
              value={datos.hora_fin}
              disabled={!datos.hora_inicio}
              onChange={(e) => cambiar("hora_fin", e.target.value)}
            />
          </label>
        )}

        <label className="cal-campo">
          <span>Se repite</span>
          <select className="neg-input" value={datos.repite} onChange={(e) => cambiar("repite", e.target.value)}>
            <option value="">No se repite</option>
            {REPETICIONES.map((r) => (
              <option key={r} value={r}>
                {ETIQUETAS_REPITE[r]}
              </option>
            ))}
          </select>
          {datos.repite === "mensual" && <small>El mismo día de cada mes; en los meses cortos, el último.</small>}
        </label>

        {datos.repite && (
          <label className="cal-campo">
            <span>Hasta (opcional)</span>
            <input
              className="neg-input"
              type="date"
              min={datos.fecha}
              value={datos.repite_hasta}
              onChange={(e) => cambiar("repite_hasta", e.target.value)}
            />
            <small>Sin fecha, no termina.</small>
          </label>
        )}

        {!datos.esTarea && (
          <label className="cal-campo cal-campo-ancho">
            <span>Con quién (opcional)</span>
            <input
              className="neg-input"
              value={datos.contacto_nombre}
              maxLength={160}
              placeholder="Nombre del cliente o proveedor"
              onChange={(e) => cambiar("contacto_nombre", e.target.value)}
            />
          </label>
        )}

        <label className="cal-campo cal-campo-ancho">
          <span>Notas (opcional)</span>
          <textarea
            className="neg-input cal-notas"
            value={datos.detalle}
            maxLength={4000}
            rows={3}
            onChange={(e) => cambiar("detalle", e.target.value)}
          />
        </label>
      </div>

      {error && (
        <p className="neg-error" role="alert">
          {error}
        </p>
      )}

      <div className="cal-form-acciones">
        <button type="submit" className="reco-btn" disabled={guardando}>
          {guardando ? "Guardando…" : editando ? "Guardar cambios" : "Agregar al calendario"}
        </button>
        <button type="button" className="ghost-btn" onClick={onCancelar} disabled={guardando}>
          Cancelar
        </button>
      </div>
    </form>
  );
}
