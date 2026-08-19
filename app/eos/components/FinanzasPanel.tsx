"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Check, ChevronDown, ShieldCheck, SlidersHorizontal } from "lucide-react";
import FinanzasSetup from "./FinanzasSetup";
import FinanzasCandidatos from "./FinanzasCandidatos";

type Estado = "seguro" | "atencion" | "accion";

type EstadoFinanciero = {
  configurado: true;
  sin_datos: boolean;
  moneda: string;
  estado: Estado;
  disponible_real: number;
  saldo_estimado: number;
  ingresos: number;
  gastos: number;
  reserva_minima: number;
  ahorro_comprometido: number;
  compromisos: {
    total: number;
    cantidad: number;
    cubiertos: boolean;
    proximo: { fecha: string; descripcion: string | null } | null;
  };
  reserva_protegida: boolean;
  objetivos_en_ritmo: boolean;
  objetivos_activos: number;
  movimientos_registrados: number;
};

type Respuesta = EstadoFinanciero | { configurado: false };

const COPY: Record<Estado, { titulo: string; sub: string }> = {
  seguro: { titulo: "FINANZAS — SEGURO", sub: "Todo está bajo control." },
  atencion: { titulo: "FINANZAS — EN OBSERVACIÓN", sub: "Nada urgente, pero hay algo que EOS está vigilando." },
  accion: { titulo: "FINANZAS — NECESITA UNA DECISIÓN", sub: "Hay algo que requiere que decidas vos." },
};

export default function FinanzasPanel() {
  const [data, setData] = useState<Respuesta | null>(null);
  const [error, setError] = useState(false);
  const [detalles, setDetalles] = useState(false);
  const [configurando, setConfigurando] = useState(false);

  const cargar = useCallback(() => {
    return fetch("/api/finanzas/estado", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("fallo"))))
      .then((payload) => setData(payload))
      .catch(() => setError(true));
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  if (configurando) {
    return (
      <FinanzasSetup
        onListo={() => {
          setConfigurando(false);
          void cargar();
        }}
        onCancelar={data?.configurado ? () => setConfigurando(false) : undefined}
      />
    );
  }

  if (error || data === null) return null;

  // Todavía sin Constitución Financiera: EOS no inventa un estado.
  if (!data.configurado) {
    return (
      <div className="card fin-card">
        <div className="fin-head">
          <span className="fin-badge fin-badge-neutral">FINANZAS — SIN CONFIGURAR</span>
        </div>
        <p className="prose" style={{ marginTop: 10 }}>
          EOS todavía no conoce tu situación financiera. Definí tus reglas una sola vez y a partir de ahí va a calcular
          tu disponible real y avisarte solo cuando haga falta.
        </p>
        <button type="button" className="reco-btn" style={{ marginTop: 12 }} onClick={() => setConfigurando(true)}>
          Configurar mis finanzas
        </button>
      </div>
    );
  }

  const fmt = (valor: number) => formatearMonto(valor, data.moneda);
  const copy = COPY[data.estado];

  return (
    <>
    <FinanzasCandidatos onImportado={() => void cargar()} />

    <div className="card fin-card">
      <div className="fin-head">
        <span className={`fin-badge fin-badge-${data.estado}`}>
          {data.estado === "seguro" ? <ShieldCheck size={14} /> : <AlertTriangle size={14} />}
          {copy.titulo}
        </span>
        <button
          type="button"
          className="fin-editar"
          onClick={() => setConfigurando(true)}
          aria-label="Editar mi política financiera"
          title="Editar mi política financiera"
        >
          <SlidersHorizontal size={14} />
        </button>
      </div>
      <div className="fin-sub">{copy.sub}</div>

      {data.sin_datos ? (
        <p className="prose" style={{ marginTop: 14 }}>
          Tu política ya está definida, pero EOS todavía no registró movimientos. En cuanto haya información, acá vas a
          ver tu disponible real sin tener que calcular nada.
        </p>
      ) : (
        <>
          <div className="fin-main">
            <div className="fin-main-label">Disponible real</div>
            <div className="fin-main-value">{fmt(data.disponible_real)}</div>
            <div className="fin-main-hint">Después de compromisos, reserva y ahorro</div>
          </div>

          <div className="fin-rows">
            <FinRow
              label="Próximos compromisos"
              ok={data.compromisos.cubiertos}
              okText="Cubiertos"
              badText="Sin cobertura"
            />
            <FinRow label="Reserva" ok={data.reserva_protegida} okText="Protegida" badText="Por debajo del mínimo" />
            <FinRow
              label="Objetivos"
              ok={data.objetivos_en_ritmo}
              okText={data.objetivos_activos === 0 ? "Sin objetivos activos" : "En ritmo"}
              badText="Necesitan atención"
            />
            <div className="fin-row">
              <span className="fin-row-label">EOS necesita de vos</span>
              <span className={`fin-row-value ${data.estado === "accion" ? "is-bad" : "is-ok"}`}>
                {data.estado === "accion" ? "Una decisión" : "Nada"}
              </span>
            </div>
          </div>

          <button type="button" className="fin-toggle" onClick={() => setDetalles((v) => !v)}>
            <ChevronDown size={13} className={detalles ? "fin-chevron-open" : ""} />
            {detalles ? "Ocultar detalles" : "Ver detalles"}
          </button>

          {detalles && (
            <div className="fin-detalles">
              <div className="field-row">
                <span className="field-label">Saldo estimado</span>
                <span className="field-value">{fmt(data.saldo_estimado)}</span>
              </div>
              <div className="field-row">
                <span className="field-label">Ingresos registrados</span>
                <span className="field-value">{fmt(data.ingresos)}</span>
              </div>
              <div className="field-row">
                <span className="field-label">Gastos registrados</span>
                <span className="field-value">{fmt(data.gastos)}</span>
              </div>
              <div className="field-row">
                <span className="field-label">
                  Compromisos por pagar
                  {data.compromisos.cantidad > 0 && (
                    <span className="field-hint">{data.compromisos.cantidad} pendiente(s)</span>
                  )}
                </span>
                <span className="field-value">{fmt(data.compromisos.total)}</span>
              </div>
              <div className="field-row">
                <span className="field-label">Reserva mínima</span>
                <span className="field-value">{fmt(data.reserva_minima)}</span>
              </div>
              <div className="field-row">
                <span className="field-label">Ahorro comprometido</span>
                <span className="field-value">{fmt(data.ahorro_comprometido)}</span>
              </div>
            </div>
          )}
        </>
      )}
    </div>
    </>
  );
}

function FinRow({ label, ok, okText, badText }: { label: string; ok: boolean; okText: string; badText: string }) {
  return (
    <div className="fin-row">
      <span className="fin-row-label">{label}</span>
      <span className={`fin-row-value ${ok ? "is-ok" : "is-bad"}`}>
        {ok ? <Check size={13} /> : <AlertTriangle size={13} />}
        {ok ? okText : badText}
      </span>
    </div>
  );
}

function formatearMonto(valor: number, moneda: string) {
  const simbolo = moneda === "PYG" ? "₲" : moneda === "USD" ? "US$" : "";
  const formateado = new Intl.NumberFormat("es-PY", { maximumFractionDigits: 0 }).format(Math.round(valor));
  return `${simbolo} ${formateado}`.trim();
}
