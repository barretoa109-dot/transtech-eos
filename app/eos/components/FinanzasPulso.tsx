"use client";

import { useCallback, useEffect, useState } from "react";
import { Activity, Sparkles } from "lucide-react";

import { formatearMonto } from "@/lib/finanzas/formato";

type Indicador = {
  id: string;
  nombre: string;
  unidad: "moneda" | "porcentaje" | "cantidad" | "dias" | "ratio";
  valor: number | null;
  anterior: number | null;
  variacion: number | null;
  tendencia: "sube" | "baja" | "estable" | "desconocida";
  estado: "bien" | "atencion" | "alerta" | "sin_datos";
  falta: string | null;
};

type Hallazgo = {
  clave: string;
  indicador: string;
  severidad: "critico" | "atencion" | "oportunidad" | "info";
  clase: "hecho" | "hipotesis" | "estimacion";
  titulo: string;
  evidencia: string;
};

type Salud = {
  puntaje: number | null;
  antes: number | null;
  cobertura: number;
  aviso: string | null;
  dimensiones: { id: string; nombre: string; puntaje: number | null; motivo: string | null }[];
  cambio: { dimension: string; antes: number; ahora: number; cambio: number }[];
};

type Consecuencia = { titulo: string; detalle: string; gravedad: "impide" | "advierte" | "informa" };

type Escenario = {
  monto: number;
  cuotas: number;
  sale_ahora: number;
  disponible_despues: number;
  veredicto: "entra" | "entra_justo" | "no_entra";
  consecuencias: Consecuencia[];
  hasta_cuanto: number;
  cuando_si: string | null;
  confianza: { nivel: number; motivos: string[] };
};

type Respuesta = {
  configurado?: boolean;
  moneda?: string;
  indicadores?: Indicador[];
  hallazgos?: Hallazgo[];
  salud?: Salud;
};

/**
 * "¿Cómo estoy?", "¿qué cambió?" y "¿puedo comprar esto?".
 *
 * ============================================================
 * EL NÚMERO NUNCA VA SOLO
 * ============================================================
 *
 * Un puntaje sin explicación es una opinión disfrazada de medición. Acá el
 * puntaje viene siempre con dos cosas: qué dimensiones lo movieron desde la
 * última vez, y sobre cuántas se calculó.
 *
 * ============================================================
 * CINCO HALLAZGOS, NO VEINTE
 * ============================================================
 *
 * Vienen ordenados por impacto × urgencia × confianza desde
 * `lib/kpi/anomalias.ts` —el mismo detector que usa el negocio— y cada uno
 * trae su evidencia. Una lista de veinte anomalías es una lista que nadie lee,
 * y entonces las tres que importaban se pierden con las otras diecisiete.
 *
 * ============================================================
 * EL ESCENARIO NO ESCRIBE NADA
 * ============================================================
 *
 * Preguntar "¿puedo comprar una notebook?" no puede dejar rastro de una
 * notebook que nadie compró. El POST calcula sobre una copia del estado.
 */
