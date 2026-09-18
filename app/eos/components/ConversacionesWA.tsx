"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Check, CheckCheck, Clock, MessageCircle, ShieldAlert } from "lucide-react";
import type { Conversacion, MensajeVisible } from "@/lib/whatsapp-crm/conversaciones";

/**
 * Las conversaciones de WhatsApp de la empresa con sus clientes.
 *
 * De dónde sale todo: `GET /api/crm/whatsapp`, que lee `eos_wa_mensajes`,
 * `eos_wa_consentimientos` y `eos_wa_eventos` con la sesión de la persona (la
 * RLS decide qué ve). Nada de esto es un dato de muestra: sin canal conectado o
 * sin mensajes, la pantalla lo dice y explica qué falta.
 *
 * Qué NO hace, a propósito: enviar. Hace falta el token de Meta de la empresa
 * (ver `docs/whatsapp-crm.md`) y un botón que no envía nada es peor que ningún
 * botón. Cuando el canal pueda enviar, acá va la caja de respuesta.
 */

type Canal = {
  nombre: string | null;
  telefono: string | null;
  estado: string;
  respuesta_automatica: boolean;
  puede_enviar: boolean;
};

type Respuesta = { disponible: boolean; canal: Canal | null; conversaciones: Conversacion[] };

const INTENCIONES: Record<string, string> = {
  consulta_precio: "Consultó el precio",
  interes: "Muestra interés",
  confirma_compra: "Confirmó la compra",
  lo_pensara: "Lo va a pensar",
  pide_persona: "Pidió una persona",
  baja: "Pidió la baja",
};

const ESTADOS_CANAL: Record<string, string> = {
  pendiente: "Pendiente de conexión",
  activo: "Activo",
  pausado: "Pausado",
  desconectado: "Desconectado",
};

function cuando(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const min = Math.round((Date.now() - t) / 60_000);
  if (min < 1) return "ahora";
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.round(h / 24);
  return d === 1 ? "ayer" : `hace ${d} días`;
}

function resumenDe(m: MensajeVisible): string {
  if (m.texto) return m.texto;
  return m.tipo === "texto" ? "" : `(${m.tipo})`;
}

function Estado({ m }: { m: MensajeVisible }) {
  if (m.direccion !== "saliente") return null;
  const estilo = { verticalAlign: "-2px", marginLeft: 4 } as const;
  if (m.estado === "leido") return <CheckCheck size={13} style={{ ...estilo, color: "var(--blue)" }} aria-label="Leído" />;
  if (m.estado === "entregado") return <CheckCheck size={13} style={estilo} aria-label="Entregado" />;
  if (m.estado === "enviado") return <Check size={13} style={estilo} aria-label="Enviado" />;
  if (m.estado === "en_cola" || m.estado === "pendiente_aprobacion") return <Clock size={13} style={estilo} aria-label="Pendiente" />;
  return null;
}

