"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Plus, Repeat, X } from "lucide-react";

import { formatearMonto } from "@/lib/finanzas/formato";
import { numeroEscrito } from "@/lib/finanzas/gastoRapido";
import type { EstadoFijo } from "@/lib/finanzas/estado-fijo";
import Confirmar from "./negocio/Confirmar";
import { useEtiquetaEspacio } from "./EspacioContext";

/**
 * Fijos y recurrentes (05/10/2026), para Personal y para el negocio.
 *
 * Antes vivían en el engranaje de Ajustes de Personal, y los del negocio no
 * tenían pantalla: el chat los guardaba y entraban en la rentabilidad, pero
 * nadie los podía ver ni corregir. Ahora son una entrada del menú en los dos
 * espacios, cada uno con los suyos (`ambito`).
 *
 * La pantalla separa tres cosas que antes eran una sola línea:
 *   - el CONCEPTO: lo que se espera (internet, día 10, ₲ 230.000);
 *   - el VENCIMIENTO de este mes, que existe aunque nadie haya hecho nada;
 *   - el PAGO registrado, que recién ahí cuenta como plata que salió o entró.
 *
 * Registrar el pago crea un movimiento atado al fijo y al mes (v232). Si el
 * monto de ese mes fue otro —la luz nunca viene igual—, se corrige antes de
 * confirmar.
 */

type Ambito = "personal" | "negocio";

type Fijo = {
  id: string;
  tipo: "ingreso" | "gasto";
  descripcion: string;
  monto: number;
  moneda: string | null;
  dia_del_mes: number;
  estado?: EstadoFijo;
};

type Borrador = { id: string | null; tipo: "ingreso" | "gasto"; descripcion: string; monto: string; dia_del_mes: string };

const VACIO: Borrador = { id: null, tipo: "gasto", descripcion: "", monto: "", dia_del_mes: "" };

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

function diaMes(iso: string): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
}

function cuandoTexto(dias: number): string {
  if (dias === 0) return "hoy";
  if (dias === 1) return "mañana";
  if (dias > 1) return `en ${dias} días`;
  if (dias === -1) return "ayer";
  return `hace ${-dias} días`;
}

