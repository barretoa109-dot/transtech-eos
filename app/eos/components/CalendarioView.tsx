"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CalendarClock, CalendarDays, Check, ChevronLeft, ChevronRight, Plus, Undo2 } from "lucide-react";

import { hoyEnParaguay } from "@/lib/fecha";
import {
  ETIQUETAS,
  agruparPorDia,
  diasDeGrilla,
  mesDe,
  moverMes,
  type CategoriaAgenda,
  type EventoAgenda,
  type ResumenAgenda,
} from "@/lib/calendario/agenda";
import Confirmar from "./negocio/Confirmar";
import FormularioEvento, { type BorradorEvento } from "./calendario/FormularioEvento";

/**
 * El calendario: todo lo que tiene fecha, en un solo lugar.
 *
 * ============================================================
 * QUÉ JUNTA
 * ============================================================
 *
 * Lo que la persona anota a mano (citas, recordatorios, actividades,
 * seguimientos, trabajos) y lo que EOS ya sabe por las demás secciones: tareas y
 * cierres del CRM, cobros y pagos que vencen, ventas hechas, metas con fecha
 * límite, decisiones a revisar y las cuotas y tarjetas personales.
 *
 * Nada de eso se copia: la ruta `/api/calendario` lo lee de donde vive. Por eso
 * marcar una tarea como hecha desde acá la marca en el CRM, y al revés.
 *
 * ============================================================
 * QUÉ NO HACE TODAVÍA
 * ============================================================
 *
 * No avisa. Un recordatorio se ve en el resumen de arriba y en el calendario,
 * pero no llega como notificación ni como mensaje: eso necesita un envío
 * programado que hoy no existe para esto. Está dicho en pantalla para que nadie
 * confíe en que "EOS me va a avisar".
 */

const DIAS_SEMANA = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

/** En el orden en que se ofrecen como filtro. */
const CATEGORIAS: CategoriaAgenda[] = [
  "agenda", "recordatorio", "seguimiento", "actividad", "cobro", "pago", "meta", "trabajo",
];

/** Cuántos eventos se dibujan dentro de una celda antes de "+N". */
const POR_CELDA = 3;

type Respuesta = {
  hoy: string;
  desde: string;
  hasta: string;
  modulos: { crm: boolean; erp: boolean; finanzas: boolean };
  eventos: EventoAgenda[];
  atrasados: EventoAgenda[];
  proximos: EventoAgenda[];
  resumen: ResumenAgenda;
  fuentes_caidas: string[];
};

function nombreDelDia(iso: string): string {
  return new Intl.DateTimeFormat("es-PY", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  }).format(new Date(`${iso}T12:00:00Z`));
}

function fechaCorta(iso: string): string {
  return new Intl.DateTimeFormat("es-PY", { day: "numeric", month: "short", timeZone: "UTC" }).format(
    new Date(`${iso}T12:00:00Z`),
  );
}

function dinero(monto: number | null, moneda: string | null): string {
  if (monto === null) return "";
  const n = new Intl.NumberFormat("es-PY", { maximumFractionDigits: 2 }).format(monto);
  return !moneda || moneda === "PYG" ? `₲ ${n}` : `${moneda} ${n}`;
}

function horario(e: EventoAgenda): string {
  if (!e.hora) return "Todo el día";
  return e.hora_fin ? `${e.hora} – ${e.hora_fin}` : e.hora;
}

/**
 * El id con el que la API de `/api/calendario` reconoce el evento: los propios
 * viajan sin prefijo; las tareas que EOS anotó desde el chat, con `tarea:`.
 */
function idParaApi(e: EventoAgenda): string {
  return e.origen === "tareas" ? e.id : e.id.replace(/^propio:/, "");
}

/** Los que el calendario puede reabrir: los que son suyos o de las tareas del chat. */
function esReabrible(e: EventoAgenda): boolean {
  return e.origen === "propio" || e.origen === "tareas";
}

