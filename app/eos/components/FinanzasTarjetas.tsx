"use client";

import { useCallback, useEffect, useState } from "react";
import { CreditCard, Plus, X } from "lucide-react";

import { formatearMonto } from "@/lib/finanzas/formato";

type CompraViva = {
  id: string;
  descripcion: string;
  monto_cuota: number;
  cuota_actual: number;
  cuotas_totales: number;
  cuotas_restantes: number;
  falta: number;
  ultima_cuota: string;
};

type Tarjeta = {
  id: string;
  emisor: string;
  nombre: string | null;
  moneda: string;
  linea_total: number | null;
  saldo_utilizado: number | null;
  saldo_al: string | null;
  disponible: number | null;
  utilizacion: number | null;
  aprieta: boolean;
  dia_cierre: number | null;
  dia_vencimiento: number | null;
  proximo_cierre: string | null;
  proximo_vencimiento: string | null;
  dias_para_vencer: number | null;
  pago_minimo: number | null;
  pago_total: number | null;
  resumen_al: string | null;
  a_pagar: number | null;
  a_pagar_origen: "resumen" | "cuotas" | null;
  a_pagar_es_piso: boolean;
  compras: CompraViva[];
  cuotas_por_mes: number;
  libre_desde: string | null;
  confianza: { nivel: number; motivos: string[] };
};

type Respuesta = {
  configurado?: boolean;
  moneda?: string;
  tarjetas?: Tarjeta[];
  repetidas?: { tarjeta: string; acreedor: string }[];
};

type CompraEditable = {
  descripcion: string;
  monto_cuota: string;
  cuotas_totales: string;
  cuotas_pagadas: string;
  primera_cuota: string;
};

type Editable = {
  emisor: string;
  nombre: string;
  moneda: string;
  linea_total: string;
  saldo_utilizado: string;
  saldo_anterior: number | null;
  saldo_al: string | null;
  dia_cierre: string;
  dia_vencimiento: string;
  pago_minimo: string;
  pago_total: string;
  resumen_al: string;
  compras: CompraEditable[];
};

const VACIA: Editable = {
  emisor: "",
  nombre: "",
  moneda: "PYG",
  linea_total: "",
  saldo_utilizado: "",
  saldo_anterior: null,
  saldo_al: null,
  dia_cierre: "",
  dia_vencimiento: "",
  pago_minimo: "",
  pago_total: "",
  resumen_al: "",
  compras: [],
};

/**
 * Tarjetas: el ciclo, lo que se debe y cuándo hay que pagarlo.
 *
 * ============================================================
 * LA PREGUNTA ES CUÁNTO Y CUÁNDO
 * ============================================================
 *
 * "Pagás ₲ 2.300.000 el 5 de octubre, dentro de 27 días" es lo que alguien
 * viene a saber. La línea, la utilización y las cuotas son el respaldo.
 *
 * ============================================================
 * EL PISO SE DICE PISO
 * ============================================================
 *
 * Sin resumen cargado, lo que se muestra es la suma de las cuotas conocidas —y
 * en el mes casi con seguridad hubo compras de un solo pago que nadie cargó.
 * Presentar ese número como el total del resumen haría que alguien pague de
 * menos y entre en mora. Va escrito al lado, no en una nota al pie.
 */
