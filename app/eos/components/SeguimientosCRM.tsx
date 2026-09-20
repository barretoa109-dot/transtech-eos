"use client";

import { useCallback, useEffect, useState } from "react";
import { BellRing, Check, Clock, MessageCircle, Send, X } from "lucide-react";
import type { Seguimiento } from "@/lib/crm/seguimientos";

/**
 * A quién hay que retomar hoy, y con qué mensaje.
 *
 * Lo calcula el servidor (`/api/crm/seguimientos`, con `lib/crm/seguimientos.ts`); esta
 * pantalla lo muestra y deja actuar sin salir de acá:
 *
 *   "Sí, escribile"  abre el borrador de EOS EDITABLE. Nada sale sin que la persona lo vea y
 *                    apriete "Enviar": el mismo envío que la pantalla de conversaciones, con
 *                    la misma política (consentimiento, ventana de 24 horas, límites). Lo que
 *                    no pueda salir vuelve con su motivo, y no se marca como hecho.
 *   Hecho / Posponer / Descartar  se recuerdan: un aviso resuelto no vuelve mañana.
 *
 * Si no se pudieron calcular, NO se muestra "todo al día": esa sería la mentira que este panel
 * existe para evitar. Se dice que falló y se deja reintentar.
 */

type Respuesta = { hoy: string; titular: string; seguimientos: Seguimiento[] };

const ETIQUETA: Record<Seguimiento["tipo"], string> = {
  vencido: "Vencido",
  vence_hoy: "Es hoy",
  sin_respuesta: "Sin respuesta",
  estancada: "Estancada",
  lead_sin_contactar: "Sin contactar",
  cierre_proximo: "Cierre cerca",
};

const PRIORIDAD: Record<Seguimiento["prioridad"], string> = {
  1: "Urgente",
  2: "Importante",
  3: "Para no olvidar",
};

function dinero(m: Seguimiento["monto"]): string {
  if (!m) return "";
  const n = new Intl.NumberFormat("es-PY", { maximumFractionDigits: 0 }).format(m.valor);
  return m.moneda === "PYG" ? `₲ ${n}` : `${m.moneda} ${n}`;
}