export default function ConversacionesWA() {
  const [datos, setDatos] = useState<Respuesta | null>(null);
  const [error, setError] = useState("");
  const [cargando, setCargando] = useState(true);
  const [abierta, setAbierta] = useState<string | null>(null);

  const cargar = useCallback(() => {
    return fetch("/api/crm/whatsapp", { cache: "no-store" })
      .then(async (r) => {
        if (r.status === 401) throw new Error("SESSION_EXPIRED");
        if (!r.ok) throw new Error("UNAVAILABLE");
        setDatos((await r.json()) as Respuesta);
        setError("");
      })
      .catch((err) => {
        console.error("No se pudieron cargar las conversaciones:", err);
        setError(
          err instanceof Error && err.message === "SESSION_EXPIRED"
            ? "Tu sesión venció. Volvé a iniciar sesión."
            : "No pudimos cargar las conversaciones. No las mostramos vacías porque podrían existir: reintentá.",
        );
      })
      .finally(() => setCargando(false));
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  if (cargando) return <p className="empty-note">Cargando conversaciones…</p>;

  if (error) {
    return (
      <div className="neg-load-error" role="alert">
        <div>
          <strong>No mostramos vacío si no pudimos verificar los datos</strong>
          <p>{error}</p>
          <button type="button" className="chip" onClick={() => { setError(""); setCargando(true); void cargar(); }}>
            Reintentar
          </button>
        </div>
      </div>
    );
  }

  if (!datos || !datos.disponible || !datos.canal) {
    return (
      <div className="card">
        <div className="card-title">Todavía no conectaste el WhatsApp de tu empresa</div>
        <p className="prose">
          Este es el WhatsApp con el que tus <strong>clientes</strong> te escriben, distinto del que
          usás para hablar con EOS. Cuando esté conectado, cada mensaje se asocia al cliente correcto,
          se actualiza su última interacción y EOS te avisa cuando alguien necesita que le contestes
          vos.
        </p>
        <p className="prose">
          Para conectarlo hace falta una cuenta de WhatsApp Business de tu empresa y su acceso de
          Meta. Escribile a soporte para coordinarlo.
        </p>
      </div>
    );
  }

  const { canal, conversaciones } = datos;
  const esperando = conversaciones.filter((c) => c.esperando).length;
  const seleccionada = conversaciones.find((c) => c.clave === abierta) ?? null;

  return (
    <>
      <div className="card" style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <MessageCircle size={18} />
        <div style={{ flex: 1, minWidth: 200 }}>
          <div className="card-title" style={{ marginBottom: 2 }}>
            {canal.nombre || "WhatsApp de la empresa"}
            {canal.telefono ? ` · +${canal.telefono}` : ""}
          </div>
          <div className="card-sub" style={{ margin: 0 }}>
            {ESTADOS_CANAL[canal.estado] ?? canal.estado}
            {canal.respuesta_automatica ? " · EOS responde solo cuando el cliente escribe" : " · EOS solo registra: vos respondés"}
          </div>
        </div>
        {esperando > 0 && (
          <span className="chip" style={{ color: "var(--amber)", borderColor: "var(--amber)" }}>
            {esperando} {esperando === 1 ? "cliente espera" : "clientes esperan"} tu respuesta
          </span>
        )}
      </div>

      {!canal.puede_enviar && (
        <p className="prose" style={{ color: "var(--muted)", fontSize: 13 }}>
          Por ahora EOS <strong>registra</strong> lo que tus clientes escriben, arma su historial y te
          avisa; para contestar desde acá falta conectar el acceso de envío de tu WhatsApp Business.
        </p>
      )}

      {conversaciones.length === 0 ? (
        <p className="empty-note">Todavía no te escribió ningún cliente en los últimos 60 días.</p>
      ) : (
        <div
          style={{
            display: "grid",
            // Dos columnas cuando hay lugar; una sobre otra en el teléfono.
            gridTemplateColumns: seleccionada ? "repeat(auto-fit, minmax(min(100%, 300px), 1fr))" : "minmax(0, 1fr)",
            gap: 12,
            alignItems: "start",
          }}
        >
          <div className="card" style={{ padding: 0, overflow: "hidden" }}>
            {conversaciones.map((c) => (
              <button
                key={c.clave}
                type="button"
                onClick={() => setAbierta(c.clave)}
                aria-current={c.clave === abierta ? "true" : undefined}
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  padding: "12px 14px",
                  border: 0,
                  borderBottom: "1px solid var(--line-soft)",
                  background: c.clave === abierta ? "var(--blue-light)" : "transparent",
                  color: "inherit",
                  cursor: "pointer",
                  font: "inherit",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                  <strong style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.nombre}</strong>
                  <small style={{ color: "var(--muted)", whiteSpace: "nowrap" }}>{cuando(c.ultimo.ocurrio_en)}</small>
                </div>
                <div style={{ color: "var(--muted)", fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {c.ultimo.direccion === "saliente" ? "Vos: " : ""}
                  {resumenDe(c.ultimo)}
                </div>
                <div style={{ display: "flex", gap: 6, marginTop: 4, flexWrap: "wrap" }}>
                  {c.esperando && <small style={{ color: "var(--amber)" }}>● Espera tu respuesta</small>}
                  {c.consentimiento === "revocado" && <small style={{ color: "var(--red)" }}>Pidió no recibir mensajes</small>}
                </div>
              </button>
            ))}
          </div>

          {seleccionada && (
            <div className="card">
              <button type="button" className="ghost-btn" onClick={() => setAbierta(null)} style={{ marginBottom: 10 }}>
                <ArrowLeft size={14} /> Volver a la lista
              </button>

              <div className="card-title">{seleccionada.nombre}</div>
              <div className="card-sub">
                +{seleccionada.telefono}
                {seleccionada.consentimiento === "revocado"
                  ? " · pidió no recibir más mensajes: EOS no le escribe"
                  : ""}
              </div>

              {seleccionada.consentimiento === "revocado" && (
                <p className="neg-error" role="note" style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <ShieldAlert size={15} /> Este cliente pidió la baja. Respetarla protege la calidad del número de tu empresa.
                </p>
              )}

              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 10 }}>
                {seleccionada.mensajes.map((m) => {
                  const mio = m.direccion === "saliente";
                  return (
                    <div key={m.id} style={{ alignSelf: mio ? "flex-end" : "flex-start", maxWidth: "85%" }}>
                      <div
                        style={{
                          padding: "8px 12px",
                          borderRadius: 12,
                          background: mio ? "var(--blue-light)" : "var(--panel)",
                          border: "1px solid var(--line-soft)",
                          whiteSpace: "pre-wrap",
                          overflowWrap: "anywhere",
                        }}
                      >
                        {resumenDe(m) || <em style={{ color: "var(--muted)" }}>(sin texto)</em>}
                      </div>
                      <small style={{ color: "var(--muted)", display: "block", textAlign: mio ? "right" : "left" }}>
                        {cuando(m.ocurrio_en)}
                        {m.intencion && INTENCIONES[m.intencion] ? ` · ${INTENCIONES[m.intencion]}` : ""}
                        {m.estado === "bloqueado" ? " · no salió" : ""}
                        <Estado m={m} />
                      </small>
                      {m.motivo && (m.estado === "bloqueado" || m.estado === "fallido") && (
                        <small style={{ color: "var(--red)", display: "block", textAlign: mio ? "right" : "left" }}>
                          {m.motivo}
                        </small>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}
