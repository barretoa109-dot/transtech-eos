"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, Scale, X } from "lucide-react";

import { formatearMonto } from "@/lib/finanzas/formato";

type Linea = { nombre: string; tipo: string; monto: number; declarado_el: string | null };

type Patrimonio = {
  moneda: string;
  activos: number;
  detalle_activos: Linea[];
  pasivos: number;
  detalle_pasivos: Linea[];
  neto: number | null;
  falta: string | null;
  desde_cuando: string | null;
  antiguedad_dias: number | null;
  confianza: { nivel: number; motivos: string[] };
};

type Bien = {
  nombre: string;
  tipo: string;
  moneda: string;
  valor_declarado: string;
  /** Lo que tenía al cargar, para no refrescar la fecha si no cambió. */
  valor_anterior: number | null;
  valor_declarado_el: string | null;
};

type Respuesta = { configurado?: boolean; moneda?: string; patrimonios?: Patrimonio[]; bienes?: unknown[] };

const TIPOS = [
  { valor: "inmueble", etiqueta: "Inmueble" },
  { valor: "vehiculo", etiqueta: "Vehículo" },
  { valor: "inversion", etiqueta: "Inversión" },
  { valor: "participacion", etiqueta: "Parte de un negocio" },
  { valor: "otro", etiqueta: "Otro" },
];

const VACIO: Bien = {
  nombre: "",
  tipo: "inmueble",
  moneda: "PYG",
  valor_declarado: "",
  valor_anterior: null,
  valor_declarado_el: null,
};

/**
 * Patrimonio: lo que tenés menos lo que debés.
 *
 * ============================================================
 * SE NIEGA A DAR UN NÚMERO CUANDO FALTA UNA MITAD
 * ============================================================
 *
 * Sumar saldos y llamarlo "patrimonio neto" es la forma más común de mentir en
 * una app de finanzas: alguien con 12 millones en el banco y 40 de préstamo lo
 * tiene NEGATIVO, y el número tranquilizador dice exactamente lo contrario de
 * su situación.
 *
 * Cuando falta una mitad, esta tarjeta muestra lo que sí sabe y explica qué
 * falta para poder calcular el neto. Un renglón que dice "todavía no puedo"
 * es información; un número construido sobre la mitad de los datos, no.
 *
 * ============================================================
 * TODO ES DECLARADO, Y LA FECHA VIAJA CON EL NÚMERO
 * ============================================================
 *
 * EOS no ve saldos bancarios ni tasa autos. La antigüedad del dato más viejo
 * va escrita, porque un patrimonio armado con un saldo de marzo y una deuda de
 * ayer no es de hoy.
 */