export default function SeguimientosCRM({ onIrAConversaciones }: { onIrAConversaciones?: () => void }) {
  const [datos, setDatos] = useState<Respuesta | null>(null);
  const [error, setError] = useState("");
  const [cargando, setCargando] = useState(true);
  const [abierto, setAbierto] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    try {
      const r = await fetch("/api/crm/seguimientos", { cache: "no-store" });
      const cuerpo = await r.json().catch(() => null);

      if (r.status === 403) {
        setDatos({ hoy: "", titular: "", seguimientos: [] });
        setError("");
        return;
      }
      if (!r.ok || !cuerpo) throw new Error(cuerpo?.error || "No pudimos calcular tus seguimientos.");

      setDatos(cuerpo as Respuesta);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "No pudimos calcular tus seguimientos.");
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  if (cargando) return <p className="empty-note">Buscando a quién retomar…</p>;

  if (error) {
    return (
      <div className="neg-load-error" role="alert">
        <div>
          <strong>No mostramos «todo al día» si no pudimos verificarlo</strong>
          <p>{error}</p>
          <button type="button" className="chip" onClick={() => { setError(""); setCargando(true); void cargar(); }}>
            Reintentar
          </button>
        </div>
      </div>
    );
  }

  const lista = datos?.seguimientos ?? [];

  if (lista.length === 0) {
    return (
      <div className="card">
        <div className="card-title">Todo al día</div>
        <p className="prose">
          No hay ningún cliente para retomar hoy. Cuando alguien deje de contestar, una oportunidad se
          estanque o se acerque un cierre, va a aparecer acá con un mensaje listo para revisar.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="card">
        <div className="card-title" style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <BellRing size={16} /> Para retomar hoy
        </div>
        <div className="card-sub">{datos?.titular}</div>
      </div>

      {lista.map((s) => (
        <Fila
          key={s.clave}
          s={s}
          abierto={abierto === s.clave}
          onAbrir={() => setAbierto(abierto === s.clave ? null : s.clave)}
          onCambio={() => { setAbierto(null); void cargar(); }}
          onIrAConversaciones={onIrAConversaciones}
        />
      ))}
    </>
  );
}

function Fila({
  s,
  abierto,
  onAbrir,
  onCambio,
  onIrAConversaciones,
}: {
  s: Seguimiento;
  abierto: boolean;
  onAbrir: () => void;
  onCambio: () => void;
  onIrAConversaciones?: () => void;
}) {
  const [texto, setTexto] = useState(s.borrador ?? "");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState("");
  const [ocupado, setOcupado] = useState(false);
  // Una clave por intento de envío: un doble clic o un reintento de red no manda dos mensajes.
  const [clave, setClave] = useState(() => crypto.randomUUID());

  async function recordar(estado: "hecho" | "pospuesto" | "descartado", dias?: number) {
    if (ocupado) return;
    setOcupado(true);
    setError("");

    try {
      const r = await fetch("/api/crm/seguimientos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clave: s.clave, estado, ...(dias ? { dias } : {}) }),
      });
      const cuerpo = await r.json().catch(() => null);
      if (!r.ok) throw new Error(cuerpo?.error || "No pudimos guardarlo.");
      onCambio();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No pudimos guardarlo.");
    } finally {
      setOcupado(false);
    }
  }

  async function enviar() {
    if (enviando || !s.contacto_id || !texto.trim()) return;
    setEnviando(true);
    setError("");

    try {
      const r = await fetch("/api/crm/whatsapp/enviar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contacto_id: s.contacto_id, clave, texto }),
      });
      const cuerpo = await r.json().catch(() => null);

      if (!r.ok) {
        // No salió: NO se marca como hecho. El motivo, tal cual lo dio el servidor.
        setError(cuerpo?.error || "No se pudo enviar el mensaje.");
        setClave(crypto.randomUUID());
        return;
      }

      // Salió. Se recuerda para que no vuelva a aparecer.
      await recordar("hecho");
    } catch {
      setError("No pudimos comunicarnos con el servidor. Reintentá en un momento.");
      setClave(crypto.randomUUID());
    } finally {
      setEnviando(false);
    }
  }

  const monto = dinero(s.monto);

  return (
    <div className="card" style={s.prioridad === 1 ? { borderLeft: "3px solid var(--accent, currentColor)" } : undefined}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
        <div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 4 }}>
            <span className="chip">{ETIQUETA[s.tipo]}</span>
            <span className="chip">{PRIORIDAD[s.prioridad]}</span>
            {monto && <span className="chip">{monto}</span>}
          </div>
          <div className="card-title" style={{ marginBottom: 2 }}>{s.contacto_nombre}</div>
        </div>
      </div>

      <p className="prose" style={{ margin: "4px 0" }}>{s.texto}</p>
      <p className="prose" style={{ margin: "0 0 8px", color: "var(--muted)" }}>{s.recomendacion}</p>

      {abierto && s.borrador !== null && (
        <div style={{ borderTop: "1px solid var(--line-soft)", paddingTop: 10, marginTop: 4 }}>
          <label style={{ fontSize: 13, color: "var(--muted)" }} htmlFor={`borrador-${s.clave}`}>
            Esto es lo que va a leer {s.contacto_nombre}. Editalo si querés:
          </label>
          <textarea
            id={`borrador-${s.clave}`}
            className="neg-input"
            rows={4}
            maxLength={1000}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            style={{ width: "100%", marginTop: 6 }}
          />
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button type="button" className="reco-btn" disabled={enviando || !texto.trim()} onClick={enviar}>
              <Send size={14} style={{ marginRight: 6 }} />
              {enviando ? "Enviando…" : "Enviar por WhatsApp"}
            </button>
            <button type="button" className="ghost-btn" onClick={onAbrir}>Cancelar</button>
          </div>
        </div>
      )}

      {error && (
        <p className="neg-error" role="alert" style={{ marginTop: 8 }}>
          {error}{" "}
          {onIrAConversaciones && /24 horas|plantilla/i.test(error) && (
            <button type="button" className="chip" onClick={onIrAConversaciones}>Ir a Conversaciones</button>
          )}
        </p>
      )}

      {!abierto && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 4 }}>
          {s.accion === "escribir" && s.puede_escribir && s.borrador !== null && (
            <button type="button" className="reco-btn" onClick={onAbrir}>
              <MessageCircle size={14} style={{ marginRight: 6 }} />
              Sí, escribile
            </button>
          )}
          {s.accion === "escribir" && !s.puede_escribir && (
            <span className="prose" style={{ fontSize: 13, color: "var(--muted)", alignSelf: "center" }}>
              No se le puede escribir desde EOS (falta conectar WhatsApp, su teléfono, o pidió la baja).
            </span>
          )}
          <button type="button" className="chip" disabled={ocupado} onClick={() => void recordar("hecho")}>
            <Check size={13} /> Hecho
          </button>
          <button type="button" className="chip" disabled={ocupado} onClick={() => void recordar("pospuesto", 3)}>
            <Clock size={13} /> En 3 días
          </button>
          <button type="button" className="chip" disabled={ocupado} onClick={() => void recordar("descartado")}>
            <X size={13} /> Descartar
          </button>
        </div>
      )}
    </div>
  );
}
