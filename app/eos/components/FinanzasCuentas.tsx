"use client";

import { useCallback, useEffect, useState } from "react";
import { Eye, EyeOff, Landmark, Plus, X } from "lucide-react";

import { formatearMonto } from "@/lib/finanzas/formato";

type Cuenta = {
  nombre: string;
  tipo: string;
  institucion: string;
  saldo_declarado: string;
  recibe_avisos: boolean;
};

type Cobertura = { total: number; con_avisos: number; ciegas: number };

const VACIA: Cuenta = {
  nombre: "",
  tipo: "banco",
  institucion: "",
  saldo_declarado: "",
  recibe_avisos: false,
};

/** Los mismos seis que acepta la ruta. Si se agrega uno allá, va acá también. */
const TIPOS: { valor: string; etiqueta: string }[] = [
  { valor: "banco", etiqueta: "Banco" },
  { valor: "cooperativa", etiqueta: "Cooperativa" },
  { valor: "financiera", etiqueta: "Financiera" },
  { valor: "billetera", etiqueta: "Billetera" },
  { valor: "efectivo", etiqueta: "Efectivo" },
  { valor: "tarjeta_credito", etiqueta: "Tarjeta de crédito" },
];

/**
 * Dónde vive la plata, y cuánto hay en total.
 *
 * ============================================================
 * ESTABA CONSTRUIDO Y NO SE VEÍA DESDE NINGUNA PANTALLA
 * ============================================================
 *
 * `eos_finanzas_cuentas` y su ruta existen desde hace semanas, con los seis
 * tipos que tiene una PYME paraguaya de verdad —banco, cooperativa,
 * financiera, billetera, efectivo, tarjeta—. Lo único que escribía ahí era el
 * onboarding: se preguntaba una vez, se guardaba, y después no había dónde
 * verlo ni corregirlo.
 *
 * ============================================================
 * EL TOTAL ES EL NÚMERO QUE TODA APP DE FINANZAS MUESTRA
 * ============================================================
 *
 * Y es el que faltaba. El panel contesta "¿estoy bien?" —disponible real,
 * compromisos, colchón— pero nunca decía cuánto tiene la persona en total.
 * Son dos preguntas distintas: una es sobre el mes, la otra sobre la
 * situación.
 *
 * ============================================================
 * PERO NO SE LLAMA PATRIMONIO NETO, PORQUE NO LO ES
 * ============================================================
 *
 * Lo que se suma acá son SALDOS DECLARADOS: lo que la persona escribió el día
 * que lo escribió. No es una lectura de banco ni un patrimonio auditado, y
 * ponerle ese nombre lo haría sonar como un dato del sistema en vez de un dato
 * suyo.
 *
 * Por eso el título dice "declarado" y, cuando la fecha es vieja, la tarjeta
 * lo dice. Un total que envejece en silencio es peor que no tenerlo: se lee
 * como actual y se decide sobre él.
 *
 * ============================================================
 * LA COLUMNA QUE MÁS IMPORTA ES LA DE LOS OJOS
 * ============================================================
 *
 * `recibe_avisos` dice de qué cuentas EOS ve movimientos llegar. Sin eso, un
 * disponible real calculado sobre una sola cuenta parece el total de la
 * persona. La tarjeta lo declara: cuántas ve y cuántas no.
 */
