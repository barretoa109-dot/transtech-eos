"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, CalendarClock, MessageCircle, Phone, StickyNote } from "lucide-react";
import ResponderWA from "./ResponderWA";
import type { PlantillaWA } from "./PlantillasWA";
import type { Contacto } from "./negocio/tipos";
import type { EntradaHistorial, ResumenFicha } from "@/lib/crm/ficha";

/**
 * La ficha de un cliente, entera en un solo lugar.
 *
 * Datos, historia (mensajes, llamadas, ventas, oportunidades) y lo que hay abierto con él. Desde
 * acá se le puede escribir por WhatsApp con las mismas reglas que en Conversaciones, anotar una
 * llamada o una nota, y cambiar cuándo hay que volver a hablarle.
 *
 * SI ALGO NO SE PUDO LEER, SE DICE: un historial que parece completo y no lo es lleva a creer que
 * «nunca se le escribió». El servidor devuelve `incompleto` y acá se muestra tal cual.
 */

type OportunidadFicha = {
  id: string;
  titulo: string;
  etapa: string;
  monto: number;
  moneda: string;
  probabilidad?: number | null;
  producto_servicio?: string | null;
  proxima_accion_en?: string | null;
  cierre_estimado: string | null;
};

type Datos = {
  contacto: Contacto;
  oportunidades: OportunidadFicha[];
  historial: EntradaHistorial[];
  resumen: ResumenFicha;
  whatsapp: { baja: boolean };
  incompleto: string[];
};

type Miembro = { id: string; nombre: string; yo: boolean };

const ESTADOS = [
  { valor: "prospecto", etiqueta: "Prospecto" },
  { valor: "activo", etiqueta: "Activo" },
  { valor: "inactivo", etiqueta: "Inactivo" },
] as const;

const ETAPAS: Record<string, string> = {
  nueva: "Nueva",
  contactado: "Contactado",
  propuesta: "Propuesta",
  negociacion: "Negociación",
  ganada: "Ganada",
  perdida: "Perdida",
};

const plata = (n: number, moneda: string) => {
  const f = new Intl.NumberFormat("es-PY", { maximumFractionDigits: 0 }).format(n);
  return moneda === "PYG" ? `₲ ${f}` : `${moneda} ${f}`;
};

const fecha = (iso: string | null | undefined) => {
  if (!iso) return "—";
  const d = new Date(iso.length <= 10 ? `${iso}T12:00:00Z` : iso);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleDateString("es-PY", { day: "numeric", month: "short", year: "numeric", timeZone: "America/Asuncion" });
};

const sumas = (m: Record<string, number>) => {
  const partes = Object.entries(m).map(([mon, n]) => plata(n, mon));
  return partes.length ? partes.join(" + ") : "—";
};

