"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, Check, Loader2, ShieldCheck } from "lucide-react";

type Paso = {
  key: "saldo_inicial" | "reserva_minima" | "porcentaje_ahorro" | "umbral_autorizacion";
  pregunta: string;
  ayuda: string;
  sufijo?: string;
  opcional?: boolean;
};

/** Las preguntas de la "Constitución Financiera" tal como las definió el
 *  usuario en su doctrina: se hacen UNA vez y EOS no vuelve a preguntarlas. */
const PASOS: Paso[] = [
  {
    key: "saldo_inicial",
    pregunta: "¿Cuánto dinero tenés disponible hoy?",
    ayuda:
      "Lo preguntamos una sola vez para tener un punto de partida. Después EOS lo mantiene actualizado solo, con los movimientos.",
  },
  {
    key: "reserva_minima",
    pregunta: "¿Cuánto querés mantener siempre intocable?",
    ayuda: "Tu colchón de seguridad. EOS nunca va a contar esta plata como disponible.",
  },
  {
    key: "porcentaje_ahorro",
    pregunta: "¿Qué parte de tus ingresos querés proteger para ahorro?",
    ayuda: "EOS lo aparta automáticamente cada vez que entra dinero.",
    sufijo: "%",
  },
  {
    key: "umbral_autorizacion",
    pregunta: "¿A partir de qué monto querés que EOS te consulte?",
    ayuda: "Por debajo de ese monto, EOS decide solo. Por encima, te pide autorización. Podés dejarlo vacío.",
    opcional: true,
  },
];

type Valores = Record<Paso["key"], string>;

export default function FinanzasSetup({
  onListo,
  onCancelar,
}: {
  onListo: () => void;
  onCancelar?: () => void;
}) {
  const [paso, setPaso] = useState(0);
  const [valores, setValores] = useState<Valores>({
    saldo_inicial: "",
    reserva_minima: "",
    porcentaje_ahorro: "",
    umbral_autorizacion: "",
  });
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  const [cargando, setCargando] = useState(true);

  // Si ya existe una política, precargamos para que "editar" no obligue a
  // recordar todo de nuevo.
  useEffect(() => {
    let activo = true;

    fetch("/api/finanzas/politica", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((payload) => {
        if (!activo) return;
        const p = payload?.politica;
        if (p) {
          setValores({
            saldo_inicial: String(p.saldo_inicial ?? ""),
            reserva_minima: String(p.reserva_minima ?? ""),
            porcentaje_ahorro: String(p.porcentaje_ahorro ?? ""),
            umbral_autorizacion: p.umbral_autorizacion === null ? "" : String(p.umbral_autorizacion),
          });
        }
      })
      .catch(() => {})
      .finally(() => {
        if (activo) setCargando(false);
      });

    return () => {
      activo = false;
    };
  }, []);

  const actual = PASOS[paso];
  const esUltimo = paso === PASOS.length - 1;
  const valor = valores[actual.key];
  const puedeAvanzar = actual.opcional || valor.trim() !== "";

  function cambiar(v: string) {
    // Solo dígitos y separador decimal, para no ensuciar el monto.
    const limpio = v.replace(/[^\d.,]/g, "").replace(",", ".");
    setValores((prev) => ({ ...prev, [actual.key]: limpio }));
  }

  async function guardar() {
    setGuardando(true);
    setError("");

    try {
      const respuesta = await fetch("/api/finanzas/politica", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          saldo_inicial: Number(valores.saldo_inicial || 0),
          reserva_minima: Number(valores.reserva_minima || 0),
          porcentaje_ahorro: Number(valores.porcentaje_ahorro || 0),
          umbral_autorizacion: valores.umbral_autorizacion.trim() === "" ? null : Number(valores.umbral_autorizacion),
        }),
      });

      const payload = await respuesta.json().catch(() => null);
      if (!respuesta.ok) throw new Error(payload?.error || "No pudimos guardar tu configuración.");

      onListo();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No pudimos guardar tu configuración.");
    } finally {
      setGuardando(false);
    }
  }

  if (cargando) {
    return (
      <div className="card fin-card">
        <p className="empty-note">Cargando tu configuración…</p>
      </div>
    );
  }

  return (
    <div className="card fin-card">
      <div className="fin-head">
        <span className="fin-badge fin-badge-neutral">
          <ShieldCheck size={14} />
          TU CONSTITUCIÓN FINANCIERA
        </span>
        <span className="fin-setup-progreso">
          {paso + 1} de {PASOS.length}
        </span>
      </div>

      <div className="fin-setup-barra">
        <div className="fin-setup-barra-fill" style={{ width: `${((paso + 1) / PASOS.length) * 100}%` }} />
      </div>

      <div className="fin-setup-pregunta">{actual.pregunta}</div>
      <div className="fin-setup-ayuda">{actual.ayuda}</div>

      <div className="fin-setup-input-wrap">
        {!actual.sufijo && <span className="fin-setup-simbolo">₲</span>}
        <input
          className="fin-setup-input"
          inputMode="decimal"
          autoFocus
          value={valor}
          onChange={(e) => cambiar(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && puedeAvanzar) {
              e.preventDefault();
              if (esUltimo) void guardar();
              else setPaso((p) => p + 1);
            }
          }}
          placeholder={actual.opcional ? "Sin límite" : "0"}
        />
        {actual.sufijo && <span className="fin-setup-sufijo">{actual.sufijo}</span>}
      </div>

      {error && <p className="fin-setup-error">{error}</p>}

      <div className="fin-setup-acciones">
        {paso > 0 ? (
          <button type="button" className="fin-toggle" onClick={() => setPaso((p) => p - 1)} disabled={guardando}>
            <ArrowLeft size={13} />
            Atrás
          </button>
        ) : onCancelar ? (
          <button type="button" className="fin-toggle" onClick={onCancelar} disabled={guardando}>
            Cancelar
          </button>
        ) : (
          <span />
        )}

        {esUltimo ? (
          <button type="button" className="reco-btn" onClick={() => void guardar()} disabled={guardando}>
            {guardando ? (
              <>
                <Loader2 size={12} className="fin-spin" style={{ display: "inline", marginRight: 6, verticalAlign: -2 }} />
                Guardando…
              </>
            ) : (
              <>
                <Check size={12} style={{ display: "inline", marginRight: 6, verticalAlign: -2 }} />
                Guardar mi política
              </>
            )}
          </button>
        ) : (
          <button type="button" className="reco-btn" onClick={() => setPaso((p) => p + 1)} disabled={!puedeAvanzar}>
            Siguiente
            <ArrowRight size={12} style={{ display: "inline", marginLeft: 6, verticalAlign: -2 }} />
          </button>
        )}
      </div>
    </div>
  );
}