export default function FinanzasTarjetas({ moneda = "PYG" }: { moneda?: string }) {
  const [datos, setDatos] = useState<Respuesta | null>(null);
  const [editables, setEditables] = useState<Editable[]>([]);
  const [editando, setEditando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");

  const cargar = useCallback(() => {
    return fetch("/api/finanzas/tarjetas", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("fallo"))))
      .then((payload: Respuesta) => {
        setDatos(payload);
        setEditables(
          (payload.tarjetas ?? []).map((t) => ({
            emisor: t.emisor,
            nombre: t.nombre ?? "",
            moneda: t.moneda,
            linea_total: t.linea_total === null ? "" : String(t.linea_total),
            saldo_utilizado: t.saldo_utilizado === null ? "" : String(t.saldo_utilizado),
            saldo_anterior: t.saldo_utilizado,
            saldo_al: t.saldo_al,
            dia_cierre: t.dia_cierre === null ? "" : String(t.dia_cierre),
            dia_vencimiento: t.dia_vencimiento === null ? "" : String(t.dia_vencimiento),
            pago_minimo: t.pago_minimo === null ? "" : String(t.pago_minimo),
            pago_total: t.pago_total === null ? "" : String(t.pago_total),
            resumen_al: t.resumen_al ?? "",
            compras: t.compras.map((c) => ({
              descripcion: c.descripcion,
              monto_cuota: String(c.monto_cuota),
              cuotas_totales: String(c.cuotas_totales),
              cuotas_pagadas: String(c.cuotas_totales - c.cuotas_restantes),
              primera_cuota: "",
            })),
          })),
        );
      })
      .catch(() => setDatos(null));
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  if (!datos || datos.configurado === false) return null;

  const tarjetas = datos.tarjetas ?? [];
  const fmt = (n: number, m = moneda) => formatearMonto(n, m);

  async function guardar() {
    setGuardando(true);
    setError("");

    try {
      const res = await fetch("/api/finanzas/tarjetas", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tarjetas: editables.map((t) => ({
            emisor: t.emisor,
            nombre: t.nombre,
            moneda: t.moneda,
            linea_total: numero(t.linea_total),
            saldo_utilizado: numero(t.saldo_utilizado),
            saldo_anterior: t.saldo_anterior,
            saldo_al: t.saldo_al,
            dia_cierre: t.dia_cierre,
            dia_vencimiento: t.dia_vencimiento,
            pago_minimo: numero(t.pago_minimo),
            pago_total: numero(t.pago_total),
            resumen_al: t.resumen_al || null,
            compras: t.compras.map((c) => ({
              descripcion: c.descripcion,
              monto_cuota: numero(c.monto_cuota),
              cuotas_totales: c.cuotas_totales,
              cuotas_pagadas: c.cuotas_pagadas,
              primera_cuota: c.primera_cuota || null,
            })),
          })),
        }),
      });

      if (!res.ok) throw new Error("fallo");

      setEditando(false);
      await cargar();
    } catch {
      setError("No pudimos guardarlo. Probá de nuevo.");
    } finally {
      setGuardando(false);
    }
  }

  const cambiar = (i: number, campo: keyof Editable, valor: string) =>
    setEditables((prev) => prev.map((t, j) => (j === i ? { ...t, [campo]: valor } : t)));

  const cambiarCompra = (i: number, j: number, campo: keyof CompraEditable, valor: string) =>
    setEditables((prev) =>
      prev.map((t, x) =>
        x === i
          ? { ...t, compras: t.compras.map((c, y) => (y === j ? { ...c, [campo]: valor } : c)) }
          : t,
      ),
    );

  /* ---------- editor ---------- */
  if (editando) {
    return (
      <div className="card fin-card">
        <div className="fin-head">
          <span className="fin-badge fin-badge-neutral">
            <CreditCard size={14} />
            TUS TARJETAS
          </span>
        </div>

        <p className="prose" style={{ marginTop: 10, fontSize: 13, opacity: 0.8 }}>
          Todo es opcional menos el emisor. Con el día de vencimiento la tarjeta entra en tu
          calendario; con la línea sabés cuánto te queda. Si tenés el resumen a mano, el total es lo
          más exacto que hay.
        </p>

        <div style={{ display: "grid", gap: 16, marginTop: 12 }}>
          {editables.map((t, i) => (
            <div
              key={i}
              style={{ borderTop: i > 0 ? "1px solid var(--line-soft)" : "none", paddingTop: i > 0 ? 14 : 0 }}
            >
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                <input
                  type="text"
                  value={t.emisor}
                  onChange={(e) => cambiar(i, "emisor", e.target.value)}
                  placeholder="Banco Continental"
                  style={{ ...campo(0), flex: 2, minWidth: 140 }}
                  aria-label="Emisor"
                />
                <input
                  type="text"
                  value={t.nombre}
                  onChange={(e) => cambiar(i, "nombre", e.target.value)}
                  placeholder="cómo le decís"
                  style={{ ...campo(0), flex: 1, minWidth: 110 }}
                  aria-label="Cómo la llamás"
                />
                <button
                  type="button"
                  onClick={() => setEditables((prev) => prev.filter((_, j) => j !== i))}
                  aria-label="Quitar tarjeta"
                  style={{ background: "none", border: "none", cursor: "pointer", opacity: 0.5 }}
                >
                  <X size={15} />
                </button>
              </div>

              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
                <input
                  type="text"
                  inputMode="numeric"
                  value={t.linea_total}
                  onChange={(e) => cambiar(i, "linea_total", e.target.value)}
                  placeholder="tu línea"
                  style={{ ...campo(0), flex: 1, minWidth: 100 }}
                  aria-label="Línea total"
                />
                <input
                  type="text"
                  inputMode="numeric"
                  value={t.saldo_utilizado}
                  onChange={(e) => cambiar(i, "saldo_utilizado", e.target.value)}
                  placeholder="usado"
                  style={{ ...campo(0), flex: 1, minWidth: 90 }}
                  aria-label="Saldo utilizado"
                />
                <input
                  type="text"
                  inputMode="numeric"
                  value={t.dia_cierre}
                  onChange={(e) => cambiar(i, "dia_cierre", e.target.value)}
                  placeholder="cierra"
                  style={{ ...campo(0), width: 80 }}
                  aria-label="Día de cierre"
                />
                <input
                  type="text"
                  inputMode="numeric"
                  value={t.dia_vencimiento}
                  onChange={(e) => cambiar(i, "dia_vencimiento", e.target.value)}
                  placeholder="vence"
                  style={{ ...campo(0), width: 80 }}
                  aria-label="Día de vencimiento"
                />
              </div>

              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
                <input
                  type="text"
                  inputMode="numeric"
                  value={t.pago_total}
                  onChange={(e) => cambiar(i, "pago_total", e.target.value)}
                  placeholder="total del resumen"
                  style={{ ...campo(0), flex: 1, minWidth: 130 }}
                  aria-label="Total del resumen"
                />
                <input
                  type="text"
                  inputMode="numeric"
                  value={t.pago_minimo}
                  onChange={(e) => cambiar(i, "pago_minimo", e.target.value)}
                  placeholder="pago mínimo"
                  style={{ ...campo(0), flex: 1, minWidth: 110 }}
                  aria-label="Pago mínimo"
                />
                <input
                  type="date"
                  value={t.resumen_al}
                  onChange={(e) => cambiar(i, "resumen_al", e.target.value)}
                  style={{ ...campo(0), flex: 1, minWidth: 140 }}
                  aria-label="Fecha del resumen"
                />
              </div>

              {/* Las compras en cuotas de esta tarjeta. */}
              <div style={{ display: "grid", gap: 6, marginTop: 8, paddingLeft: 10 }}>
                {t.compras.map((c, j) => (
                  <div key={j} style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                    <input
                      type="text"
                      value={c.descripcion}
                      onChange={(e) => cambiarCompra(i, j, "descripcion", e.target.value)}
                      placeholder="Heladera"
                      style={{ ...campo(0), flex: 2, minWidth: 120 }}
                      aria-label="Qué compraste"
                    />
                    <input
                      type="text"
                      inputMode="numeric"
                      value={c.monto_cuota}
                      onChange={(e) => cambiarCompra(i, j, "monto_cuota", e.target.value)}
                      placeholder="cuota"
                      style={{ ...campo(0), flex: 1, minWidth: 90 }}
                      aria-label="Monto de la cuota"
                    />
                    <input
                      type="text"
                      inputMode="numeric"
                      value={c.cuotas_pagadas}
                      onChange={(e) => cambiarCompra(i, j, "cuotas_pagadas", e.target.value)}
                      placeholder="pagadas"
                      style={{ ...campo(0), width: 85 }}
                      aria-label="Cuotas pagadas"
                    />
                    <input
                      type="text"
                      inputMode="numeric"
                      value={c.cuotas_totales}
                      onChange={(e) => cambiarCompra(i, j, "cuotas_totales", e.target.value)}
                      placeholder="de"
                      style={{ ...campo(0), width: 65 }}
                      aria-label="Cuotas totales"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        setEditables((prev) =>
                          prev.map((x, y) =>
                            y === i ? { ...x, compras: x.compras.filter((_, z) => z !== j) } : x,
                          ),
                        )
                      }
                      aria-label="Quitar compra"
                      style={{ background: "none", border: "none", cursor: "pointer", opacity: 0.5 }}
                    >
                      <X size={14} />
                    </button>
                  </div>
                ))}

                <button
                  type="button"
                  className="chip"
                  style={{ cursor: "pointer", justifySelf: "start" }}
                  onClick={() =>
                    setEditables((prev) =>
                      prev.map((x, y) =>
                        y === i
                          ? {
                              ...x,
                              compras: [
                                ...x.compras,
                                {
                                  descripcion: "",
                                  monto_cuota: "",
                                  cuotas_totales: "",
                                  cuotas_pagadas: "0",
                                  primera_cuota: "",
                                },
                              ],
                            }
                          : x,
                      ),
                    )
                  }
                >
                  <Plus size={12} /> Compra en cuotas
                </button>
              </div>
            </div>
          ))}
        </div>

        <button
          type="button"
          className="chip"
          style={{ marginTop: 12, cursor: "pointer" }}
          onClick={() => setEditables((prev) => [...prev, { ...VACIA, moneda }])}
        >
          <Plus size={12} /> Agregar tarjeta
        </button>

        {error && (
          <p className="prose" style={{ marginTop: 10, color: "var(--amber)" }}>
            {error}
          </p>
        )}

        <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
          <button
            type="button"
            className="reco-btn"
            onClick={() => {
              setEditando(false);
              void cargar();
            }}
            disabled={guardando}
          >
            Cancelar
          </button>
          <button
            type="button"
            className="chip"
            onClick={() => void guardar()}
            disabled={guardando}
            style={{ cursor: guardando ? "wait" : "pointer" }}
          >
            {guardando ? "Guardando…" : "Guardar"}
          </button>
        </div>
      </div>
    );
  }

  /* ---------- vista ---------- */
  return (
    <div className="card fin-card">
      <div className="fin-head">
        <span
          className={`fin-badge ${tarjetas.some((t) => t.aprieta) ? "fin-badge-atencion" : "fin-badge-neutral"}`}
        >
          <CreditCard size={14} />
          TUS TARJETAS
        </span>
      </div>

      {tarjetas.length === 0 ? (
        <p className="prose" style={{ marginTop: 10 }}>
          Cargá tu tarjeta con el día en que vence y EOS la pone en tu calendario, te dice cuánto te
          queda de línea y en qué cuota va cada compra. No guarda intereses ni tasas: no los conoce
          y no los va a inventar.
        </p>
      ) : (
        <div style={{ display: "grid", gap: 16 }}>
          {tarjetas.map((t) => (
            <div key={t.id}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline" }}>
                <strong style={{ fontSize: 14 }}>{t.nombre ?? t.emisor}</strong>
                {t.utilizacion !== null && (
                  <span className="fin-row-value" style={{ whiteSpace: "nowrap" }}>
                    {Math.round(t.utilizacion * 100)}% usado
                  </span>
                )}
              </div>

              {/* La conclusión: cuánto y cuándo. */}
              <p className="prose" style={{ marginTop: 5, fontSize: 13 }}>
                {t.a_pagar !== null && t.proximo_vencimiento !== null ? (
                  <>
                    Pagás <strong>{fmt(t.a_pagar, t.moneda)}</strong> el {t.proximo_vencimiento}
                    {t.dias_para_vencer !== null && (
                      <>
                        , dentro de {t.dias_para_vencer} {t.dias_para_vencer === 1 ? "día" : "días"}
                      </>
                    )}
                    .{" "}
                    {t.a_pagar_es_piso && (
                      <span style={{ opacity: 0.75 }}>
                        Es lo que suman tus cuotas: sin el resumen cargado, en el mes puede haber
                        más.
                      </span>
                    )}
                  </>
                ) : t.proximo_vencimiento !== null ? (
                  <>Vence el {t.proximo_vencimiento}, pero todavía no sé cuánto.</>
                ) : (
                  <>Todavía no sé qué día se vence, así que no puedo ponerla en tu calendario.</>
                )}
              </p>

              {t.pago_minimo !== null && t.a_pagar_origen === "resumen" && (
                <p className="prose" style={{ marginTop: 2, fontSize: 12, opacity: 0.7 }}>
                  El mínimo es {fmt(t.pago_minimo, t.moneda)}. Pagar el mínimo financia el resto, y
                  cuánto te cuesta eso lo dice tu contrato: yo no conozco tu tasa.
                </p>
              )}

              {/* La línea, con la barra. */}
              {t.utilizacion !== null && (
                <div style={{ marginTop: 7 }}>
                  <div
                    style={{
                      height: 6,
                      borderRadius: 999,
                      background: "var(--line-soft)",
                      overflow: "hidden",
                    }}
                    role="img"
                    aria-label={`Llevás usado el ${Math.round(t.utilizacion * 100)}% de tu línea`}
                  >
                    <div
                      style={{
                        width: `${Math.min(100, Math.round(t.utilizacion * 100))}%`,
                        height: "100%",
                        background: t.aprieta ? "var(--amber)" : "var(--green)",
                      }}
                    />
                  </div>
                  <p className="prose" style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>
                    Te quedan {fmt(t.disponible ?? 0, t.moneda)} de {fmt(t.linea_total ?? 0, t.moneda)}
                    {t.saldo_al && <> · según lo que cargaste el {t.saldo_al}</>}
                    {t.aprieta && (
                      <> · a esta altura la tarjeta dejó de ser un medio de pago y es financiación</>
                    )}
                  </p>
                </div>
              )}

              {/* Las compras en cuotas: de qué está hecho lo que paga. */}
              {t.compras.length > 0 && (
                <div className="fin-rows" style={{ marginTop: 8 }}>
                  {t.compras.map((c) => (
                    <div className="fin-row" key={c.id}>
                      <span className="fin-row-label">
                        {c.descripcion}
                        <span style={{ opacity: 0.6 }}>
                          {" "}
                          · cuota {c.cuota_actual} de {c.cuotas_totales}
                        </span>
                      </span>
                      <span className="fin-row-value">{fmt(c.monto_cuota, t.moneda)}</span>
                    </div>
                  ))}
                </div>
              )}

              {t.libre_desde && (
                <p className="prose" style={{ marginTop: 5, fontSize: 12, opacity: 0.7 }}>
                  Te comprometen {fmt(t.cuotas_por_mes, t.moneda)} por mes y se liberan del todo el{" "}
                  {t.libre_desde}.
                </p>
              )}

              {t.confianza.motivos.length > 0 && (
                <p className="prose" style={{ marginTop: 5, fontSize: 12, opacity: 0.6 }}>
                  {t.confianza.motivos.join("; ")}.
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      {/*
        Que armarPanorama lo resuelva no significa que la persona no deba
        enterarse de que tiene lo mismo cargado dos veces.
      */}
      {(datos.repetidas ?? []).length > 0 && (
        <p className="prose" style={{ marginTop: 12, fontSize: 13 }}>
          {(datos.repetidas ?? []).map((r) => (
            <span key={r.acreedor}>
              Tenés <strong>{r.tarjeta}</strong> cargada acá y también como deuda &ldquo;{r.acreedor}
              &rdquo;. No la cuento dos veces, pero conviene dejar una sola.
            </span>
          ))}
        </p>
      )}

      {error && (
        <p className="prose" style={{ marginTop: 10, color: "var(--amber)" }}>
          {error}
        </p>
      )}

      <button
        type="button"
        className="chip"
        style={{ marginTop: 12, cursor: "pointer" }}
        onClick={() => {
          setEditando(true);
          if (editables.length === 0) setEditables([{ ...VACIA, moneda }]);
        }}
      >
        {tarjetas.length === 0 ? "Cargar una tarjeta" : "Editar"}
      </button>
    </div>
  );
}

/** Un campo vacío es `null` —no lo sé— y no cero. */
function numero(valor: string): string | null {
  const limpio = valor.replace(/[^\d,.-]/g, "").replace(",", ".");
  return limpio.trim() === "" ? null : limpio;
}

function campo(ancho: number) {
  return {
    padding: "9px 10px",
    borderRadius: 8,
    border: "1px solid var(--border, #e2e8f0)",
    fontSize: 14,
    ...(ancho ? { width: ancho } : {}),
  } as const;
}
