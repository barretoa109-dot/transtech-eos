"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertCircle, CalendarDays, Check, ChevronRight, Plus, RefreshCw, Target } from "lucide-react";
import { formatearMonto } from "@/lib/finanzas/formato";
import { etiquetaDeEtapa, siguienteEtapa } from "@/lib/crm/embudo";
import type { Actividad, Contacto, Oportunidad } from "./tipos";

/**
 * El embudo y la agenda del CRM.
 *
 * ============================================================
 * DOS CIFRAS ARRIBA, NO UNA
 * ============================================================
 *
 * "En juego" es lo que suma el embudo entero. Es cierto y no significa nada
 * solo: un embudo con diez oportunidades nuevas de un millón dice "diez
 * millones" y no va a entrar nada parecido.
 *
 * "Esperado" pondera cada una por su etapa. Es la que se puede mirar sin
 * planificar sobre plata que no existe, y es la razón por la que este panel
 * muestra las dos: la primera para saber el tamaño de la cancha, la segunda
 * para decidir.
 *
 * ============================================================
 * MOVER UNA TARJETA ES UN CLIC
 * ============================================================
 *
 * Es la única operación que se hace todos los días. Si costara abrir un
 * formulario, elegir en un desplegable y guardar, el embudo dejaría de estar al
 * día en una semana — y un embudo desactualizado miente peor que no tenerlo.
 */

/*
 * ============================================================
 * Y UN EMBUDO POR MONEDA, NO UNO SOLO
 * ============================================================
 *
 * Antes había un único "en juego" con la moneda de la primera oportunidad de
 * la lista pegada al lado. Alcanzaba con tener una en dólares para que la cifra
 * dejara de existir: guaraníes sumados a dólares no dan nada. Ahora cada moneda
 * tiene su bloque, con la del negocio primero.
 *
 * Los conteos por etapa sí van juntos: "tres en propuesta" se puede contar
 * entre monedas porque no es plata, es cuántas hay.
 */
type EmbudoDeMoneda = {
  moneda: string;
  abiertas: number;
  en_juego: number;
  esperado: number;
  ganadas: number;
  ganado: number;
  por_etapa: { clave: string; etiqueta: string; cantidad: number; monto: number }[];
};