export default function FijosView({ ambito }: { ambito: Ambito }) {
  const etiquetaEspacio = useEtiquetaEspacio();
  const [fijos, setFijos] = useState<Fijo[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [editando, setEditando] = useState(false);
  const [borradores, setBorradores] = useState<Borrador[]>([]);
  const [guardando, setGuardando] = useState(false);
  const [errorEdicion, setErrorEdicion] = useState("");
  /** El fijo cuyo pago se está registrando, con el monto que se va a anotar. */
  const [pagando, setPagando] = useState<{ id: string; monto: string } | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [aviso, setAviso] = useState("");

  const personal = ambito === "personal";

  const cargar = useCallback(async () => {
    try {
      const r = await fetch(`/api/finanzas/fijos?ambito=${ambito}`, { cache: "no-store" });
      const datos = await r.json().catch(() => null);
      if (!r.ok) throw new Error(datos?.error || "No pudimos cargar los fijos.");
      setFijos((datos?.fijos ?? []) as Fijo[]);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "No pudimos cargar los fijos.");
    } finally {
      setCargando(false);
    }
  }, [ambito]);

  useEffect(() => {
    const timeout = window.setTimeout(() => void cargar(), 0);
    return () => window.clearTimeout(timeout);
  }, [cargar]);

  useEffect(() => {
    if (!aviso) return;
    const t = window.setTimeout(() => setAviso(""), 4000);
    return () => window.clearTimeout(t);
  }, [aviso]);

  function empezarEdicion() {
    setBorradores(
      fijos.length > 0
        ? fijos.map((f) => ({
            id: f.id,
            tipo: f.tipo,
            descripcion: f.descripcion,
            monto: String(f.monto),
            dia_del_mes: String(f.dia_del_mes),
          }))
        : [{ ...VACIO }],
    );
    setErrorEdicion("");
    setEditando(true);
  }

  async function guardarEdicion() {
    const lista = [];
    for (const b of borradores) {
      if (!b.descripcion.trim() && !b.monto.trim()) continue;
      const monto = numeroEscrito(b.monto);
      const dia = Number(b.dia_del_mes);
      if (b.descripcion.trim().length < 2 || !monto || monto <= 0 || !Number.isInteger(dia) || dia < 1 || dia > 31) {
        setErrorEdicion("Cada fijo necesita un nombre, un monto mayor a cero y un día del mes entre 1 y 31.");
        return;
      }
      lista.push({ id: b.id, tipo: b.tipo, descripcion: b.descripcion.trim(), monto, dia_del_mes: dia });
    }

    setGuardando(true);
    setErrorEdicion("");
    try {
      const r = await fetch("/api/finanzas/fijos", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ambito, fijos: lista }),
      });
      const datos = await r.json().catch(() => null);
      if (!r.ok) throw new Error(datos?.error || "No pudimos guardar los fijos.");
      setEditando(false);
      setAviso("Fijos guardados.");
      await cargar();
    } catch (e) {
      setErrorEdicion(e instanceof Error ? e.message : "No pudimos guardar los fijos.");
    } finally {
      setGuardando(false);
    }
  }

  async function registrarPago(fijo: Fijo, montoTexto: string) {
    const monto = numeroEscrito(montoTexto);
    if (!monto || monto <= 0) {
      setAviso("Escribí el monto que pagaste.");
      return;
    }
    setOcupado(fijo.id);
    try {
      const r = await fetch(`/api/finanzas/fijos/${fijo.id}/pago?ambito=${ambito}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ monto, periodo: fijo.estado?.periodo }),
      });
      const datos = await r.json().catch(() => null);
      if (!r.ok) throw new Error(datos?.error || "No pudimos registrar el pago.");
      setPagando(null);
      setAviso(
        fijo.tipo === "ingreso"
          ? `Cobro de ${fijo.descripcion} registrado.`
          : `Pago de ${fijo.descripcion} registrado. Ya figura en ${personal ? "Ingresos y gastos" : "los gastos del negocio"}.`,
      );
      await cargar();
    } catch (e) {
      setAviso(e instanceof Error ? e.message : "No pudimos registrar el pago.");
    } finally {
      setOcupado(null);
    }
  }

  async function deshacerPago(fijo: Fijo) {
    if (!fijo.estado?.pago) return;
    setOcupado(fijo.id);
    try {
      const r = await fetch(`/api/finanzas/fijos/${fijo.id}/pago?ambito=${ambito}&periodo=${fijo.estado.pago.periodo}`, {
        method: "DELETE",
      });
      const datos = await r.json().catch(() => null);
      if (!r.ok) throw new Error(datos?.error || "No pudimos deshacer el pago.");
      setAviso("Listo, se sacó el registro de ese mes.");
      await cargar();
    } catch (e) {
      setAviso(e instanceof Error ? e.message : "No pudimos deshacer el pago.");
    } finally {
      setOcupado(null);
    }
  }

  const ingresos = fijos.filter((f) => f.tipo === "ingreso");
  const gastos = fijos.filter((f) => f.tipo === "gasto");
  const moneda = fijos[0]?.moneda ?? "PYG";
  const total = (lista: Fijo[]) => lista.reduce((a, f) => a + f.monto, 0);
  const hecho = (lista: Fijo[]) =>
    lista.reduce((a, f) => a + (f.estado?.pago ? f.estado.pago.monto : 0), 0);
  const nombreMes = fijos[0]?.estado ? MESES[Number(fijos[0].estado.periodo.slice(5, 7)) - 1] : "";

  function fila(f: Fijo) {
    const e = f.estado;
    const verbo = f.tipo === "ingreso" ? "cobro" : "pago";
    let vencimiento = null;

    if (e) {
      if (e.pago) {
        vencimiento = (
          <>
            <span className="neg-pill is-ok">
              <Check size={12} /> {verbo === "cobro" ? "Cobro" : "Pago"} registrado {diaMes(e.pago.fecha)}
            </span>
            <small>{formatearMonto(e.pago.monto, f.moneda ?? moneda)}</small>
          </>
        );
      } else if (e.estado === "vencido") {
        vencimiento = (
          <>
            <span className="neg-pill is-mal">
              Venció {diaMes(e.vence_el)} · {cuandoTexto(e.dias)}
            </span>
            <small>Sin {verbo} registrado este mes</small>
          </>
        );
      } else if (e.estado === "pendiente") {
        vencimiento = (
          <>
            <span className="neg-pill is-av">
              {f.tipo === "ingreso" ? "Se cobra" : "Vence"} {diaMes(e.vence_el)} · {cuandoTexto(e.dias)}
            </span>
            <small>Todavía no se registró el {verbo}</small>
          </>
        );
      } else {
        vencimiento = (
          <>
            <span className="neg-pill is-neutro">
              Próximo: {diaMes(e.vence_el)} · {cuandoTexto(e.dias)}
            </span>
            <small>Todavía no corresponde</small>
          </>
        );
      }
    }

    return (
      <div className="fijo-fila" key={f.id}>
        <div className="fijo-concepto">
          <span className="fijo-ic" aria-hidden="true">
            <Repeat size={15} />
          </span>
          <span>
            <b>{f.descripcion}</b>
            <small>
              {f.tipo === "ingreso" ? "Ingreso fijo" : "Gasto fijo"} · cada mes, día {f.dia_del_mes}
            </small>
          </span>
        </div>
        <div className="fijo-monto">
          <small>Esperado</small>
          <span className={f.tipo === "ingreso" ? "is-ingreso" : ""}>{formatearMonto(f.monto, f.moneda ?? moneda)}</span>
        </div>
        <div className="fijo-vence">{vencimiento}</div>
        {e && (
          <div className="fijo-historial" aria-label="Últimos tres meses">
            {e.historial.map((h) => (
              <span key={h.periodo} title={h.marca === "sin_registro" ? "Sin pago atado a este fijo" : undefined}>
                <i className={`fijo-punto is-${h.marca}`} />
                {MESES[Number(h.periodo.slice(5, 7)) - 1]}
              </span>
            ))}
          </div>
        )}
        <div className="fijo-accion">
          {e?.pago ? (
            <Confirmar
              etiqueta="Deshacer"
              consecuencia={`Se saca el ${verbo} de ${f.descripcion} de este mes. El fijo queda igual.`}
              confirmar={`Sí, sacar el ${verbo}`}
              ocupado={ocupado === f.id}
              onConfirmar={() => void deshacerPago(f)}
            />
          ) : pagando?.id === f.id ? null : (
            <button
              type="button"
              className="btn-sec"
              disabled={ocupado !== null}
              onClick={() => setPagando({ id: f.id, monto: String(f.monto) })}
            >
              Registrar {verbo}
            </button>
          )}
        </div>

        {pagando?.id === f.id && (
          <div className="fijo-pagar">
            <label>
              <span>Monto {f.tipo === "ingreso" ? "cobrado" : "pagado"}</span>
              <input
                className="neg-input"
                inputMode="decimal"
                autoFocus
                value={pagando.monto}
                onChange={(ev) => setPagando({ id: f.id, monto: ev.target.value })}
                onKeyDown={(ev) => {
                  if (ev.key === "Enter") void registrarPago(f, pagando.monto);
                  if (ev.key === "Escape") setPagando(null);
                }}
              />
            </label>
            <button
              type="button"
              className="btn-pri"
              disabled={ocupado === f.id}
              onClick={() => void registrarPago(f, pagando.monto)}
            >
              {ocupado === f.id ? "Registrando…" : `Registrar ${verbo} de hoy`}
            </button>
            <button type="button" className="chip" onClick={() => setPagando(null)}>
              Cancelar
            </button>
          </div>
        )}
      </div>
    );
  }

  function tabla(titulo: string, lista: Fijo[]) {
    if (lista.length === 0) return null;
    return (
      <div className="card fijos-card">
        <div className="card-title">{titulo}</div>
        <div className="fijo-cab" aria-hidden="true">
          <span>Concepto</span>
          <span>Monto</span>
          <span>Este mes</span>
          <span>Últimos 3</span>
          <span />
        </div>
        {lista.map(fila)}
      </div>
    );
  }

  return (
    <div className="view" id={`view-fijos-${ambito}`}>
      <div className="page page-in">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
          <div className="page-header">
            <div className="page-eyebrow">{etiquetaEspacio}</div>
            <div className="page-title">Fijos y recurrentes</div>
            <div className="page-sub">
              {personal
                ? "Lo que se repite todos los meses: lo que cobrás y lo que pagás."
                : "Lo que el negocio paga o cobra todos los meses, aparte de las ventas y compras del día a día."}
            </div>
          </div>
          {!editando && !cargando && !error && (
            <button type="button" className="btn-pri" style={{ flexShrink: 0 }} onClick={empezarEdicion}>
              {fijos.length === 0 ? (
                <>
                  <Plus size={14} /> Nuevo fijo
                </>
              ) : (
                "Editar fijos"
              )}
            </button>
          )}
        </div>

        <div className="fijos-leyenda">
          <div>
            <span className="fijo-ic" aria-hidden="true">
              <Repeat size={15} />
            </span>
            <span>
              <b>El concepto</b>
              <small>Lo que se repite. No es un pago: es lo que esperás.</small>
            </span>
          </div>
          <div>
            <span className="neg-pill is-av">Vence</span>
            <span>
              <b>El vencimiento</b>
              <small>Cuándo toca este mes. Queda abierto hasta que se registre.</small>
            </span>
          </div>
          <div>
            <span className="neg-pill is-ok">
              <Check size={12} />
            </span>
            <span>
              <b>El pago registrado</b>
              <small>Lo que de verdad salió o entró. Recién ahí cuenta.</small>
            </span>
          </div>
        </div>

        {aviso && (
          <p className="neg-inline-success fijos-aviso" role="status">
            {aviso}
          </p>
        )}

        {cargando ? (
          <p className="empty-note">Cargando tus fijos…</p>
        ) : error ? (
          <div className="card">
            <p className="neg-error" role="alert">
              {error}
            </p>
            <button type="button" className="chip" onClick={() => void cargar()}>
              Reintentar
            </button>
          </div>
        ) : editando ? (
          <div className="card">
            <div className="card-title">{fijos.length === 0 ? "Nuevo fijo" : "Editar fijos"}</div>
            <div className="card-sub">
              Agregar un fijo no anota ningún {personal ? "gasto" : "pago"}: solo le dice a EOS qué esperar y cuándo.
            </div>

            <div className="fijos-editor">
              {borradores.map((b, i) => (
                <div className="fijos-editor-fila" key={b.id ?? `nuevo-${i}`}>
                  <select
                    className="neg-input"
                    aria-label="Gasto o ingreso"
                    value={b.tipo}
                    onChange={(e) =>
                      setBorradores((l) => l.map((x, j) => (j === i ? { ...x, tipo: e.target.value as Borrador["tipo"] } : x)))
                    }
                  >
                    <option value="gasto">Gasto</option>
                    <option value="ingreso">Ingreso</option>
                  </select>
                  <input
                    className="neg-input"
                    aria-label="Nombre"
                    placeholder={personal ? "Ej.: internet, telefonía, alquiler que cobrás" : "Ej.: alquiler del local, internet"}
                    value={b.descripcion}
                    maxLength={120}
                    onChange={(e) =>
                      setBorradores((l) => l.map((x, j) => (j === i ? { ...x, descripcion: e.target.value } : x)))
                    }
                  />
                  <input
                    className="neg-input"
                    aria-label="Monto de cada mes"
                    placeholder="Monto"
                    inputMode="decimal"
                    value={b.monto}
                    onChange={(e) => setBorradores((l) => l.map((x, j) => (j === i ? { ...x, monto: e.target.value } : x)))}
                  />
                  <input
                    className="neg-input"
                    aria-label="Día del mes"
                    placeholder="Día"
                    inputMode="numeric"
                    value={b.dia_del_mes}
                    onChange={(e) =>
                      setBorradores((l) =>
                        l.map((x, j) => (j === i ? { ...x, dia_del_mes: e.target.value.replace(/\D/g, "").slice(0, 2) } : x)),
                      )
                    }
                  />
                  <button
                    type="button"
                    className="mas-btn"
                    aria-label={`Quitar ${b.descripcion || "este fijo"}`}
                    onClick={() => setBorradores((l) => l.filter((_, j) => j !== i))}
                  >
                    <X size={15} />
                  </button>
                </div>
              ))}
            </div>

            <button
              type="button"
              className="chip"
              style={{ marginTop: 10 }}
              onClick={() => setBorradores((l) => [...l, { ...VACIO }])}
            >
              <Plus size={12} /> Agregar otro
            </button>

            {errorEdicion && (
              <p className="neg-error" role="alert">
                {errorEdicion}
              </p>
            )}

            <div className="chip-row" style={{ marginTop: 14, marginBottom: 0 }}>
              <button type="button" className="btn-pri" disabled={guardando} onClick={() => void guardarEdicion()}>
                {guardando ? "Guardando…" : "Guardar"}
              </button>
              <button type="button" className="chip" disabled={guardando} onClick={() => setEditando(false)}>
                Cancelar
              </button>
            </div>
          </div>
        ) : fijos.length === 0 ? (
          <div className="card">
            <div className="card-title">Todavía no hay fijos {personal ? "tuyos" : "de este negocio"}</div>
            <p className="prose">
              Tocá <strong>Nuevo fijo</strong> o decile a EOS en el chat, por ejemplo:{" "}
              {personal ? "«pago 230.000 de internet el día 10»." : "«pagamos 4.000.000 de alquiler del local el día 1»."}
            </p>
          </div>
        ) : (
          <>
            <div className="neg-resumen fijos-totales">
              {gastos.length > 0 && (
                <div className="neg-resumen-card is-primary">
                  <Repeat size={15} />
                  <span>Gastos fijos de {nombreMes}</span>
                  <strong>{formatearMonto(total(gastos), moneda)}</strong>
                  <small>
                    {formatearMonto(hecho(gastos), moneda)} ya pagado ·{" "}
                    {formatearMonto(Math.max(0, total(gastos) - hecho(gastos)), moneda)} por pagar
                  </small>
                </div>
              )}
              {ingresos.length > 0 && (
                <div className="neg-resumen-card">
                  <Repeat size={15} />
                  <span>Ingresos fijos de {nombreMes}</span>
                  <strong>{formatearMonto(total(ingresos), moneda)}</strong>
                  <small>
                    {formatearMonto(hecho(ingresos), moneda)} ya cobrado ·{" "}
                    {formatearMonto(Math.max(0, total(ingresos) - hecho(ingresos)), moneda)} por cobrar
                  </small>
                </div>
              )}
            </div>

            {tabla("Ingresos fijos", ingresos)}
            {tabla("Gastos fijos", gastos)}

            <p className="empty-note fijos-nota">
              {personal
                ? "Lo que todavía no pagaste ya se descuenta de lo que te queda libre, como plata comprometida. Recién cuando registrás el pago aparece en Ingresos y gastos."
                : "Los fijos por pagar entran en el Pronóstico de caja. Recién cuando registrás el pago cuentan como gasto del negocio en Números."}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
