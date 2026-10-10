"use client";

import { useEffect, useState } from "react";
import { TrendingUp } from "lucide-react";
import { formatearMonto, nombreDelMes } from "@/lib/finanzas/formato";

type Historia = { mes: string; ingresos: number; gastos: number; neto: number };
type DestinosResp =
  | { configurado: false }
  | { configurado: true; moneda: string; historia: Historia[] };

type PuntoPatrimonio = { periodo: string; patrimonio_neto: number | null; moneda: string };
type ProgresoResp =
  | { error: string }
  | { configurado: true; disponible_real: { fecha: string; valor: number | null }[]; patrimonio: PuntoPatrimonio[] };

const MESES_RESULTADO = 6;

/**
 * "Tu progreso": cómo va la plata, no solo cuánto trabajo ahorró EOS (eso es
 * "Tu impacto", la subpestaña de al lado).
 *
 * Las tres piezas salen de cálculos que YA existían, juntadas en una sola
 * pantalla por primera vez:
 *  - El resultado mes a mes sale de `/api/finanzas/destinos` (la misma
 *    historia que arma "En qué se fue").
 *  - El patrimonio sale de la foto mensual nueva (v237): si todavía no hay
 *    ninguna, lo dice en vez de inventar un número.
 *  - La curva de disponible real sale de la foto DIARIA que ya guarda
 *    `capturarPulsoPersonal` para "¿qué cambió?" — acá se mira con más
 *    días para atrás.
 */
export default function FinanzasProgreso() {
  const [destinos, setDestinos] = useState<DestinosResp | null>(null);
  const [progreso, setProgreso] = useState<ProgresoResp | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let vigente = true;
    Promise.all([
      fetch("/api/finanzas/destinos", { cache: "no-store" }).then((r) => (r.ok ? r.json() : Promise.reject())),
      fetch("/api/finanzas/patrimonio-progreso", { cache: "no-store" }).then((r) => (r.ok ? r.json() : Promise.reject())),
    ])
      .then(([d, p]) => {
        if (!vigente) return;
        setDestinos(d as DestinosResp);
        setProgreso(p as ProgresoResp);
      })
      .catch(() => {
        if (vigente) setError(true);
      });
    return () => {
      vigente = false;
    };
  }, []);

  if (error) {
    return (
      <div className="card">
        <p className="neg-load-error" role="alert">
          No pudimos leer tu progreso en este momento. Volvé a entrar en un rato.
        </p>
      </div>
    );
  }

  if (destinos === null || progreso === null) {
    return (
      <div className="card">
        <p className="neg-loading" role="status">
          Juntando cómo viene tu plata…
        </p>
      </div>
    );
  }

  if (!destinos.configurado || "error" in progreso) {
    return null;
  }

  const fmt = (v: number) => formatearMonto(v, destinos.moneda);
  const resultado = destinos.historia.slice(-MESES_RESULTADO);
  const maxResultado = Math.max(1, ...resultado.map((h) => Math.abs(h.neto)));
  const mesesEnVerde = resultado.filter((h) => h.neto >= 0).length;

  const ultimoPatrimonio = progreso.patrimonio.at(-1) ?? null;

  const puntos = progreso.disponible_real.filter((p): p is { fecha: string; valor: number } => p.valor !== null);
  const maxDisp = puntos.length > 0 ? Math.max(...puntos.map((p) => p.valor), 1) : 1;
  const minDisp = puntos.length > 0 ? Math.min(...puntos.map((p) => p.valor), 0) : 0;
  const rango = Math.max(1, maxDisp - minDisp);

  return (
    <div className="card">
      <span className="fin-badge fin-badge-neutral">
        <TrendingUp size={14} />
        CÓMO VA TU PLATA
      </span>

      {/* Patrimonio neto */}
      <div style={{ marginTop: 14 }}>
        <div className="fin-main-label">Patrimonio neto</div>
        {ultimoPatrimonio && ultimoPatrimonio.patrimonio_neto !== null ? (
          <>
            <div className="fin-main-value" style={{ fontSize: 28 }}>
              {formatearMonto(ultimoPatrimonio.patrimonio_neto, ultimoPatrimonio.moneda)}
            </div>
            <div className="fin-main-hint">
              Foto de {nombreDelMes(ultimoPatrimonio.periodo, true)} — se actualiza una vez por mes, el día 1.
            </div>
          </>
        ) : (
          <p className="prose" style={{ marginTop: 6 }}>
            {ultimoPatrimonio
              ? "El mes pasado todavía faltaba declarar lo que tenés o lo que debés para poder calcularlo."
              : "Todavía no hay una foto guardada — la primera se toma el día 1 del próximo mes, si ya declaraste tus cuentas y tus deudas."}
          </p>
        )}
      </div>

      {/* Resultado mensual */}
      {resultado.length >= 2 && (
        <div style={{ marginTop: 18, paddingTop: 16, borderTop: "1px solid var(--line)" }}>
          <div className="fin-main-label">Tu resultado, mes a mes</div>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 10, height: 70, marginTop: 10 }}>
            {resultado.map((h) => (
              <div
                key={h.mes}
                style={{ flex: 1, height: "100%", display: "flex", flexDirection: "column", justifyContent: "flex-end", alignItems: "center" }}
              >
                <div
                  style={{
                    width: "100%",
                    maxWidth: 34,
                    height: `${Math.max(4, (Math.abs(h.neto) / maxResultado) * 100)}%`,
                    background: h.neto >= 0 ? "var(--green)" : "var(--red-texto)",
                    borderRadius: 4,
                    alignSelf: h.neto >= 0 ? "flex-end" : "flex-start",
                  }}
                  title={`${nombreDelMes(h.mes)}: ${fmt(h.neto)}`}
                />
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
            {resultado.map((h) => (
              <div key={h.mes} style={{ flex: 1, textAlign: "center", fontSize: 10, color: "var(--muted)" }}>
                {nombreDelMes(h.mes)}
              </div>
            ))}
          </div>
          <p className="fin-main-hint" style={{ marginTop: 8 }}>
            {mesesEnVerde} de los últimos {resultado.length} meses cerraron en verde: te quedó más de lo que
            gastaste.
          </p>
        </div>
      )}

      {/* Curva de disponible real */}
      {puntos.length >= 5 && (
        <div style={{ marginTop: 18, paddingTop: 16, borderTop: "1px solid var(--line)" }}>
          <div className="fin-main-label">Disponible real, día a día</div>
          <svg
            viewBox="0 0 400 56"
            preserveAspectRatio="none"
            style={{ width: "100%", height: 56, marginTop: 8, display: "block" }}
            role="img"
            aria-label="Disponible real en los últimos meses"
          >
            <polyline
              fill="none"
              stroke="var(--blue)"
              strokeWidth="2"
              points={puntos
                .map((p, i) => {
                  const x = (i / (puntos.length - 1)) * 400;
                  const y = 52 - ((p.valor - minDisp) / rango) * 48;
                  return `${x},${y}`;
                })
                .join(" ")}
            />
          </svg>
          <p className="fin-main-hint">Últimos {puntos.length} días con foto guardada.</p>
        </div>
      )}

      <p className="prose" style={{ marginTop: 16, fontSize: 12.5, opacity: 0.75 }}>
        El resultado mensual y la curva diaria salen de lo que ya anotaste. El patrimonio es lo último que
        declaraste de tus cuentas, bienes y deudas — no es una lectura automática del banco.
      </p>
    </div>
  );
}
