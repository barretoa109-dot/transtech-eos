"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, Target, X } from "lucide-react";

import { formatearMonto } from "@/lib/finanzas/formato";

type Objetivo = {
  id: string;
  titulo: string;
  moneda: string;
  objetivo: number;
  actual: number;
  origen: "cuenta" | "declarado";
  actual_al: string | null;
  falta: number;
  progreso: number;
  hasta: string | null;
  aportes_restantes: number | null;
  aporte_necesario: number | null;
  aporte_original: number | null;
  aporte_real: number | null;
  llegada_estimada: string | null;
  estado: "cumplido" | "vencido" | "en_ritmo" | "atrasado" | "sin_fecha";
  confianza: { nivel: number; motivos: string[] };
};

type Contraste = {
  aporte_necesario_total: number;
  ahorro_mensual: number;
  alcanza: boolean;
  faltante: number;
  no_entran: { id: string; titulo: string; aporte_necesario: number }[];
};

type Respuesta = {
  configurado?: boolean;
  moneda?: string;
  objetivos?: Objetivo[];
  contraste?: Contraste;
  no_financieros?: { id: string; titulo: string }[];
};

/**
 * Los objetivos, dichos en plata por mes.
 *
 * ============================================================
 * LO QUE LA PERSONA VINO A SABER
 * ============================================================
 *
 * No es el porcentaje de avance. Es "para llegar tenés que apartar 6.000.000
 * por mes durante los cuatro meses que quedan". Eso es accionable; una barra
 * al 20% no.
 *
 * ============================================================
 * Y SI ESO NO ENTRA, TAMBIÉN
 * ============================================================
 *
 * El contraste con el ahorro va arriba de todo cuando no alcanza, porque es
 * la conclusión: de nada sirve el detalle de cinco objetivos si los cinco
 * juntos piden el doble de lo que la persona aparta por mes.
 *
 * No se resta del disponible real. El disponible YA descuenta el ahorro
 * comprometido, y restar además cada aporte contaría la misma plata dos veces
 * — el mismo error que este proyecto ya cometió con una cuota pagada.
 */
export default function FinanzasObjetivos({ moneda = "PYG" }: { moneda?: string }) {
  const [datos, setDatos] = useState<Respuesta | null>(null);
  const [creando, setCreando] = useState(false);
  const [error, setError] = useState("");

  const cargar = useCallback(() => {
    return fetch("/api/finanzas/objetivos", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("fallo"))))
      .then(setDatos)
      .catch(() => setDatos(null));
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  if (!datos || datos.configurado === false) return null;

  const objetivos = datos.objetivos ?? [];
  const contraste = datos.contraste;
  const fmt = (n: number) => formatearMonto(n, moneda);

  return (
    <div className="card fin-card">
      <div className="fin-head">
        <span
          className={`fin-badge ${
            objetivos.some((o) => o.estado === "atrasado" || o.estado === "vencido")
              ? "fin-badge-atencion"
              : "fin-badge-neutral"
          }`}
        >
          <Target size={14} />
          LO QUE QUERÉS LOGRAR
        </span>
      </div>

      {objetivos.length === 0 ? (
        <p className="prose" style={{ marginTop: 10 }}>
          Decile a EOS qué querés juntar y para cuándo —&ldquo;30 millones para diciembre&rdquo;— y
          te dice cuánto tenés que apartar por mes, si tu ahorro alcanza y cuándo vas a llegar al
          ritmo que llevás.
        </p>
      ) : (
        <>
          {/* La conclusión primero: si todos juntos no entran, eso es lo que hay que saber. */}
          {contraste && !contraste.alcanza && (
            <p className="prose" style={{ marginTop: 8, marginBottom: 12, fontSize: 14 }}>
              Tus objetivos piden <strong>{fmt(contraste.aporte_necesario_total)}</strong> por mes y{" "}
              {/*
                Cero ahorro no es lo mismo que ahorro insuficiente. Decir "estás
                apartando ₲ 0" suena a reproche cuando la causa es que la
                Constitución tiene 0% y nadie se lo dijo: es una casilla que se
                completa en diez segundos y cambia todo lo de abajo.
              */}
              {contraste.ahorro_mensual === 0 ? (
                <>
                  en tu Constitución no tenés definido ningún porcentaje de ahorro. Poné uno y te
                  digo si alcanza.
                </>
              ) : (
                <>
                  estás apartando <strong>{fmt(contraste.ahorro_mensual)}</strong>. Faltan{" "}
                  <strong>{fmt(contraste.faltante)}</strong> por mes
                  {contraste.no_entran.length > 0 && (
                    <>
                      , así que{" "}
                      {contraste.no_entran.length === 1 ? "no entra " : "no entran "}
                      {contraste.no_entran.map((o) => o.titulo).join(", ")}
                    </>
                  )}
                  .
                </>
              )}
            </p>
          )}

          {contraste && contraste.alcanza && contraste.aporte_necesario_total > 0 && (
            <p className="prose" style={{ marginTop: 8, marginBottom: 12, fontSize: 14 }}>
              Tus objetivos piden <strong>{fmt(contraste.aporte_necesario_total)}</strong> por mes y
              apartás <strong>{fmt(contraste.ahorro_mensual)}</strong>: entran.
            </p>
          )}

          <div style={{ display: "grid", gap: 14 }}>
            {objetivos.map((o) => (
              <Fila key={o.id} objetivo={o} moneda={moneda} alRefrescar={cargar} />
            ))}
          </div>
        </>
      )}

      {/*
        Los que EOS tiene y no puede convertir en plata. Se muestran porque
        quien creó "terminar la mudanza" desde el chat tiene que ver que existe,
        aunque no tenga aporte mensual.
      */}
      {(datos.no_financieros ?? []).length > 0 && (
        <p className="prose" style={{ marginTop: 12, fontSize: 12, opacity: 0.65 }}>
          También seguís: {(datos.no_financieros ?? []).map((o) => o.titulo).join(", ")}.
        </p>
      )}

      {error && (
        <p className="prose" style={{ marginTop: 10, color: "var(--amber)" }}>
          {error}
        </p>
      )}

      {creando ? (
        <Nuevo
          moneda={moneda}
          alCerrar={() => setCreando(false)}
          alGuardar={async () => {
            setCreando(false);
            await cargar();
          }}
          alFallar={setError}
        />
      ) : (
        <button
          type="button"
          className="chip"
          style={{ marginTop: 14, cursor: "pointer" }}
          onClick={() => {
            setError("");
            setCreando(true);
          }}
        >
          <Plus size={12} /> {objetivos.length === 0 ? "Poner un objetivo" : "Otro objetivo"}
        </button>
      )}
    </div>
  );
}