export default function Embudo({ contactos }: { contactos: Contacto[] }) {
  const [oportunidades, setOportunidades] = useState<Oportunidad[]>([]);
  const [actividades, setActividades] = useState<Actividad[]>([]);
  const [embudos, setEmbudos] = useState<EmbudoDeMoneda[]>([]);
  const [sinModulo, setSinModulo] = useState(false);
  const [cargando, setCargando] = useState(true);
  const [errorCarga, setErrorCarga] = useState("");
  const [moviendo, setMoviendo] = useState<string | null>(null);

  const cargar = useCallback(() => {
    return Promise.all([
      fetch("/api/crm/oportunidades", { cache: "no-store" }),
      fetch("/api/crm/actividades", { cache: "no-store" }),
    ])
      .then(async (respuestas) => {
        // 403 no es un error: es "no contrataste el CRM".
        if (respuestas.some((r) => r.status === 403)) {
          setSinModulo(true);
          return;
        }

        if (respuestas.some((r) => !r.ok)) {
          throw new Error("No pudimos cargar la información del CRM.");
        }

        setErrorCarga("");

        const [oportunidadesData, actividadesData] = await Promise.all(
          respuestas.map((r) => r.json().catch(() => null)),
        );

        setOportunidades(oportunidadesData?.oportunidades ?? []);
        setEmbudos(oportunidadesData?.embudos ?? []);
        setActividades(actividadesData?.actividades ?? []);
      })
      .catch((err) => {
        console.error("No se pudo cargar el embudo:", err);
        setErrorCarga(err instanceof Error ? err.message : "No pudimos cargar el CRM.");
      })
      .finally(() => setCargando(false));
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  async function mover(oportunidad: Oportunidad, etapa: string) {
    if (moviendo) return;
    setMoviendo(oportunidad.id);
    setErrorCarga("");
    try {
      const respuesta = await fetch("/api/crm/oportunidades", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: oportunidad.id, etapa }),
      });
      const datos = await respuesta.json().catch(() => null);
      if (!respuesta.ok) throw new Error(datos?.error || "No se pudo actualizar la oportunidad.");
      await cargar();
    } catch (err) {
      setErrorCarga(err instanceof Error ? err.message : "No se pudo actualizar la oportunidad.");
    } finally {
      setMoviendo(null);
    }
  }

  if (sinModulo) {
    return (
      <div className="card">
        <div className="card-title">El CRM se contrata aparte</div>
        <p className="prose">
          Con el CRM, EOS lleva tu embudo de ventas y lo que quedó pendiente con cada cliente,
          sobre el mismo contexto que ya tiene de vos.
        </p>
        <a className="reco-btn" href="/planes" style={{ display: "inline-flex", marginTop: 12 }}>
          Ver cómo sumarlo
        </a>
      </div>
    );
  }

  if (cargando) return <p className="empty-note">Cargando tu embudo…</p>;

  if (errorCarga && oportunidades.length === 0) {
    return (
      <div className="card neg-empty-state" role="alert">
        <AlertCircle size={24} />
        <div>
          <div className="card-title">El CRM no pudo cargar</div>
          <p className="card-sub">Tus datos siguen guardados. Revisá la conexión e intentá nuevamente.</p>
        </div>
        <button type="button" className="reco-btn" onClick={() => void cargar()}>
          <RefreshCw size={14} /> Reintentar
        </button>
      </div>
    );
  }

  const abiertasTotales = embudos.reduce((t, e) => t + e.abiertas, 0);
  const variasMonedas = embudos.length > 1;

  // Los conteos por etapa se suman entre monedas: son cuántas hay, no plata.
  const etapas = (embudos[0]?.por_etapa ?? []).map((etapa) => ({
    ...etapa,
    cantidad: embudos.reduce(
      (t, e) => t + (e.por_etapa.find((x) => x.clave === etapa.clave)?.cantidad ?? 0),
      0,
    ),
  }));

  return (
    <>
      {abiertasTotales > 0 && (
        <div className="card">
          <div className="card-title">Tu embudo</div>
          <div className="card-sub">
            {abiertasTotales} {abiertasTotales === 1 ? "oportunidad abierta" : "oportunidades abiertas"}
            {variasMonedas && ` en ${embudos.length} monedas`}
          </div>

          {embudos.map((e) => (
            <div key={e.moneda}>
              {/* El nombre de la moneda solo aparece si hay más de una: con una
                  sola sería ruido, con dos es la diferencia entre entender y no. */}
              {variasMonedas && (
                <div className="card-sub" style={{ marginTop: 14, fontWeight: 600 }}>
                  {e.moneda}
                </div>
              )}

              <div className="kpi-grid" style={{ marginTop: 10 }}>
                <div className="kpi-card">
                  <div className="l">En juego</div>
                  <div className="v">{formatearMonto(e.en_juego, e.moneda)}</div>
                  <div className="d">suma de todo lo abierto</div>
                </div>
                <div className="kpi-card">
                  <div className="l">Esperado</div>
                  <div className="v">{formatearMonto(e.esperado, e.moneda)}</div>
                  <div className="d">ponderado por etapa</div>
                </div>
                <div className="kpi-card">
                  <div className="l">Ganado</div>
                  <div className="v">{formatearMonto(e.ganado, e.moneda)}</div>
                  <div className="d">
                    {e.ganadas} {e.ganadas === 1 ? "cerrada" : "cerradas"}
                  </div>
                </div>
              </div>
            </div>
          ))}

          {/* Una etapa vacía también informa: "no hay nada en propuesta"
              explica por qué el mes que viene va a estar flojo. */}
          <div className="neg-etapas">
            {etapas
              .filter((e) => e.clave !== "perdida")
              .map((e) => (
                <div className="neg-etapa" key={e.clave}>
                  <span className="neg-etapa-nombre">{e.etiqueta}</span>
                  <span className="neg-etapa-cantidad">{e.cantidad}</span>
                </div>
              ))}
          </div>
        </div>
      )}

      {errorCarga && <p className="neg-error" role="alert">{errorCarga}</p>}

      <NuevaOportunidad contactos={contactos} onCreada={() => void cargar()} />

      <div className="card">
        <div className="card-title">Oportunidades</div>

        {oportunidades.length === 0 ? (
          <div className="neg-empty-state">
            <Target size={28} />
            <div>
              <strong>Convertí una consulta en tu primera oportunidad</strong>
              <p>Registrá qué quiere comprar, el valor estimado y cuándo esperás cerrar. EOS te ayudará a no perder el seguimiento.</p>
            </div>
          </div>
        ) : (
          <div className="crm-pipeline" aria-label="Embudo de oportunidades">
            {["nueva", "contactado", "propuesta", "negociacion", "ganada", "perdida"].map((etapa) => {
              const deEtapa = oportunidades.filter((o) => o.etapa === etapa);
              return (
                <section className="crm-columna" key={etapa}>
                  <header>
                    <span>{etiquetaDeEtapa(etapa)}</span>
                    <strong>{deEtapa.length}</strong>
                  </header>
                  <div className="crm-columna-lista">
                  {deEtapa.length === 0 && <p className="crm-columna-vacia">Sin oportunidades</p>}
                  {deEtapa.map((o) => (
                    <article className="crm-oportunidad" key={o.id}>
                <div className="neg-fila-texto">
                  <strong>{o.titulo}</strong>
                  <small>
                    {o.contacto?.nombre ?? "Sin cliente"}
                  </small>
                </div>
                <strong className="neg-fila-monto">{formatearMonto(o.monto, o.moneda)}</strong>
                {o.cierre_estimado && (
                  <small className="crm-fecha"><CalendarDays size={12} /> {formatearFecha(o.cierre_estimado)}</small>
                )}

                {o.etapa !== "ganada" && o.etapa !== "perdida" && (
                  <div className="crm-acciones">
                    <button
                      type="button"
                      className="chip"
                      disabled={moviendo === o.id}
                      onClick={() => mover(o, siguienteEtapa(o.etapa))}
                      title={`Pasar a ${etiquetaDeEtapa(siguienteEtapa(o.etapa))}`}
                    >
                      {etiquetaDeEtapa(siguienteEtapa(o.etapa))}
                      <ChevronRight size={12} style={{ verticalAlign: -2 }} />
                    </button>
                    <button type="button" className="chip" onClick={() => mover(o, "perdida")}>
                      Perdida
                    </button>
                  </div>
                )}
                    </article>
                  ))}
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </div>

      <Agenda actividades={actividades} contactos={contactos} onCambio={() => void cargar()} />
    </>
  );
}

function NuevaOportunidad({
  contactos,
  onCreada,
}: {
  contactos: Contacto[];
  onCreada: () => void;
}) {
  const [abierto, setAbierto] = useState(false);
  const [titulo, setTitulo] = useState("");
  const [monto, setMonto] = useState("");
  const [detalle, setDetalle] = useState("");
  const [moneda, setMoneda] = useState("PYG");
  const [contactoId, setContactoId] = useState("");
  const [cierre, setCierre] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");

  async function guardar() {
    if (!titulo.trim() || guardando) return;

    setGuardando(true);
    setError("");

    try {
      const respuesta = await fetch("/api/crm/oportunidades", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          titulo,
          detalle,
          monto: Number(monto) || 0,
          moneda,
          contacto_id: contactoId || null,
          cierre_estimado: cierre || null,
        }),
      });

      const resultado = await respuesta.json().catch(() => null);
      if (!respuesta.ok) throw new Error(resultado?.error || "No se pudo guardar.");

      setTitulo("");
      setMonto("");
      setDetalle("");
      setCierre("");
      setAbierto(false);
      onCreada();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar.");
    } finally {
      setGuardando(false);
    }
  }

  if (!abierto) {
    return (
      <div className="card">
        <button type="button" className="reco-btn" onClick={() => setAbierto(true)}>
          <Plus size={14} /> Nueva oportunidad
        </button>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="card-title">Nueva oportunidad</div>

      <div className="neg-form">
        <label className="neg-field">
          <span>Oportunidad *</span>
        <input
          className="neg-input"
          placeholder="Qué se está negociando"
          value={titulo}
          maxLength={200}
          onChange={(e) => setTitulo(e.target.value)}
        />
        </label>
        <label className="neg-field neg-field-wide">
          <span>Detalle</span>
          <input className="neg-input" placeholder="Necesidad, alcance o próximo paso" value={detalle} maxLength={2000} onChange={(e) => setDetalle(e.target.value)} />
        </label>
        <label className="neg-field">
          <span>Valor estimado</span>
        <input
          className="neg-input"
          placeholder="Monto estimado"
          inputMode="numeric"
          value={monto}
          onChange={(e) => setMonto(e.target.value.replace(/[^\d]/g, ""))}
        />
        </label>
        <label className="neg-field neg-field-small">
          <span>Moneda</span>
          <select className="neg-input" value={moneda} onChange={(e) => setMoneda(e.target.value)}>
            <option value="PYG">Guaraníes</option><option value="USD">Dólares</option>
          </select>
        </label>
        <label className="neg-field">
          <span>Cliente</span>
        <select
          className="neg-input"
          value={contactoId}
          onChange={(e) => setContactoId(e.target.value)}
        >
          <option value="">Sin cliente</option>
          {contactos.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nombre}
            </option>
          ))}
        </select>
        </label>
        <label className="neg-field">
          <span>Cierre estimado</span>
        <input
          className="neg-input"
          type="date"
          value={cierre}
          onChange={(e) => setCierre(e.target.value)}
        />
        </label>
      </div>

      {error && <p className="neg-error">{error}</p>}

      <div className="chip-row">
        <button type="button" className="reco-btn" disabled={guardando} onClick={guardar}>
          {guardando ? "Guardando…" : "Agregar"}
        </button>
        <button type="button" className="chip" onClick={() => setAbierto(false)}>
          Cancelar
        </button>
      </div>
    </div>
  );
}