export default function FichaCliente({ contactoId, onVolver }: { contactoId: string; onVolver: () => void }) {
  const [datos, setDatos] = useState<Datos | null>(null);
  const [error, setError] = useState("");
  const [cargando, setCargando] = useState(true);
  const [seccion, setSeccion] = useState<"historial" | "datos" | "oportunidades">("historial");
  const [equipo, setEquipo] = useState<Miembro[]>([]);
  const [plantillas, setPlantillas] = useState<PlantillaWA[]>([]);

  const cargar = useCallback(() => {
    return fetch(`/api/crm/contactos/${contactoId}/ficha`, { cache: "no-store" })
      .then(async (r) => {
        const cuerpo = await r.json().catch(() => null);
        if (!r.ok || !cuerpo) throw new Error(cuerpo?.error || "No pudimos cargar la ficha.");
        setDatos(cuerpo as Datos);
        setError("");
      })
      .catch((e) => setError(e instanceof Error ? e.message : "No pudimos cargar la ficha."))
      .finally(() => setCargando(false));
  }, [contactoId]);

  useEffect(() => {
    void cargar();
    // Lo de abajo es accesorio: si falla, la ficha sigue siendo útil.
    fetch("/api/crm/equipo", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setEquipo(d?.equipo ?? []))
      .catch(() => {});
    fetch("/api/crm/whatsapp/plantillas", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setPlantillas(d?.plantillas ?? []))
      .catch(() => {});
  }, [cargar]);

  if (cargando) return <p className="empty-note">Abriendo la ficha…</p>;

  if (error || !datos) {
    return (
      <div className="neg-load-error" role="alert">
        <div>
          <strong>No pudimos abrir la ficha</strong>
          <p>{error}</p>
          <button type="button" className="chip" onClick={() => { setError(""); setCargando(true); void cargar(); }}>Reintentar</button>{" "}
          <button type="button" className="chip" onClick={onVolver}>Volver</button>
        </div>
      </div>
    );
  }

  const { contacto, resumen } = datos;
  const estado = ESTADOS.find((e) => e.valor === (contacto.estado_relacion ?? "activo"))?.etiqueta ?? "Activo";

  return (
    <>
      <div className="card">
        <button type="button" className="ghost-btn" onClick={onVolver} style={{ marginBottom: 8 }}>
          <ArrowLeft size={14} style={{ marginRight: 4 }} /> Contactos
        </button>

        <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
          <div className="card-title" style={{ marginBottom: 0 }}>{contacto.nombre}</div>
          <span className="chip">{estado}</span>
        </div>
        <div className="card-sub">
          {[contacto.empresa, contacto.telefono, contacto.email].filter(Boolean).join(" · ") || "Sin más datos cargados"}
        </div>

        <div className="neg-resumen" style={{ marginTop: 12 }}>
          <div className="neg-resumen-card">
            <span>Último contacto</span>
            <strong>{fecha(resumen.ultimo_contacto)}</strong>
            <small>
              {resumen.sin_respuesta_dias !== null
                ? `Sin respuesta hace ${resumen.sin_respuesta_dias} días`
                : "Al día"}
            </small>
          </div>
          <div className="neg-resumen-card">
            <span>Próximo contacto</span>
            <strong>{fecha(contacto.proxima_interaccion_en)}</strong>
            <small>{contacto.proxima_interaccion_en ? "Agendado" : "Sin agendar"}</small>
          </div>
          <div className="neg-resumen-card">
            <span>Compras</span>
            <strong>{resumen.ventas.cantidad}</strong>
            <small>{sumas(resumen.ventas.por_moneda)}</small>
          </div>
          <div className="neg-resumen-card">
            <span>En juego</span>
            <strong>{resumen.oportunidades_abiertas.cantidad}</strong>
            <small>{sumas(resumen.oportunidades_abiertas.por_moneda)}</small>
          </div>
        </div>
      </div>

      {datos.incompleto.length > 0 && (
        <div className="neg-load-error" role="alert">
          <div>
            <strong>Este historial puede estar incompleto</strong>
            <p>No pudimos leer: {datos.incompleto.join(", ")}. No lo tomes como todo lo que pasó con este cliente.</p>
            <button type="button" className="chip" onClick={() => void cargar()}>Reintentar</button>
          </div>
        </div>
      )}

      <div className="neg-nav" role="tablist" aria-label="Secciones de la ficha">
        {(
          [
            ["historial", "Historial"],
            ["oportunidades", `Oportunidades (${datos.oportunidades.length})`],
            ["datos", "Datos"],
          ] as const
        ).map(([clave, etiqueta]) => (
          <button
            key={clave}
            type="button"
            role="tab"
            aria-selected={seccion === clave}
            className={`neg-nav-item ${seccion === clave ? "active" : ""}`}
            onClick={() => setSeccion(clave)}
          >
            <span>{etiqueta}</span>
          </button>
        ))}
      </div>

      {seccion === "historial" && (
        <Historial datos={datos} plantillas={plantillas} contactoId={contactoId} onCambio={() => void cargar()} />
      )}
      {seccion === "oportunidades" && <Oportunidades lista={datos.oportunidades} />}
      {seccion === "datos" && <Editar contacto={contacto} equipo={equipo} onGuardado={() => void cargar()} />}
    </>
  );
}

// -------------------------------------------------------------------- historial

const ICONO: Record<EntradaHistorial["tipo"], string> = {
  mensaje_recibido: "←",
  mensaje_enviado: "→",
  mensaje_no_salio: "✕",
  actividad: "•",
  pendiente: "○",
  oportunidad_creada: "＋",
  oportunidad_ganada: "✓",
  oportunidad_perdida: "✗",
  venta: "₲",
};