/** Un objetivo: la cuenta arriba, el detalle abajo. */
function Fila({
  objetivo: o,
  moneda,
  alRefrescar,
}: {
  objetivo: Objetivo;
  moneda: string;
  alRefrescar: () => Promise<void>;
}) {
  const [editando, setEditando] = useState(false);
  const [monto, setMonto] = useState(String(o.actual || ""));
  const [guardando, setGuardando] = useState(false);

  const fmt = (n: number) => formatearMonto(n, moneda);
  const pct = Math.max(0, Math.min(100, o.progreso));

  async function guardar() {
    setGuardando(true);
    try {
      await fetch("/api/finanzas/objetivos", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: o.id,
          valor_actual: Number(monto.replace(/[^\d,.-]/g, "").replace(",", ".")) || 0,
        }),
      });
      setEditando(false);
      await alRefrescar();
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline" }}>
        <strong style={{ fontSize: 14 }}>{o.titulo}</strong>
        <span className="fin-row-value" style={{ whiteSpace: "nowrap" }}>
          {fmt(o.actual)} / {fmt(o.objetivo)}
        </span>
      </div>

      <div
        style={{
          height: 6,
          borderRadius: 999,
          background: "var(--line-soft)",
          overflow: "hidden",
          marginTop: 6,
        }}
        role="img"
        aria-label={`Llevás el ${Math.round(pct)}% de ${o.titulo}`}
      >
        <div
          style={{
            width: `${pct}%`,
            height: "100%",
            background:
              o.estado === "cumplido"
                ? "var(--green)"
                : o.estado === "atrasado" || o.estado === "vencido"
                  ? "var(--amber)"
                  : "var(--accent, #2563eb)",
          }}
        />
      </div>

      {/* La frase que la persona vino a leer. */}
      <p className="prose" style={{ marginTop: 7, fontSize: 13 }}>
        {o.estado === "cumplido" ? (
          <>Ya lo lograste.</>
        ) : o.estado === "vencido" ? (
          <>
            La fecha pasó y faltaban {fmt(o.falta)}. Si sigue en pie, poné una nueva.
          </>
        ) : o.estado === "sin_fecha" ? (
          <>
            Te faltan {fmt(o.falta)}. Poné una fecha y te digo cuánto apartar por mes.
          </>
        ) : (
          <>
            Para llegar tenés que apartar <strong>{fmt(o.aporte_necesario ?? 0)}</strong> por mes
            {o.aportes_restantes !== null && (
              <>
                {" "}
                durante {o.aportes_restantes === 1 ? "el mes que queda" : `los ${o.aportes_restantes} meses que quedan`}
              </>
            )}
            .
            {o.estado === "atrasado" && o.aporte_original !== null && (
              <> Cuando lo definiste alcanzaba con {fmt(o.aporte_original)}.</>
            )}
          </>
        )}
      </p>

      {/* El ritmo real, solo cuando hay con qué medirlo. */}
      {o.aporte_real !== null && o.estado !== "cumplido" && (
        <p className="prose" style={{ marginTop: 3, fontSize: 12, opacity: 0.7 }}>
          Venís apartando {fmt(o.aporte_real)} por mes
          {o.llegada_estimada && <> · a ese ritmo llegás en {o.llegada_estimada}</>}
        </p>
      )}

      {o.confianza.motivos.length > 0 && (
        <p className="prose" style={{ marginTop: 3, fontSize: 12, opacity: 0.6 }}>
          {o.confianza.motivos.join("; ")}.
        </p>
      )}

      {/*
        Actualizar cuánto lleva. Solo cuando el monto es declarado: si el
        objetivo está atado a una cuenta, el número sale de ahí y editarlo acá
        crearía dos verdades sobre la misma plata.
      */}
      {o.origen === "declarado" && o.estado !== "cumplido" && (
        <div style={{ marginTop: 6 }}>
          {editando ? (
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input
                type="text"
                inputMode="numeric"
                value={monto}
                onChange={(e) => setMonto(e.target.value)}
                placeholder="cuánto llevás"
                aria-label={`Cuánto llevás juntado para ${o.titulo}`}
                style={campo(130)}
              />
              <button
                type="button"
                className="chip"
                onClick={() => void guardar()}
                disabled={guardando}
                style={{ cursor: guardando ? "wait" : "pointer" }}
              >
                {guardando ? "…" : "Guardar"}
              </button>
              <button
                type="button"
                onClick={() => setEditando(false)}
                aria-label="Cancelar"
                style={{ background: "none", border: "none", cursor: "pointer", opacity: 0.5 }}
              >
                <X size={15} />
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="chip"
              style={{ cursor: "pointer" }}
              onClick={() => setEditando(true)}
            >
              Actualizar cuánto llevás
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** Tres campos: qué, cuánto y para cuándo. Un cuarto es un motivo más para irse. */
function Nuevo({
  moneda,
  alCerrar,
  alGuardar,
  alFallar,
}: {
  moneda: string;
  alCerrar: () => void;
  alGuardar: () => Promise<void>;
  alFallar: (mensaje: string) => void;
}) {
  const [titulo, setTitulo] = useState("");
  const [monto, setMonto] = useState("");
  const [fecha, setFecha] = useState("");
  const [actual, setActual] = useState("");
  const [guardando, setGuardando] = useState(false);

  async function guardar() {
    setGuardando(true);
    alFallar("");

    try {
      const res = await fetch("/api/finanzas/objetivos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          titulo,
          valor_objetivo: Number(monto.replace(/[^\d,.-]/g, "").replace(",", ".")),
          valor_actual: actual.trim() === "" ? 0 : Number(actual.replace(/[^\d,.-]/g, "").replace(",", ".")),
          fecha_limite: fecha || null,
          moneda,
        }),
      });

      if (!res.ok) {
        const cuerpo = (await res.json().catch(() => ({}))) as { error?: string };
        alFallar(cuerpo.error ?? "No pudimos guardarlo. Probá de nuevo.");
        return;
      }

      await alGuardar();
    } catch {
      alFallar("No pudimos guardarlo. Probá de nuevo.");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div style={{ marginTop: 14, display: "grid", gap: 8 }}>
      <input
        type="text"
        value={titulo}
        onChange={(e) => setTitulo(e.target.value)}
        placeholder="Juntar para el terreno"
        aria-label="Qué querés lograr"
        style={campo(0)}
      />
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <input
          type="text"
          inputMode="numeric"
          value={monto}
          onChange={(e) => setMonto(e.target.value)}
          placeholder="cuánto"
          aria-label="Cuánto querés llegar a tener"
          style={{ ...campo(0), flex: 1, minWidth: 110 }}
        />
        <input
          type="text"
          inputMode="numeric"
          value={actual}
          onChange={(e) => setActual(e.target.value)}
          placeholder="ya tengo"
          aria-label="Cuánto tenés ya"
          style={{ ...campo(0), flex: 1, minWidth: 100 }}
        />
        <input
          type="date"
          value={fecha}
          onChange={(e) => setFecha(e.target.value)}
          aria-label="Para cuándo"
          style={{ ...campo(0), flex: 1, minWidth: 140 }}
        />
      </div>

      <p className="prose" style={{ fontSize: 12, opacity: 0.65 }}>
        Sin fecha lo guardo igual, pero no voy a poder decirte cuánto apartar por mes.
      </p>

      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" className="reco-btn" onClick={alCerrar} disabled={guardando}>
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

function campo(ancho: number) {
  return {
    padding: "9px 10px",
    borderRadius: 8,
    border: "1px solid var(--border, #e2e8f0)",
    fontSize: 14,
    ...(ancho ? { width: ancho } : {}),
  } as const;
}