export default function FinanzasPatrimonio({ moneda = "PYG" }: { moneda?: string }) {
  const [datos, setDatos] = useState<Respuesta | null>(null);
  const [bienes, setBienes] = useState<Bien[]>([]);
  const [editando, setEditando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  const [verDetalle, setVerDetalle] = useState(false);

  const cargar = useCallback(() => {
    return fetch("/api/finanzas/patrimonio", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("fallo"))))
      .then((payload: Respuesta) => {
        setDatos(payload);
        setBienes(
          ((payload.bienes ?? []) as Record<string, unknown>[]).map((b) => ({
            nombre: (b.nombre as string) ?? "",
            tipo: (b.tipo as string) ?? "otro",
            moneda: (b.moneda as string) ?? moneda,
            valor_declarado: String(b.valor ?? ""),
            valor_anterior: Number(b.valor ?? 0),
            valor_declarado_el: (b.declarado_el as string | null) ?? null,
          })),
        );
      })
      .catch(() => setDatos(null));
  }, [moneda]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  if (!datos || datos.configurado === false) return null;

  const principal = (datos.patrimonios ?? [])[0];
  if (!principal) return null;

  const otras = (datos.patrimonios ?? []).slice(1).filter((p) => p.activos > 0 || p.pasivos > 0);
  const fmt = (n: number, m = principal.moneda) => formatearMonto(n, m);

  async function guardar() {
    setGuardando(true);
    setError("");

    try {
      const res = await fetch("/api/finanzas/patrimonio", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bienes: bienes.map((b) => ({
            nombre: b.nombre,
            tipo: b.tipo,
            moneda: b.moneda,
            valor_declarado: Number(b.valor_declarado.replace(/[^\d,.-]/g, "").replace(",", ".")) || 0,
            valor_anterior: b.valor_anterior,
            valor_declarado_el: b.valor_declarado_el,
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

  const actualizar = (i: number, campo: keyof Bien, valor: string) =>
    setBienes((prev) => prev.map((b, j) => (j === i ? { ...b, [campo]: valor } : b)));

  /* ---------- editor de bienes ---------- */
  if (editando) {
    return (
      <div className="card fin-card">
        <div className="fin-head">
          <span className="fin-badge fin-badge-neutral">
            <Scale size={14} />
            LO QUE TENÉS Y NO ES PLATA
          </span>
        </div>

        <p className="prose" style={{ marginTop: 10, fontSize: 13, opacity: 0.8 }}>
          La casa, el auto, una inversión, tu parte de un negocio. Poné lo que vale hoy a tu
          criterio: EOS no tasa nada, guarda lo que le decís y la fecha en que se lo dijiste.
        </p>

        <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
          {bienes.map((b, i) => (
            <div key={i} style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
              <select
                value={b.tipo}
                onChange={(e) => actualizar(i, "tipo", e.target.value)}
                style={campo(150)}
                aria-label="Qué es"
              >
                {TIPOS.map((t) => (
                  <option key={t.valor} value={t.valor}>
                    {t.etiqueta}
                  </option>
                ))}
              </select>
              <input
                type="text"
                value={b.nombre}
                onChange={(e) => actualizar(i, "nombre", e.target.value)}
                placeholder="Casa de Lambaré"
                style={{ ...campo(0), flex: 2, minWidth: 130 }}
                aria-label="Nombre"
              />
              <input
                type="text"
                inputMode="numeric"
                value={b.valor_declarado}
                onChange={(e) => actualizar(i, "valor_declarado", e.target.value)}
                placeholder="cuánto vale"
                style={{ ...campo(0), flex: 1, minWidth: 110 }}
                aria-label="Cuánto vale"
              />
              <button
                type="button"
                onClick={() => setBienes((prev) => prev.filter((_, j) => j !== i))}
                aria-label="Quitar"
                style={{ background: "none", border: "none", cursor: "pointer", opacity: 0.5 }}
              >
                <X size={15} />
              </button>
            </div>
          ))}
        </div>

        <button
          type="button"
          className="chip"
          style={{ marginTop: 10, cursor: "pointer" }}
          onClick={() => setBienes((prev) => [...prev, { ...VACIO, moneda: principal.moneda }])}
        >
          <Plus size={12} /> Agregar
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
          className={`fin-badge ${
            principal.neto === null
              ? "fin-badge-neutral"
              : principal.neto >= 0
                ? "fin-badge-seguro"
                : "fin-badge-atencion"
          }`}
        >
          <Scale size={14} />
          LO QUE TENÉS MENOS LO QUE DEBÉS
        </span>
      </div>

      {principal.neto === null ? (
        <p className="prose" style={{ marginTop: 10, fontSize: 14 }}>
          {principal.falta}
        </p>
      ) : (
        <div style={{ marginTop: 6, marginBottom: 12 }}>
          <div className="fin-row-label" style={{ opacity: 0.75 }}>
            Patrimonio
          </div>
          <div style={{ fontSize: 26, fontWeight: 600, letterSpacing: "-0.02em" }}>
            {fmt(principal.neto)}
          </div>
          {principal.desde_cuando && (
            <div className="prose" style={{ fontSize: 12, opacity: 0.6, marginTop: 2 }}>
              Con lo que declaraste, lo más viejo del {principal.desde_cuando}. No es una lectura de
              tus cuentas.
            </div>
          )}
        </div>
      )}

      <div className="fin-rows">
        <div className="fin-row">
          <span className="fin-row-label">Lo que tenés</span>
          <span className="fin-row-value is-ok">{fmt(principal.activos)}</span>
        </div>
        <div className="fin-row">
          <span className="fin-row-label">Lo que debés</span>
          <span className="fin-row-value">− {fmt(principal.pasivos)}</span>
        </div>
      </div>

      {/* El detalle, a un clic: quién lo pide quiere ver de qué está hecho. */}
      {(principal.detalle_activos.length > 0 || principal.detalle_pasivos.length > 0) && (
        <>
          <button
            type="button"
            className="chip"
            style={{ marginTop: 10, cursor: "pointer" }}
            onClick={() => setVerDetalle((v) => !v)}
            aria-expanded={verDetalle}
          >
            {verDetalle ? "Ocultar el detalle" : "Ver de qué está hecho"}
          </button>

          {verDetalle && (
            <div className="fin-rows" style={{ marginTop: 10 }}>
              {principal.detalle_activos.map((l, i) => (
                <div className="fin-row" key={`a-${i}`}>
                  <span className="fin-row-label">
                    {l.nombre}
                    {l.declarado_el && (
                      <span style={{ opacity: 0.55 }}> · del {l.declarado_el}</span>
                    )}
                  </span>
                  <span className="fin-row-value is-ok">{fmt(l.monto)}</span>
                </div>
              ))}
              {principal.detalle_pasivos.map((l, i) => (
                <div className="fin-row" key={`p-${i}`}>
                  <span className="fin-row-label">
                    {l.nombre}
                    {l.declarado_el && (
                      <span style={{ opacity: 0.55 }}> · del {l.declarado_el}</span>
                    )}
                  </span>
                  <span className="fin-row-value">− {fmt(l.monto)}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* Las otras monedas, enteras y por separado: nunca convertidas. */}
      {otras.map((p) => (
        <p className="prose" key={p.moneda} style={{ marginTop: 8, fontSize: 13 }}>
          En {p.moneda}: {fmt(p.activos, p.moneda)} contra {fmt(p.pasivos, p.moneda)}
          {p.neto !== null && <> · quedan {fmt(p.neto, p.moneda)}</>}
        </p>
      ))}

      {principal.confianza.motivos.length > 0 && (
        <p className="prose" style={{ marginTop: 10, fontSize: 12, opacity: 0.65 }}>
          {principal.confianza.motivos.join("; ")}.
        </p>
      )}

      <button
        type="button"
        className="chip"
        style={{ marginTop: 12, cursor: "pointer" }}
        onClick={() => {
          setEditando(true);
          if (bienes.length === 0) setBienes([{ ...VACIO, moneda: principal.moneda }]);
        }}
      >
        {bienes.length === 0 ? "Cargar casa, auto o inversiones" : "Editar tus bienes"}
      </button>
    </div>
  );
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
