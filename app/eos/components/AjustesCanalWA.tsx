"use client";

import { useState } from "react";
import { InstruccionesWebhook } from "./ConectarWhatsApp";
import PlantillasWA, { type PlantillaWA } from "./PlantillasWA";

/**
 * Administrar el WhatsApp de la empresa: pausar, reanudar, desconectar, los límites
 * de envío y las plantillas. Todo pasa por `PATCH /api/crm/whatsapp/canal`.
 */

export type CanalWA = {
  id: string;
  nombre: string | null;
  telefono: string | null;
  estado: string;
  respuesta_automatica: boolean;
  puede_enviar: boolean;
  tiene_waba: boolean;
  tiene_secreto_app: boolean;
  limite_diario: number;
  limite_por_contacto_dia: number;
  silencio_desde_hora: number;
  silencio_hasta_hora: number;
  ultimo_error: string | null;
  verify_token: string | null;
};

type Props = { canal: CanalWA; plantillas: PlantillaWA[]; onCambio: () => void };

export default function AjustesCanalWA({ canal, plantillas, onCambio }: Props) {
  const [error, setError] = useState("");
  const [trabajando, setTrabajando] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const [limiteDiario, setLimiteDiario] = useState(String(canal.limite_diario));
  const [porCliente, setPorCliente] = useState(String(canal.limite_por_contacto_dia));
  const [desde, setDesde] = useState(String(canal.silencio_desde_hora));
  const [hasta, setHasta] = useState(String(canal.silencio_hasta_hora));
  const [guardado, setGuardado] = useState(false);

  async function patch(cuerpo: Record<string, unknown>): Promise<boolean> {
    setTrabajando(true);
    setError("");
    setGuardado(false);

    try {
      const r = await fetch("/api/crm/whatsapp/canal", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ canal_id: canal.id, ...cuerpo }),
      });
      const datos = await r.json().catch(() => null);

      if (!r.ok) {
        setError(datos?.error || "No pudimos hacer el cambio.");
        return false;
      }

      onCambio();
      return true;
    } catch {
      setError("No pudimos comunicarnos con el servidor. Reintentá en un momento.");
      return false;
    } finally {
      setTrabajando(false);
    }
  }

  async function guardarAjustes(e: React.FormEvent) {
    e.preventDefault();
    const ok = await patch({
      accion: "configurar",
      limite_diario: Number(limiteDiario),
      limite_por_contacto_dia: Number(porCliente),
      silencio_desde_hora: Number(desde),
      silencio_hasta_hora: Number(hasta),
    });
    if (ok) setGuardado(true);
  }

  const pausado = canal.estado === "pausado";

  return (
    <>
      {canal.ultimo_error && (
        <p className="neg-error" role="alert">
          El último envío falló: {canal.ultimo_error}
        </p>
      )}

      <div className="card">
        <div className="card-title">Estado del canal</div>
        <p className="prose" style={{ fontSize: 13 }}>
          {pausado
            ? "Pausado: EOS sigue registrando lo que tus clientes escriben, pero no sale ningún mensaje."
            : "Activo: los mensajes de tus clientes se registran y podés contestarles."}
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {pausado ? (
            <button type="button" className="reco-btn" disabled={trabajando} onClick={() => void patch({ accion: "reanudar" })}>
              Reanudar
            </button>
          ) : (
            <button type="button" className="ghost-btn" disabled={trabajando} onClick={() => void patch({ accion: "pausar" })}>
              Pausar
            </button>
          )}

          {!confirmando ? (
            <button type="button" className="ghost-btn" onClick={() => setConfirmando(true)}>
              Desconectar
            </button>
          ) : (
            <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
              <small style={{ color: "var(--red)" }}>Se borra el acceso guardado. El historial se conserva.</small>
              <button
                type="button"
                className="ghost-btn"
                style={{ color: "var(--red)" }}
                disabled={trabajando}
                onClick={() => void patch({ accion: "desconectar" })}
              >
                Sí, desconectar
              </button>
              <button type="button" className="ghost-btn" onClick={() => setConfirmando(false)}>
                Cancelar
              </button>
            </span>
          )}
        </div>
        {error && (
          <p className="neg-error" role="alert">
            {error}
          </p>
        )}
      </div>

      <form className="card" onSubmit={guardarAjustes}>
        <div className="card-title">Límites de envío</div>
        <p className="prose" style={{ fontSize: 13 }}>
          Arrancan bajos a propósito: el tope real lo pone Meta según la calidad de tu número, y subirlo antes de tiempo
          arriesga que lo limiten. EOS no le escribe a un cliente que pidió la baja, ni fuera de horario si el mensaje lo
          inicia él.
        </p>
        <div className="neg-form">
          <label className="neg-field">
            <span>Mensajes por día</span>
            <input className="neg-input" inputMode="numeric" value={limiteDiario} onChange={(e) => setLimiteDiario(e.target.value.replace(/\D/g, ""))} />
          </label>
          <label className="neg-field">
            <span>Por cliente por día</span>
            <input className="neg-input" inputMode="numeric" value={porCliente} onChange={(e) => setPorCliente(e.target.value.replace(/\D/g, ""))} />
          </label>
          <label className="neg-field">
            <span>Silencio desde (hora)</span>
            <input className="neg-input" inputMode="numeric" value={desde} onChange={(e) => setDesde(e.target.value.replace(/\D/g, ""))} />
          </label>
          <label className="neg-field">
            <span>Silencio hasta (hora)</span>
            <input className="neg-input" inputMode="numeric" value={hasta} onChange={(e) => setHasta(e.target.value.replace(/\D/g, ""))} />
          </label>
        </div>
        <button type="submit" className="reco-btn" disabled={trabajando}>
          {trabajando ? "Guardando…" : guardado ? "✓ Guardado" : "Guardar límites"}
        </button>
      </form>

      <PlantillasWA canalId={canal.id} tieneWaba={canal.tiene_waba} plantillas={plantillas} onCambio={onCambio} />

      {canal.verify_token && <InstruccionesWebhook verifyToken={canal.verify_token} conAppPropia={canal.tiene_secreto_app} />}
    </>
  );
}