function Historial({
  datos,
  plantillas,
  contactoId,
  onCambio,
}: {
  datos: Datos;
  plantillas: PlantillaWA[];
  contactoId: string;
  onCambio: () => void;
}) {
  const { contacto } = datos;
  const [escribiendo, setEscribiendo] = useState(false);
  const [nota, setNota] = useState("");
  const [tipoNota, setTipoNota] = useState<"nota" | "llamada" | "reunion">("nota");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");

  async function anotar() {
    if (!nota.trim() || guardando) return;
    setGuardando(true);
    setError("");

    try {
      const r = await fetch("/api/crm/actividades", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contacto_id: contactoId, tipo: tipoNota, detalle: nota }),
      });
      const cuerpo = await r.json().catch(() => null);
      if (!r.ok) throw new Error(cuerpo?.error || "No pudimos guardar la nota.");
      setNota("");
      onCambio();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No pudimos guardar la nota.");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <>
      <div className="card">
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" className="reco-btn" onClick={() => setEscribiendo((v) => !v)}>
            <MessageCircle size={14} style={{ marginRight: 6 }} />
            Escribirle por WhatsApp
          </button>
          {contacto.telefono && (
            <a className="chip" href={`tel:${contacto.telefono}`} style={{ alignSelf: "center" }}>
              <Phone size={12} /> Llamar
            </a>
          )}
        </div>

        {escribiendo && (
          <ResponderWA
            contactoId={contactoId}
            nombre={contacto.nombre}
            plantillas={plantillas}
            bloqueado={datos.whatsapp.baja ? "Este cliente pidió no recibir más mensajes. Si cambió de opinión, registralo en Conversaciones." : undefined}
            onEnviado={() => { setEscribiendo(false); onCambio(); }}
          />
        )}

        <div style={{ borderTop: "1px solid var(--line-soft)", marginTop: 12, paddingTop: 12 }}>
          <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
            {(["nota", "llamada", "reunion"] as const).map((t) => (
              <button key={t} type="button" className={`chip ${tipoNota === t ? "active" : ""}`} onClick={() => setTipoNota(t)}>
                {t === "nota" ? "Nota" : t === "llamada" ? "Llamada" : "Reunión"}
              </button>
            ))}
          </div>
          <textarea
            className="neg-input"
            rows={2}
            maxLength={4000}
            placeholder="Anotá qué pasó (una llamada, algo que te dijo…)"
            value={nota}
            onChange={(e) => setNota(e.target.value)}
            style={{ width: "100%" }}
          />
          {error && <p className="neg-error" role="alert">{error}</p>}
          <button type="button" className="chip" disabled={guardando || !nota.trim()} onClick={anotar} style={{ marginTop: 6 }}>
            <StickyNote size={12} /> {guardando ? "Guardando…" : "Anotar"}
          </button>
        </div>
      </div>

      <div className="card">
        <div className="card-title">Historia con {contacto.nombre}</div>
        {datos.historial.length === 0 ? (
          <p className="empty-note">Todavía no hay nada anotado con este cliente.</p>
        ) : (
          <div className="neg-lista">
            {datos.historial.map((e) => (
              <div className="neg-fila" key={e.clave}>
                <div aria-hidden="true" style={{ width: 22, textAlign: "center", color: e.tipo === "mensaje_no_salio" ? "var(--danger, #b00020)" : "var(--muted)" }}>
                  {ICONO[e.tipo]}
                </div>
                <div className="neg-fila-texto">
                  <strong>{e.titulo}</strong>
                  {e.detalle && <small>{e.detalle}</small>}
                </div>
                <span className="neg-estado">{fecha(e.cuando)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

// ----------------------------------------------------------------- oportunidades

function Oportunidades({ lista }: { lista: OportunidadFicha[] }) {
  if (lista.length === 0) {
    return (
      <div className="card">
        <p className="empty-note">No hay oportunidades con este cliente. Creá una desde «Oportunidades» o pedíselo a EOS.</p>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="neg-lista">
        {lista.map((o) => (
          <div className="neg-fila" key={o.id}>
            <div className="neg-fila-texto">
              <strong>{o.titulo}</strong>
              <small>
                {[
                  o.producto_servicio,
                  o.monto > 0 ? plata(o.monto, o.moneda) : "sin monto",
                  typeof o.probabilidad === "number" ? `${o.probabilidad} % de probabilidad` : null,
                  o.proxima_accion_en ? `próximo paso ${fecha(o.proxima_accion_en)}` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </small>
            </div>
            <span className="neg-estado">{ETAPAS[o.etapa] ?? o.etapa}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------------ datos

/**
 * Lo que hay que mandar: los datos de siempre, y los de la ficha SOLO si cambiaron. Así una base
 * a la que todavía le falta la v185 sigue guardando el teléfono o las notas, y solo avisa
 * que no puede cuando de verdad se le pidió cambiar algo de la ficha nueva.
 */
function cambiosDe(f: Record<string, string>, original: Contacto): Record<string, unknown> {
  const envio: Record<string, unknown> = {
    nombre: f.nombre,
    telefono: f.telefono,
    email: f.email,
    direccion: f.direccion,
    ciudad: f.ciudad,
    notas: f.notas,
  };

  if (f.empresa !== (original.empresa ?? "")) envio.empresa = f.empresa;
  if (f.estado_relacion !== (original.estado_relacion ?? "activo")) envio.estado_relacion = f.estado_relacion;
  // Vacío = sin fecha / sin responsable: el servidor lo entiende como «borrar».
  if (f.proxima_interaccion_en !== (original.proxima_interaccion_en ?? "")) envio.proxima_interaccion_en = f.proxima_interaccion_en || null;
  if (f.responsable_id !== (original.responsable_id ?? "")) envio.responsable_id = f.responsable_id || null;

  return envio;
}

function Editar({ contacto, equipo, onGuardado }: { contacto: Contacto; equipo: Miembro[]; onGuardado: () => void }) {
  const [f, setF] = useState({
    nombre: contacto.nombre,
    empresa: contacto.empresa ?? "",
    estado_relacion: contacto.estado_relacion ?? "activo",
    proxima_interaccion_en: contacto.proxima_interaccion_en ?? "",
    responsable_id: contacto.responsable_id ?? "",
    telefono: contacto.telefono ?? "",
    email: contacto.email ?? "",
    direccion: contacto.direccion ?? "",
    ciudad: contacto.ciudad ?? "",
    notas: contacto.notas ?? "",
  });
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  const [ok, setOk] = useState(false);

  const poner = (campo: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    setF((prev) => ({ ...prev, [campo]: e.target.value }));
    setOk(false);
  };

  async function guardar() {
    if (guardando || !f.nombre.trim()) return;
    setGuardando(true);
    setError("");

    try {
      const r = await fetch(`/api/erp/contactos/${contacto.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cambiosDe(f, contacto)),
      });
      const cuerpo = await r.json().catch(() => null);
      if (!r.ok) throw new Error(cuerpo?.error || "No pudimos guardar los cambios.");
      setOk(true);
      onGuardado();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No pudimos guardar los cambios.");
    } finally {
      setGuardando(false);
    }
  }

  const campo = (etiqueta: string, control: React.ReactNode) => (
    <label style={{ display: "block", marginBottom: 10 }}>
      <span style={{ display: "block", fontSize: 13, color: "var(--muted)", marginBottom: 3 }}>{etiqueta}</span>
      {control}
    </label>
  );

  return (
    <div className="card">
      {campo("Nombre", <input className="neg-input" style={{ width: "100%" }} maxLength={160} value={f.nombre} onChange={poner("nombre")} />)}
      {campo("Empresa donde trabaja", <input className="neg-input" style={{ width: "100%" }} maxLength={160} value={f.empresa} onChange={poner("empresa")} />)}
      {campo(
        "Cómo está la relación",
        <select className="neg-input" style={{ width: "100%" }} value={f.estado_relacion} onChange={poner("estado_relacion")}>
          {ESTADOS.map((e) => (
            <option key={e.valor} value={e.valor}>{e.etiqueta}</option>
          ))}
        </select>,
      )}
      {campo(
        "Cuándo hay que volver a hablarle",
        <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <CalendarClock size={16} />
          <input className="neg-input" type="date" value={f.proxima_interaccion_en} onChange={poner("proxima_interaccion_en")} />
        </span>,
      )}
      {campo(
        "Quién de tu empresa se ocupa",
        <select className="neg-input" style={{ width: "100%" }} value={f.responsable_id} onChange={poner("responsable_id")}>
          <option value="">Sin asignar</option>
          {equipo.map((m) => (
            <option key={m.id} value={m.id}>{m.yo ? `${m.nombre} (yo)` : m.nombre}</option>
          ))}
        </select>,
      )}
      {campo("Teléfono", <input className="neg-input" style={{ width: "100%" }} maxLength={40} value={f.telefono} onChange={poner("telefono")} />)}
      {campo("Email", <input className="neg-input" style={{ width: "100%" }} type="email" maxLength={180} value={f.email} onChange={poner("email")} />)}
      {campo("Dirección", <input className="neg-input" style={{ width: "100%" }} maxLength={200} value={f.direccion} onChange={poner("direccion")} />)}
      {campo("Ciudad", <input className="neg-input" style={{ width: "100%" }} maxLength={80} value={f.ciudad} onChange={poner("ciudad")} />)}
      {campo("Notas", <textarea className="neg-input" style={{ width: "100%" }} rows={3} maxLength={2000} value={f.notas} onChange={poner("notas")} />)}

      {error && <p className="neg-error" role="alert">{error}</p>}
      {ok && <p className="prose" style={{ color: "var(--muted)" }}>Guardado.</p>}

      <button type="button" className="reco-btn" disabled={guardando || !f.nombre.trim()} onClick={guardar}>
        {guardando ? "Guardando…" : "Guardar cambios"}
      </button>
    </div>
  );
}
