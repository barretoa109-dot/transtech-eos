"use client";

import { useState } from "react";
import { RefreshCw } from "lucide-react";

/**
 * Las plantillas de mensaje: lo único con lo que se puede retomar una conversación
 * pasadas las 24 horas. Se crean acá, se mandan a revisión de Meta y su estado se
 * actualiza solo (por el webhook) o a mano con «Sincronizar».
 */

export type PlantillaWA = {
  id: string;
  nombre: string;
  cuerpo: string;
  cantidad_variables: number;
  estado: string;
  motivo_rechazo: string | null;
  categoria: string;
};

const ESTADOS: Record<string, { texto: string; color: string }> = {
  aprobada: { texto: "Aprobada", color: "var(--green)" },
  en_revision: { texto: "En revisión de Meta", color: "var(--amber)" },
  rechazada: { texto: "Rechazada", color: "var(--red)" },
  pausada: { texto: "Pausada", color: "var(--muted)" },
  borrador: { texto: "Borrador", color: "var(--muted)" },
};

type Props = { canalId: string; tieneWaba: boolean; plantillas: PlantillaWA[]; onCambio: () => void };

export default function PlantillasWA({ canalId, tieneWaba, plantillas, onCambio }: Props) {
  const [abierto, setAbierto] = useState(false);
  const [nombre, setNombre] = useState("");
  const [cuerpo, setCuerpo] = useState("");
  const [categoria, setCategoria] = useState("utilidad");
  const [ejemplos, setEjemplos] = useState<string[]>([]);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState("");
  const [sincronizando, setSincronizando] = useState<string | null>(null);

  // Cuántas variables usa el cuerpo escrito: {{1}}, {{2}}…
  const variables = new Set([...cuerpo.matchAll(/\{\{\s*(\d+)\s*\}\}/g)].map((m) => Number(m[1]))).size;

  function cambiarCuerpo(texto: string) {
    setCuerpo(texto);
    const n = new Set([...texto.matchAll(/\{\{\s*(\d+)\s*\}\}/g)].map((m) => Number(m[1]))).size;
    setEjemplos((prev) => Array.from({ length: n }, (_, i) => prev[i] ?? ""));
  }

  async function crear(e: React.FormEvent) {
    e.preventDefault();
    if (enviando) return;
    setEnviando(true);
    setError("");

    try {
      const r = await fetch("/api/crm/whatsapp/plantillas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ canal_id: canalId, nombre, cuerpo, categoria, ejemplos }),
      });
      const datos = await r.json().catch(() => null);

      if (!r.ok) {
        setError(datos?.error || "No pudimos crear la plantilla.");
        return;
      }

      setNombre("");
      setCuerpo("");
      setEjemplos([]);
      setAbierto(false);
      onCambio();
    } catch {
      setError("No pudimos comunicarnos con el servidor. Reintentá en un momento.");
    } finally {
      setEnviando(false);
    }
  }

  async function sincronizar(id: string) {
    setSincronizando(id);
    setError("");
    try {
      const r = await fetch(`/api/crm/whatsapp/plantillas/${id}/sincronizar`, { method: "POST" });
      const datos = await r.json().catch(() => null);
      if (!r.ok) setError(datos?.error || "No pudimos sincronizar.");
      else onCambio();
    } catch {
      setError("No pudimos comunicarnos con el servidor.");
    } finally {
      setSincronizando(null);
    }
  }

  return (
    <div className="card">
      <div className="card-title">Plantillas de mensaje</div>
      <p className="prose" style={{ fontSize: 13 }}>
        Pasadas las 24 horas desde que el cliente escribió, WhatsApp solo deja retomar la conversación con una plantilla
        que Meta ya aprobó. Sin ellas, EOS solo puede contestar a quien acaba de escribir.
      </p>

      {plantillas.length === 0 ? (
        <p className="empty-note">Todavía no creaste ninguna plantilla.</p>
      ) : (
        <div className="neg-lista">
          {plantillas.map((p) => {
            const e = ESTADOS[p.estado] ?? ESTADOS.borrador;
            return (
              <div key={p.id} style={{ padding: "10px 0", borderBottom: "1px solid var(--line-soft)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                  <strong>{p.nombre}</strong>
                  <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
                    <small style={{ color: e.color }}>{e.texto}</small>
                    {p.estado === "en_revision" && (
                      <button type="button" className="ghost-btn" disabled={sincronizando === p.id} onClick={() => void sincronizar(p.id)} aria-label="Sincronizar con Meta">
                        <RefreshCw size={13} />
                      </button>
                    )}
                  </span>
                </div>
                <div style={{ color: "var(--muted)", fontSize: 13, whiteSpace: "pre-wrap" }}>{p.cuerpo}</div>
                {p.motivo_rechazo && <small style={{ color: "var(--red)" }}>Motivo: {p.motivo_rechazo}</small>}
              </div>
            );
          })}
        </div>
      )}

      {error && (
        <p className="neg-error" role="alert">
          {error}
        </p>
      )}

      {!tieneWaba ? (
        <p className="prose" style={{ fontSize: 13, color: "var(--muted)" }}>
          Para crear plantillas hace falta el ID de la cuenta de WhatsApp Business: volvé a conectar el canal y completalo.
        </p>
      ) : !abierto ? (
        <button type="button" className="ghost-btn" onClick={() => setAbierto(true)}>
          Crear una plantilla
        </button>
      ) : (
        <form onSubmit={crear} style={{ marginTop: 12 }}>
          <div className="neg-form" style={{ flexDirection: "column", alignItems: "stretch" }}>
            <label className="neg-field">
              <span>Nombre</span>
              <input className="neg-input" placeholder="seguimiento_propuesta" value={nombre} onChange={(e) => setNombre(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_"))} required />
              <small style={{ color: "var(--muted)" }}>Minúsculas, números y guion bajo.</small>
            </label>
            <label className="neg-field">
              <span>Categoría</span>
              <select className="neg-input" value={categoria} onChange={(e) => setCategoria(e.target.value)}>
                <option value="utilidad">Utilidad (seguimientos, avisos de un pedido)</option>
                <option value="marketing">Marketing (promociones)</option>
              </select>
            </label>
            <label className="neg-field">
              <span>Mensaje</span>
              <textarea
                className="neg-input"
                rows={4}
                maxLength={1024}
                placeholder="Hola {{1}}, ¿pudiste ver la propuesta de {{2}}? Quedo atento a tus comentarios."
                value={cuerpo}
                onChange={(e) => cambiarCuerpo(e.target.value)}
                required
              />
              <small style={{ color: "var(--muted)" }}>Usá {"{{1}}"}, {"{{2}}"}… para lo que cambia (nombre, monto). No puede empezar ni terminar con una variable.</small>
            </label>
            {Array.from({ length: variables }, (_, i) => (
              <label key={i} className="neg-field">
                <span>Ejemplo para {`{{${i + 1}}}`}</span>
                <input
                  className="neg-input"
                  value={ejemplos[i] ?? ""}
                  onChange={(e) => setEjemplos((prev) => prev.map((v, j) => (j === i ? e.target.value : v)))}
                  required
                />
              </label>
            ))}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="submit" className="reco-btn" disabled={enviando}>
              {enviando ? "Enviando a Meta…" : "Crear y mandar a revisión"}
            </button>
            <button type="button" className="ghost-btn" onClick={() => setAbierto(false)}>
              Cancelar
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