export default function FinanzasCuentas({ moneda }: { moneda: string }) {
  const [cuentas, setCuentas] = useState<Cuenta[] | null>(null);
  const [cobertura, setCobertura] = useState<Cobertura | null>(null);
  const [desdeCuando, setDesdeCuando] = useState<string | null>(null);
  const [editando, setEditando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");

  const cargar = useCallback(() => {
    return fetch("/api/finanzas/cuentas", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("fallo"))))
      .then((payload) => {
        const lista: Cuenta[] = (payload.cuentas ?? []).map(
          (c: {
            nombre: string;
            tipo: string;
            institucion: string | null;
            saldo_declarado: number | null;
            recibe_avisos: boolean;
          }) => ({
            nombre: c.nombre,
            tipo: c.tipo,
            institucion: c.institucion ?? "",
            saldo_declarado: c.saldo_declarado === null ? "" : String(c.saldo_declarado),
            recibe_avisos: Boolean(c.recibe_avisos),
          }),
        );

        // La más vieja manda: el total vale lo que vale el saldo más
        // desactualizado que lo compone.
        const fechas = (payload.cuentas ?? [])
          .map((c: { saldo_declarado_el: string | null }) => c.saldo_declarado_el)
          .filter((f: string | null): f is string => Boolean(f))
          .sort();

        setCuentas(lista);
        setCobertura(payload.cobertura ?? null);
        setDesdeCuando(fechas[0] ?? null);
      })
      .catch(() => setCuentas([]));
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  if (cuentas === null) return null;

  async function guardar() {
    setGuardando(true);
    setError("");

    try {
      const res = await fetch("/api/finanzas/cuentas", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cuentas: (cuentas ?? []).map((c) => ({
            nombre: c.nombre,
            tipo: c.tipo,
            institucion: c.institucion,
            moneda,
            saldo_declarado:
              c.saldo_declarado.trim() === ""
                ? null
                : Number(c.saldo_declarado.replace(/[^\d,.-]/g, "").replace(",", ".")),
            recibe_avisos: c.recibe_avisos,
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

  const actualizar = (i: number, campo: keyof Cuenta, valor: string | boolean) =>
    setCuentas((prev) => (prev ?? []).map((c, j) => (j === i ? { ...c, [campo]: valor } : c)));

  const conSaldo = cuentas.filter((c) => c.saldo_declarado.trim() !== "");
  const total = conSaldo.reduce((suma, c) => suma + (Number(c.saldo_declarado) || 0), 0);

  /* ---------- vista compacta ---------- */
  if (!editando) {
    return (
      <div className="card fin-card">
        <div className="fin-head">
          <span className="fin-badge fin-badge-neutral">
            <Landmark size={14} />
            DÓNDE ESTÁ TU PLATA
          </span>
        </div>

        {cuentas.length === 0 ? (
          <p className="prose" style={{ marginTop: 10 }}>
            Banco, cooperativa, billetera, el efectivo del cajón. Decile a EOS dónde tenés plata y
            cuánto hay, y vas a ver el total en un solo lugar. Podés poner solo los nombres si no
            querés cargar montos.
          </p>
        ) : (
          <>
            {conSaldo.length > 0 && (
              <div style={{ marginTop: 6, marginBottom: 12 }}>
                <div className="fin-row-label" style={{ opacity: 0.75 }}>
                  Total declarado
                </div>
                <div style={{ fontSize: 26, fontWeight: 600, letterSpacing: "-0.02em" }}>
                  {formatearMonto(total, moneda)}
                </div>
                {desdeCuando && (
                  <div className="prose" style={{ fontSize: 12, opacity: 0.6, marginTop: 2 }}>
                    Según lo que cargaste, lo más viejo del {desdeCuando}. No es una lectura del
                    banco.
                  </div>
                )}
              </div>
            )}

            <div className="fin-rows">
              {cuentas.map((c, i) => (
                <div className="fin-row" key={`${c.nombre}-${i}`}>
                  <span className="fin-row-label">
                    {c.recibe_avisos ? (
                      <Eye size={12} style={{ display: "inline", marginRight: 5, verticalAlign: -1 }} />
                    ) : (
                      <EyeOff
                        size={12}
                        style={{ display: "inline", marginRight: 5, verticalAlign: -1, opacity: 0.45 }}
                      />
                    )}
                    {c.nombre}
                    {c.institucion ? ` · ${c.institucion}` : ""}
                  </span>
                  <span className="fin-row-value">
                    {c.saldo_declarado.trim() === ""
                      ? "—"
                      : formatearMonto(Number(c.saldo_declarado) || 0, moneda)}
                  </span>
                </div>
              ))}
            </div>

            {/*
              La honestidad de todo el panel depende de esta línea. Si EOS solo
              ve una de cuatro cuentas, el disponible real que muestra arriba no
              es el disponible de la persona, y quien lo lee tiene derecho a
              saberlo sin ir a buscarlo.
            */}
            {cobertura && cobertura.ciegas > 0 && (
              <p className="prose" style={{ marginTop: 10, fontSize: 13, opacity: 0.75 }}>
                EOS ve movimientos de {cobertura.con_avisos} de tus {cobertura.total} cuentas. De
                {cobertura.ciegas === 1 ? " la otra" : ` las otras ${cobertura.ciegas}`} solo sabe
                lo que le cuentes.
              </p>
            )}
          </>
        )}

        <button
          type="button"
          className="chip"
          style={{ marginTop: 12, cursor: "pointer" }}
          onClick={() => {
            setEditando(true);
            if (cuentas.length === 0) setCuentas([{ ...VACIA }]);
          }}
        >
          {cuentas.length === 0 ? "Decirle a EOS" : "Editar"}
        </button>
      </div>
    );
  }

  /* ---------- editor ---------- */
  return (
    <div className="card fin-card">
      <div className="fin-head">
        <span className="fin-badge fin-badge-neutral">
          <Landmark size={14} />
          DÓNDE ESTÁ TU PLATA
        </span>
      </div>

      <p className="prose" style={{ marginTop: 10, fontSize: 13, opacity: 0.8 }}>
        El saldo es opcional: sin él la cuenta igual sirve para saber qué ve EOS y qué no. Marcá el
        ojo en las cuentas cuyos avisos te llegan por correo — son las que EOS puede seguir solo.
      </p>

      <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
        {cuentas.map((c, i) => (
          <div key={i} style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            <select
              value={c.tipo}
              onChange={(e) => actualizar(i, "tipo", e.target.value)}
              style={campo(120)}
              aria-label="Tipo de cuenta"
            >
              {TIPOS.map((t) => (
                <option key={t.valor} value={t.valor}>
                  {t.etiqueta}
                </option>
              ))}
            </select>
            <input
              type="text"
              value={c.nombre}
              onChange={(e) => actualizar(i, "nombre", e.target.value)}
              placeholder="Cuenta sueldo"
              style={{ ...campo(0), flex: 2, minWidth: 110 }}
              aria-label="Nombre de la cuenta"
            />
            <input
              type="text"
              value={c.institucion}
              onChange={(e) => actualizar(i, "institucion", e.target.value)}
              placeholder="Institución"
              style={{ ...campo(0), flex: 1, minWidth: 100 }}
              aria-label="Institución"
            />
            <input
              type="text"
              inputMode="numeric"
              value={c.saldo_declarado}
              onChange={(e) => actualizar(i, "saldo_declarado", e.target.value)}
              placeholder="saldo"
              style={{ ...campo(0), flex: 1, minWidth: 90 }}
              aria-label="Saldo declarado"
            />
            <button
              type="button"
              onClick={() => actualizar(i, "recibe_avisos", !c.recibe_avisos)}
              aria-label={c.recibe_avisos ? "EOS ve esta cuenta" : "EOS no ve esta cuenta"}
              aria-pressed={c.recibe_avisos}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                opacity: c.recibe_avisos ? 1 : 0.35,
              }}
            >
              {c.recibe_avisos ? <Eye size={16} /> : <EyeOff size={16} />}
            </button>
            <button
              type="button"
              onClick={() => setCuentas((prev) => (prev ?? []).filter((_, j) => j !== i))}
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
        onClick={() => setCuentas((prev) => [...(prev ?? []), { ...VACIA }])}
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

function campo(ancho: number) {
  return {
    padding: "9px 10px",
    borderRadius: 8,
    border: "1px solid var(--border, #e2e8f0)",
    fontSize: 14,
    ...(ancho ? { width: ancho } : {}),
  } as const;
}