export default function CalendarioView({ onOpenChat }: { onOpenChat?: () => void }) {
  const hoyLocal = hoyEnParaguay();

  const [mes, setMes] = useState(() => mesDe(hoyLocal));
  const [seleccionado, setSeleccionado] = useState(hoyLocal);
  const [datos, setDatos] = useState<Respuesta | null>(null);
  const [error, setError] = useState("");
  // El mes (`anio-mes`) para el que ya hubo una respuesta, buena o mala. Con esto
  // "cargando" es una CUENTA y no otro estado que hay que acordarse de prender
  // y apagar: se está cargando cuando se mira un mes que todavía no contestó.
  const [listoPara, setListoPara] = useState<string | null>(null);
  const [ocultas, setOcultas] = useState<Set<CategoriaAgenda>>(new Set());
  const [formulario, setFormulario] = useState<BorradorEvento | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [errorAccion, setErrorAccion] = useState("");

  // Si el usuario cambia de mes rápido, una respuesta lenta del mes anterior no
  // tiene que pisar la del actual.
  const pedido = useRef(0);

  const cargar = useCallback((anio: number, mesNumero: number) => {
    const numero = ++pedido.current;
    const grilla = diasDeGrilla(anio, mesNumero);

    // Con `.then` y no con `await`: es la forma en que el resto de las pantallas
    // cargan desde un efecto, y la que la regla de React sabe que no dispara
    // `setState` dentro del propio efecto.
    return fetch(`/api/calendario?desde=${grilla[0]}&hasta=${grilla[grilla.length - 1]}`, {
      cache: "no-store",
    })
      .then(async (respuesta) => {
        if (respuesta.status === 401) throw new Error("SESSION_EXPIRED");
        if (!respuesta.ok) throw new Error("CALENDAR_UNAVAILABLE");

        const cuerpo = (await respuesta.json()) as Respuesta;
        if (numero !== pedido.current) return;

        setDatos(cuerpo);
        setError("");
      })
      .catch((err) => {
        if (numero !== pedido.current) return;

        console.error("No se pudo cargar el calendario:", err);
        setError(
          err instanceof Error && err.message === "SESSION_EXPIRED"
            ? "Tu sesión venció. Volvé a iniciar sesión para ver tu calendario."
            : "No pudimos cargar tu calendario. No lo mostramos vacío porque podría tener cosas: reintentá la carga.",
        );
      })
      .finally(() => {
        if (numero === pedido.current) setListoPara(`${anio}-${mesNumero}`);
      });
  }, []);

  useEffect(() => {
    void cargar(mes.anio, mes.mes);
  }, [cargar, mes]);

  const cargando = listoPara !== `${mes.anio}-${mes.mes}`;

  const hoy = datos?.hoy ?? hoyLocal;

  const visibles = useMemo(
    () => (datos?.eventos ?? []).filter((e) => !ocultas.has(e.categoria)),
    [datos, ocultas],
  );
  const porDia = useMemo(() => agruparPorDia(visibles), [visibles]);
  const dias = useMemo(() => diasDeGrilla(mes.anio, mes.mes), [mes]);

  const delDia = porDia.get(seleccionado) ?? [];

  /** Cuántos eventos hay de cada categoría en la grilla: para los filtros. */
  const conteo = useMemo(() => {
    const c = new Map<CategoriaAgenda, number>();
    for (const e of datos?.eventos ?? []) c.set(e.categoria, (c.get(e.categoria) ?? 0) + 1);
    return c;
  }, [datos]);

  function irAMes(delta: number) {
    const siguiente = moverMes(mes.anio, mes.mes, delta);
    setMes(siguiente);
    setSeleccionado(`${siguiente.anio}-${String(siguiente.mes).padStart(2, "0")}-01`);
  }

  function irAHoy() {
    setMes(mesDe(hoy));
    setSeleccionado(hoy);
  }

  function irAlDia(fecha: string) {
    const destino = mesDe(fecha);
    if (destino.anio !== mes.anio || destino.mes !== mes.mes) setMes(destino);
    setSeleccionado(fecha);
  }

  function alternarCategoria(c: CategoriaAgenda) {
    setOcultas((previas) => {
      const nuevas = new Set(previas);
      if (nuevas.has(c)) nuevas.delete(c);
      else nuevas.add(c);
      return nuevas;
    });
  }

  function nuevoEvento(fecha: string) {
    setFormulario({
      titulo: "",
      categoria: "agenda",
      fecha,
      hora_inicio: "",
      hora_fin: "",
      contacto_nombre: "",
      detalle: "",
    });
  }

  function editar(e: EventoAgenda) {
    setFormulario({
      id: idParaApi(e),
      esTarea: e.origen === "tareas",
      titulo: e.titulo,
      categoria: e.categoria as BorradorEvento["categoria"],
      fecha: e.fecha,
      hora_inicio: e.hora ?? "",
      hora_fin: e.hora_fin ?? "",
      contacto_nombre: e.contacto ?? "",
      detalle: e.detalle ?? "",
    });
  }

  async function llamar(clave: string, peticion: () => Promise<Response>) {
    setOcupado(clave);
    setErrorAccion("");

    try {
      const respuesta = await peticion();
      if (!respuesta.ok) {
        const cuerpo = await respuesta.json().catch(() => null);
        throw new Error(cuerpo?.error || "No se pudo completar la acción.");
      }
      await cargar(mes.anio, mes.mes);
    } catch (err) {
      setErrorAccion(err instanceof Error ? err.message : "No se pudo completar la acción.");
    } finally {
      setOcupado(null);
    }
  }

  function cambiarEstado(e: EventoAgenda, estado: "hecho" | "pendiente") {
    if (esReabrible(e)) {
      return llamar(e.id, () =>
        fetch("/api/calendario", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: idParaApi(e), estado }),
        }),
      );
    }

    // Una tarea del CRM se completa con el mismo PATCH que usa el CRM: es la
    // misma fila, y así los dos lugares no pueden discrepar.
    return llamar(e.id, () =>
      fetch("/api/crm/actividades", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: e.id.replace(/^crm:/, ""), hecha: true }),
      }),
    );
  }

  function borrar(e: EventoAgenda) {
    return llamar(e.id, () =>
      fetch(`/api/calendario?id=${encodeURIComponent(idParaApi(e))}`, { method: "DELETE" }),
    );
  }

  const sinNada = !cargando && !error && datos !== null && datos.eventos.length === 0;

  return (
    <div className="view" id="view-calendario">
      <div className="page page-in">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
          <div className="page-header">
            <div className="page-eyebrow">Calendario</div>
            <div className="page-title">Tu agenda</div>
            <div className="page-sub">
              Citas, recordatorios, seguimientos, cobros, pagos y trabajos realizados, todo en un solo lugar.
            </div>
          </div>
          <div className="cal-encabezado-acciones">
            <button type="button" className="reco-btn" onClick={() => nuevoEvento(seleccionado)}>
              <Plus size={14} /> Nuevo evento
            </button>
            {onOpenChat && (
              <button type="button" className="ghost-btn" onClick={onOpenChat}>
                Preguntale a EOS
              </button>
            )}
          </div>
        </div>

        {error && (
          <div className="neg-load-error" role="alert">
            <div>
              <strong>No mostramos vacío si no pudimos verificar los datos</strong>
              <p>{error}</p>
              <button
                type="button"
                className="chip"
                onClick={() => {
                  setError("");
                  void cargar(mes.anio, mes.mes);
                }}
              >
                Reintentar
              </button>
            </div>
          </div>
        )}

        {datos && datos.fuentes_caidas.length > 0 && (
          <div className="neg-load-error" role="status">
            <div>
              <strong>Falta información en tu calendario</strong>
              <p>
                No pudimos leer: {datos.fuentes_caidas.join(", ")}. Lo que ves puede estar incompleto; no significa que
                no haya nada.
              </p>
            </div>
          </div>
        )}

        {datos && (
          <div className="cal-resumen" aria-label="Resumen de tu agenda">
            <div className={`cal-resumen-card${datos.resumen.atrasados > 0 ? " es-alerta" : ""}`}>
              <AlertTriangle size={16} />
              <span>Atrasado</span>
              <strong>{datos.resumen.atrasados}</strong>
              <small>{datos.resumen.atrasados === 1 ? "pendiente vencido" : "pendientes vencidos"}</small>
            </div>
            <div className="cal-resumen-card">
              <CalendarClock size={16} />
              <span>Hoy</span>
              <strong>{datos.resumen.hoy}</strong>
              <small>{datos.resumen.hoy === 1 ? "cosa por hacer" : "cosas por hacer"}</small>
            </div>
            <div className="cal-resumen-card">
              <CalendarDays size={16} />
              <span>Próximos 7 días</span>
              <strong>{datos.resumen.proximos7}</strong>
              <small>{datos.resumen.proximos7 === 1 ? "cosa por hacer" : "cosas por hacer"}</small>
            </div>
          </div>
        )}

        {errorAccion && (
          <p className="neg-error" role="alert">
            {errorAccion}
          </p>
        )}

        {formulario && (
          <FormularioEvento
            key={formulario.id ?? "nuevo"}
            inicial={formulario}
            onCancelar={() => setFormulario(null)}
            onGuardado={(fecha) => {
              setFormulario(null);
              setSeleccionado(fecha);

              // Si el evento cae en otro mes, cambiar de mes ya dispara la carga.
              const destino = mesDe(fecha);
              if (destino.anio !== mes.anio || destino.mes !== mes.mes) setMes(destino);
              else void cargar(mes.anio, mes.mes);
            }}
          />
        )}

        <div className="card cal-card">
          <div className="cal-barra">
            <div className="cal-nav">
              <button type="button" className="cal-nav-btn" onClick={() => irAMes(-1)} aria-label="Mes anterior">
                <ChevronLeft size={16} />
              </button>
              <h2 className="cal-mes" aria-live="polite">
                {MESES[mes.mes - 1]} de {mes.anio}
              </h2>
              <button type="button" className="cal-nav-btn" onClick={() => irAMes(1)} aria-label="Mes siguiente">
                <ChevronRight size={16} />
              </button>
            </div>
            <button type="button" className="chip" onClick={irAHoy}>
              Hoy
            </button>
          </div>

          <div className="cal-filtros" role="group" aria-label="Qué mostrar">
            {// Solo las que tienen algo, más las que se apagaron (para poder prenderlas de nuevo).
            CATEGORIAS.filter((c) => (conteo.get(c) ?? 0) > 0 || ocultas.has(c)).map((c) => (
              <button
                key={c}
                type="button"
                className={`cal-filtro cat-${c}${ocultas.has(c) ? " apagado" : ""}`}
                aria-pressed={!ocultas.has(c)}
                onClick={() => alternarCategoria(c)}
              >
                <span className="cal-punto" aria-hidden="true" />
                {ETIQUETAS[c]}
                <small>{conteo.get(c) ?? 0}</small>
              </button>
            ))}
          </div>

          {cargando && !datos ? (
            <p className="empty-note">Cargando tu calendario…</p>
          ) : (
            <>
              <div className="cal-semana" aria-hidden="true">
                {DIAS_SEMANA.map((d) => (
                  <span key={d}>{d}</span>
                ))}
              </div>

              <div className={`cal-grilla${cargando ? " cargando" : ""}`} role="grid" aria-label="Calendario del mes">
                {dias.map((dia) => {
                  const lista = porDia.get(dia) ?? [];
                  const delMes = mesDe(dia).mes === mes.mes;
                  const clases = [
                    "cal-dia",
                    delMes ? "" : "fuera",
                    dia === hoy ? "es-hoy" : "",
                    dia === seleccionado ? "es-seleccionado" : "",
                  ]
                    .filter(Boolean)
                    .join(" ");

                  const atrasoEnElDia = lista.some((e) => e.estado === "pendiente" && e.fecha < hoy);

                  return (
                    <button
                      key={dia}
                      type="button"
                      role="gridcell"
                      className={clases}
                      onClick={() => setSeleccionado(dia)}
                      aria-label={`${nombreDelDia(dia)}: ${lista.length} ${lista.length === 1 ? "evento" : "eventos"}`}
                      aria-selected={dia === seleccionado}
                    >
                      <span className="cal-num">{Number(dia.slice(8))}</span>
                      <span className="cal-chips">
                        {lista.slice(0, POR_CELDA).map((e) => (
                          <span
                            key={e.id}
                            className={`cal-chip cat-${e.categoria}${e.estado !== "pendiente" ? " terminado" : ""}${
                              atrasoEnElDia && e.estado === "pendiente" ? " atrasado" : ""
                            }`}
                          >
                            {e.titulo}
                          </span>
                        ))}
                        {lista.length > POR_CELDA && <span className="cal-mas">+{lista.length - POR_CELDA}</span>}
                      </span>
                      {lista.length > 0 && (
                        <span className="cal-puntos" aria-hidden="true">
                          {lista.slice(0, 4).map((e) => (
                            <span key={e.id} className={`cal-punto cat-${e.categoria}`} />
                          ))}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>

        {sinNada && (
          <p className="empty-note">
            No hay nada agendado en este mes. Podés sumar un evento con “Nuevo evento”, o pedírselo a EOS en el
            chat.
          </p>
        )}

        <div className="cal-columnas">
          <div className="card">
            <div className="cal-titulo-dia">
              <div>
                <div className="card-title cal-dia-titulo">
                  {nombreDelDia(seleccionado)}
                </div>
                <div className="card-sub">
                  {delDia.length === 0
                    ? "Sin eventos este día."
                    : `${delDia.length} ${delDia.length === 1 ? "evento" : "eventos"}`}
                </div>
              </div>
              <button type="button" className="chip" onClick={() => nuevoEvento(seleccionado)}>
                <Plus size={12} /> Agregar
              </button>
            </div>

            {delDia.length > 0 && (
              <ul className="cal-lista">
                {delDia.map((e) => (
                  <FilaEvento
                    key={e.id}
                    evento={e}
                    hoy={hoy}
                    ocupado={ocupado === e.id}
                    onCambiarEstado={cambiarEstado}
                    onEditar={editar}
                    onBorrar={borrar}
                  />
                ))}
              </ul>
            )}
          </div>

          <div className="cal-lateral">
            {datos && datos.atrasados.length > 0 && (
              <div className="card cal-alerta">
                <div className="card-title">Atrasado</div>
                <div className="card-sub">Quedó pendiente y su día ya pasó.</div>
                <ul className="cal-lista compacta">
                  {datos.atrasados.slice(0, 8).map((e) => (
                    <li key={e.id}>
                      <button type="button" className="cal-salto" onClick={() => irAlDia(e.fecha)}>
                        <span className={`cal-punto cat-${e.categoria}`} aria-hidden="true" />
                        <span className="cal-salto-titulo">{e.titulo}</span>
                        <small>{fechaCorta(e.fecha)}</small>
                      </button>
                    </li>
                  ))}
                </ul>
                {datos.atrasados.length > 8 && (
                  <p className="empty-note">Y {datos.atrasados.length - 8} más.</p>
                )}
              </div>
            )}

            <div className="card">
              <div className="card-title">Lo que viene</div>
              <div className="card-sub">Hoy y los próximos 7 días.</div>
              {datos && datos.proximos.length > 0 ? (
                <ul className="cal-lista compacta">
                  {datos.proximos.slice(0, 10).map((e) => (
                    <li key={e.id}>
                      <button type="button" className="cal-salto" onClick={() => irAlDia(e.fecha)}>
                        <span className={`cal-punto cat-${e.categoria}`} aria-hidden="true" />
                        <span className="cal-salto-titulo">{e.titulo}</span>
                        <small>{e.fecha === hoy ? "Hoy" : fechaCorta(e.fecha)}</small>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="empty-note">No tenés nada pendiente para esta semana.</p>
              )}
            </div>
          </div>
        </div>

        <p className="cal-nota">
          Los recordatorios se ven acá y en el resumen de arriba; todavía no te llegan como aviso al celular ni por
          mensaje.
        </p>
      </div>
    </div>
  );
}

function FilaEvento({
  evento: e,
  hoy,
  ocupado,
  onCambiarEstado,
  onEditar,
  onBorrar,
}: {
  evento: EventoAgenda;
  hoy: string;
  ocupado: boolean;
  onCambiarEstado: (e: EventoAgenda, estado: "hecho" | "pendiente") => void;
  onEditar: (e: EventoAgenda) => void;
  onBorrar: (e: EventoAgenda) => void;
}) {
  const atrasado = e.estado === "pendiente" && e.fecha < hoy;
  // Se marca hecho lo pendiente que se pueda completar (los propios, las tareas del
  // chat y las del CRM); se reabre lo hecho que sea propio o del chat. Una tarea del
  // CRM ya hecha no se reabre desde acá: eso es una decisión del CRM.
  const puedeHecho = e.estado === "pendiente" && e.completable;
  const puedeReabrir = e.estado === "hecho" && esReabrible(e);

  return (
    <li className={`cal-item cat-${e.categoria}${e.estado !== "pendiente" ? " terminado" : ""}`}>
      <div className="cal-item-cuerpo">
        <div className="cal-item-meta">
          <span className={`cal-etiqueta cat-${e.categoria}`}>{ETIQUETAS[e.categoria]}</span>
          <span>{horario(e)}</span>
          {atrasado && <span className="cal-atrasado">Atrasado</span>}
          {e.estado === "hecho" && <span className="cal-hecho">Hecho</span>}
          {e.estado === "cancelado" && <span>Cancelado</span>}
        </div>

        <div className="cal-item-titulo">{e.titulo}</div>

        {(e.contacto || e.monto !== null) && (
          <div className="cal-item-sub">
            {e.contacto && <span>{e.contacto}</span>}
            {e.monto !== null && <strong>{dinero(e.monto, e.moneda)}</strong>}
          </div>
        )}

        {e.detalle && <div className="cal-item-detalle">{e.detalle}</div>}
      </div>

      <div className="cal-item-acciones">
        {puedeReabrir && (
          <button type="button" className="chip" disabled={ocupado} onClick={() => onCambiarEstado(e, "pendiente")}>
            <Undo2 size={12} /> Reabrir
          </button>
        )}

        {puedeHecho && (
          <button type="button" className="chip" disabled={ocupado} onClick={() => onCambiarEstado(e, "hecho")}>
            <Check size={12} /> Hecho
          </button>
        )}

        {e.editable && (
          <>
            <button type="button" className="chip" disabled={ocupado} onClick={() => onEditar(e)}>
              Editar
            </button>
            <Confirmar
              etiqueta="Borrar"
              consecuencia={`Se borra “${e.titulo}” del calendario. No se puede deshacer.`}
              confirmar="Borrar evento"
              peligro
              ocupado={ocupado}
              onConfirmar={() => onBorrar(e)}
            />
          </>
        )}
      </div>
    </li>
  );
}