export default function FinanzasPulso({ moneda = "PYG" }: { moneda?: string }) {
  const [datos, setDatos] = useState<Respuesta | null>(null);

  const cargar = useCallback(() => {
    return fetch("/api/finanzas/pulso", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("fallo"))))
      .then(setDatos)
      .catch(() => setDatos(null));
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  if (!datos || datos.configurado === false) return null;

  const salud = datos.salud;
  const hallazgos = datos.hallazgos ?? [];
  const indicadores = (datos.indicadores ?? []).filter((i) => i.valor !== null);

  return (
    <div className="card fin-card">
      <div className="fin-head">
        <span
          className={`fin-badge ${
            hallazgos.some((h) => h.severidad === "critico")
              ? "fin-badge-accion"
              : hallazgos.length > 0
                ? "fin-badge-atencion"
                : "fin-badge-seguro"
          }`}
        >
          <Activity size={14} />
          CÓMO ESTÁS
        </span>
      </div>

      {/* La conclusión: el puntaje y por qué se movió. */}
      {salud?.puntaje !== null && salud !== undefined && (
        <>
          <div style={{ marginTop: 6, marginBottom: 10 }}>
            <div style={{ fontSize: 26, fontWeight: 600, letterSpacing: "-0.02em" }}>
              {salud.puntaje}
              <span style={{ fontSize: 15, opacity: 0.5 }}> / 100</span>
              {salud.antes !== null && salud.antes !== salud.puntaje && (
                <span style={{ fontSize: 14, opacity: 0.7, marginLeft: 8 }}>
                  {(salud.puntaje ?? 0) > salud.antes ? "▲" : "▼"} desde {salud.antes} hace un mes
                </span>
              )}
            </div>
          </div>

          {/* Qué cambió, dimensión por dimensión. Lo que más pesó, primero. */}
          {salud.cambio.length > 0 && (
            <p className="prose" style={{ fontSize: 13, marginBottom: 10 }}>
              Cambió sobre todo porque{" "}
              {salud.cambio.slice(0, 2).map((c, i) => (
                <span key={c.dimension}>
                  {i > 0 && " y "}
                  <strong>{c.dimension.toLowerCase()}</strong>{" "}
                  {c.cambio > 0 ? "mejoró" : "empeoró"} de {c.antes} a {c.ahora}
                </span>
              ))}
              .
            </p>
          )}

          {salud.aviso && (
            <p className="prose" style={{ fontSize: 12, opacity: 0.65, marginBottom: 10 }}>
              {salud.aviso}
            </p>
          )}
        </>
      )}

      {/* Los hallazgos, con su evidencia. */}
      {hallazgos.length > 0 ? (
        <div className="fin-rows">
          {hallazgos.map((h) => (
            <div className="fin-row" key={h.clave} style={{ alignItems: "flex-start" }}>
              <span className="fin-row-label" style={{ flex: 1 }}>
                <strong>{h.titulo}</strong>
                <span className="prose" style={{ display: "block", fontSize: 12, opacity: 0.7 }}>
                  {h.evidencia}
                </span>
              </span>
              <span
                className={`fin-badge ${
                  h.severidad === "critico"
                    ? "fin-badge-accion"
                    : h.severidad === "atencion"
                      ? "fin-badge-atencion"
                      : "fin-badge-neutral"
                }`}
                style={{ flexShrink: 0 }}
              >
                {h.severidad === "critico" ? "URGENTE" : h.severidad === "atencion" ? "MIRAR" : "DATO"}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <p className="prose" style={{ fontSize: 14 }}>
          No hay nada que necesite tu atención hoy.
        </p>
      )}

      {/* Los indicadores, chicos y abajo: son el respaldo, no la conclusión. */}
      {indicadores.length > 0 && (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 12,
            marginTop: 12,
            paddingTop: 10,
            borderTop: "1px solid var(--line-soft)",
          }}
        >
          {indicadores.map((i) => (
            <div key={i.id} style={{ minWidth: 110 }}>
              <div className="prose" style={{ fontSize: 11, opacity: 0.65 }}>
                {i.nombre}
              </div>
              <div style={{ fontSize: 15, fontWeight: 600 }}>
                {escribir(i, moneda)}
                {i.variacion !== null && i.variacion !== 0 && (
                  <span style={{ fontSize: 11, opacity: 0.6, marginLeft: 4 }}>
                    {i.variacion > 0 ? "▲" : "▼"}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <Escenario moneda={moneda} />
    </div>
  );
}

/** "¿Puedo comprar esto?" — el cálculo completo, sin tocar ningún dato. */
function Escenario({ moneda }: { moneda: string }) {
  const [monto, setMonto] = useState("");
  const [cuotas, setCuotas] = useState("1");
  const [resultado, setResultado] = useState<Escenario | null>(null);
  const [calculando, setCalculando] = useState(false);
  const [error, setError] = useState("");

  const fmt = (n: number) => formatearMonto(n, moneda);

  async function preguntar() {
    setCalculando(true);
    setError("");

    try {
      const res = await fetch("/api/finanzas/pulso", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          monto: Number(monto.replace(/[^\d,.-]/g, "").replace(",", ".")),
          cuotas: Number(cuotas) || 1,
        }),
      });

      const cuerpo = (await res.json()) as { escenario?: Escenario; error?: string };

      if (!res.ok || !cuerpo.escenario) {
        setError(cuerpo.error ?? "No pudimos calcularlo.");
        return;
      }

      setResultado(cuerpo.escenario);
    } catch {
      setError("No pudimos calcularlo.");
    } finally {
      setCalculando(false);
    }
  }

  return (
    <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid var(--line-soft)" }}>
      <p className="prose" style={{ fontSize: 13, marginBottom: 8 }}>
        <Sparkles size={13} style={{ display: "inline", marginRight: 5, verticalAlign: -1 }} />
        ¿Puedo comprar algo? Poné cuánto y te digo qué se rompe si lo hacés.
      </p>

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <input
          type="text"
          inputMode="numeric"
          value={monto}
          onChange={(e) => setMonto(e.target.value)}
          placeholder="cuánto"
          aria-label="Cuánto querés gastar"
          style={{ ...campo(0), flex: 1, minWidth: 110 }}
        />
        <select
          value={cuotas}
          onChange={(e) => setCuotas(e.target.value)}
          style={campo(120)}
          aria-label="En cuántas cuotas"
        >
          <option value="1">al contado</option>
          <option value="3">3 cuotas</option>
          <option value="6">6 cuotas</option>
          <option value="12">12 cuotas</option>
          <option value="18">18 cuotas</option>
        </select>
        <button
          type="button"
          className="chip"
          onClick={() => void preguntar()}
          disabled={calculando || monto.trim() === ""}
          style={{ cursor: calculando ? "wait" : "pointer" }}
        >
          {calculando ? "…" : "Preguntar"}
        </button>
      </div>

      {error && (
        <p className="prose" style={{ marginTop: 8, color: "var(--amber)" }}>
          {error}
        </p>
      )}

      {resultado && (
        <div style={{ marginTop: 10 }}>
          <p className="prose" style={{ fontSize: 14 }}>
            <strong>
              {resultado.veredicto === "entra"
                ? "Sí, entra."
                : resultado.veredicto === "entra_justo"
                  ? "Entra, pero justo."
                  : "Hoy no entra."}
            </strong>{" "}
            {resultado.cuotas > 1 && <>Salen {fmt(resultado.sale_ahora)} este mes. </>}
            {resultado.veredicto === "no_entra" && (
              <>
                Sin romper nada podrías gastar hasta {fmt(resultado.hasta_cuanto)}
                {resultado.cuando_si && <> · a tu ritmo, lo tendrías el {resultado.cuando_si}</>}.
              </>
            )}
            {resultado.veredicto !== "no_entra" && (
              <>Te quedarían {fmt(resultado.disponible_despues)} libres.</>
            )}
          </p>

          <div className="fin-rows" style={{ marginTop: 8 }}>
            {resultado.consecuencias.map((c, i) => (
              <div className="fin-row" key={i} style={{ alignItems: "flex-start" }}>
                <span className="fin-row-label" style={{ flex: 1 }}>
                  <strong
                    style={{
                      color:
                        c.gravedad === "impide"
                          ? "var(--amber)"
                          : c.gravedad === "advierte"
                            ? "inherit"
                            : "inherit",
                      opacity: c.gravedad === "informa" ? 0.75 : 1,
                    }}
                  >
                    {c.titulo}
                  </strong>
                  <span className="prose" style={{ display: "block", fontSize: 12, opacity: 0.7 }}>
                    {c.detalle}
                  </span>
                </span>
              </div>
            ))}
          </div>

          {resultado.confianza.motivos.length > 0 && (
            <p className="prose" style={{ marginTop: 8, fontSize: 12, opacity: 0.6 }}>
              {resultado.confianza.motivos.join("; ")}.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/** Cada indicador en su unidad. Un porcentaje escrito como plata no se entiende. */
function escribir(i: Indicador, moneda: string): string {
  if (i.valor === null) return "—";

  switch (i.unidad) {
    case "moneda":
      return formatearMonto(i.valor, moneda);
    case "porcentaje":
      return `${i.valor}%`;
    case "dias":
      return `${i.valor} días`;
    default:
      return String(i.valor);
  }
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