/**
 * Lo que se habló y lo que falta hacer, en una sola lista.
 *
 * El usuario no piensa en dos listas: piensa en "lo del cliente". Una llamada
 * que ya ocurrió y un "llamarlo el martes" son la misma cosa vista desde dos
 * momentos, y separarlas obliga a decidir dónde va cada apunte antes de
 * escribirlo — que es la decisión chiquita, repetida veinte veces por día, que
 * hace que la gente deje de anotar.
 */
function Agenda({
  actividades,
  contactos,
  onCambio,
}: {
  actividades: Actividad[];
  contactos: Contacto[];
  onCambio: () => void;
}) {
  const [detalle, setDetalle] = useState("");
  const [contactoId, setContactoId] = useState("");
  const [esTarea, setEsTarea] = useState(false);
  const [fecha, setFecha] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");

  async function guardar() {
    if (!detalle.trim() || guardando) return;

    setGuardando(true);
    setError("");

    try {
      const respuesta = await fetch("/api/crm/actividades", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          detalle,
          contacto_id: contactoId || null,
          tipo: esTarea ? "tarea" : "nota",
          fecha: fecha || undefined,
        }),
      });
      const datos = await respuesta.json().catch(() => null);
      if (!respuesta.ok) throw new Error(datos?.error || "No se pudo guardar el seguimiento.");

      setDetalle("");
      setFecha("");
      onCambio();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar el seguimiento.");
    } finally {
      setGuardando(false);
    }
  }

  async function marcar(actividad: Actividad) {
    setError("");
    const respuesta = await fetch("/api/crm/actividades", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: actividad.id, hecha: !actividad.hecha }),
    });
    if (respuesta.ok) onCambio();
    else setError("No se pudo actualizar la tarea. Intentá nuevamente.");
  }

  return (
    <div className="card">
      <div className="card-title">Seguimiento</div>
      <div className="card-sub">Lo que se habló, y lo que quedó pendiente.</div>

      <div className="neg-form">
        <input
          className="neg-input"
          placeholder={esTarea ? "Qué hay que hacer" : "Qué se habló"}
          value={detalle}
          maxLength={4000}
          onChange={(e) => setDetalle(e.target.value)}
        />
        <select
          className="neg-input"
          value={contactoId}
          onChange={(e) => setContactoId(e.target.value)}
        >
          <option value="">Sin cliente</option>
          {contactos.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nombre}
            </option>
          ))}
        </select>
        <label className="neg-check">
          <input
            type="checkbox"
            checked={esTarea}
            onChange={(e) => setEsTarea(e.target.checked)}
          />
          Es algo pendiente
        </label>
        {esTarea && (
          <input
            className="neg-input"
            type="date"
            value={fecha}
            onChange={(e) => setFecha(e.target.value)}
          />
        )}
        <button type="button" className="reco-btn" disabled={guardando} onClick={guardar}>
          {guardando ? "Guardando…" : "Anotar"}
        </button>
      </div>

      {error && <p className="neg-error" role="alert">{error}</p>}

      {actividades.length === 0 ? (
        <div className="neg-empty-state compact">
          <CalendarDays size={22} />
          <p>Anotá una conversación o programá el próximo paso para que ningún cliente quede sin respuesta.</p>
        </div>
      ) : (
        <div className="neg-lista">
          {actividades.map((a) => (
            <div className="neg-fila" key={a.id}>
              <button
                type="button"
                className={`p-check ${a.hecha ? "done" : ""}`}
                onClick={() => marcar(a)}
                aria-label={a.hecha ? "Marcar como pendiente" : "Marcar como hecha"}
              >
                {a.hecha && <Check size={12} />}
              </button>

              <div className="neg-fila-texto">
                <strong style={{ fontWeight: a.hecha ? 500 : 700 }}>{a.detalle}</strong>
                <small>
                  {a.contacto?.nombre ? `${a.contacto.nombre} · ` : ""}
                  {a.fecha}
                </small>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function formatearFecha(fecha: string) {
  const [anio, mes, dia] = fecha.split("-");
  return anio && mes && dia ? `${dia}/${mes}/${anio}` : fecha;
}
