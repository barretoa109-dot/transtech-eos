"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Clock } from "lucide-react";
import { formatearMonto } from "@/lib/finanzas/formato";
import type { Tramo } from "@/lib/erp/cartera";

/**
 * El estado de cuenta: quién te debe, desde cuándo, y cobrar una parte.
 *
 * ============================================================
 * LO VENCIDO VA PRIMERO Y CON NOMBRE
 * ============================================================
 *
 * Un estado de cartera que empieza por el total no sirve para actuar: el
 * número grande no dice a quién llamar. Acá arriba va lo vencido, y debajo la
 * lista de a quién, ordenada del atraso más viejo al más nuevo.
 *
 * ============================================================
 * "SIN VENCIMIENTO" NO ES "VENCIDO"
 * ============================================================
 *
 * Una venta a crédito sin plazo pactado está pendiente, pero nadie acordó una
 * fecha: no se puede afirmar que esté atrasada. Se muestra en su propio tramo
 * y no suma al vencido. Es la misma regla que aplica `lib/erp/cartera.ts`.
 */

type LineaTramo = { tramo: Tramo; total: number; documentos: number };

type MonedaCartera = {
  moneda: string;
  total: number;
  vencido: number;
  lineas: LineaTramo[];
  dias_promedio: number | null;
};

type Vencido = {
  id: string;
  fecha: string;
  vence_el: string | null;
  moneda: string;
  saldo: number;
  contacto_nombre: string | null;
};

type Respuesta = {
  tipo: "cobrar" | "pagar";
  hoy: string;
  monedas: MonedaCartera[];
  vencidos: Vencido[];
};

const ETIQUETA_TRAMO: Record<Tramo, string> = {
  corriente: "Al día",
  "1-30": "1 a 30 días",
  "31-60": "31 a 60 días",
  "61-90": "61 a 90 días",
  "mas-90": "Más de 90 días",
  "sin-vencimiento": "Sin plazo pactado",
};

/**
 * El selector vive afuera y la lista adentro, con `key={tipo}`.
 *
 * Así, cambiar de "me deben" a "debo" REMONTA la lista: el estado arranca en
 * "cargando" sin que el efecto tenga que resetearlo con un setState síncrono,
 * que dispara renders en cascada y que el lint del proyecto marca como error.
 */
export default function Cartera({ onCambio }: { onCambio?: () => void }) {
  const [tipo, setTipo] = useState<"cobrar" | "pagar">("cobrar");

  return (
    <div className="neg-cartera">
      <div className="chip-row">
        <button
          type="button"
          className={`chip ${tipo === "cobrar" ? "active" : ""}`}
          onClick={() => setTipo("cobrar")}
        >
          Me deben
        </button>
        <button
          type="button"
          className={`chip ${tipo === "pagar" ? "active" : ""}`}
          onClick={() => setTipo("pagar")}
        >
          Debo
        </button>
      </div>

      <Lista key={tipo} tipo={tipo} onCambio={onCambio} />
    </div>
  );
}

function Lista({ tipo, onCambio }: { tipo: "cobrar" | "pagar"; onCambio?: () => void }) {
  const [datos, setDatos] = useState<Respuesta | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");

  // El documento sobre el que se está cargando un cobro, y su monto.
  const [cobrando, setCobrando] = useState<string | null>(null);
  const [monto, setMonto] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [avisoCobro, setAvisoCobro] = useState("");

  /*
   * El fetch vive FUERA del componente (`traer`) y acá solo se aplica su
   * resultado.
   *
   * No es estilo: el lint del proyecto marca como error cualquier `setState`
   * síncrono adentro de un efecto, y atraviesa los `useCallback` para
   * encontrarlo. Con la búsqueda afuera, el efecto no toca el estado hasta
   * después del primer `await`, que es justo lo que la regla pide.
   */
  const aplicar = (res: Awaited<ReturnType<typeof traer>>) => {
    if ("error" in res) setError(res.error);
    else setDatos(res);
    setCargando(false);
  };

  useEffect(() => {
    let vivo = true;
    (async () => {
      const res = await traer(tipo);
      if (vivo) aplicar(res);
    })();
    return () => {
      vivo = false;
    };
  }, [tipo]);

  async function cargar() {
    aplicar(await traer(tipo));
  }

  async function registrar(documento: Vencido) {
    const valor = Number(monto.replace(/\./g, "").replace(",", "."));

    if (!Number.isFinite(valor) || valor <= 0) {
      setAvisoCobro("Poné un monto mayor a cero.");
      return;
    }
    if (valor > documento.saldo) {
      // Se avisa acá además de en la base: llegar hasta el servidor para que
      // rebote un monto que ya se sabe imposible es hacerle perder tiempo.
      setAvisoCobro(`El saldo es ${formatearMonto(documento.saldo, documento.moneda)}. No podés cobrar más que eso.`);
      return;
    }

    setGuardando(true);
    setAvisoCobro("");
    try {
      const r = await fetch("/api/erp/cobranzas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          [tipo === "cobrar" ? "venta_id" : "compra_id"]: documento.id,
          monto: valor,
        }),
      });

      const cuerpo = await r.json();
      if (!r.ok) {
        setAvisoCobro(cuerpo?.error ?? "No pudimos registrar el cobro.");
        return;
      }

      setCobrando(null);
      setMonto("");
      await cargar();
      // El cobro creó un movimiento financiero: lo que muestra el resto de la
      // pantalla (ventas, saldos) cambió y hay que recargarlo.
      onCambio?.();
    } catch {
      setAvisoCobro("No pudimos registrar el cobro.");
    } finally {
      setGuardando(false);
    }
  }

  if (cargando && !datos) return <p className="neg-loading" role="status">Cargando tu estado de cuenta…</p>;
  if (error) return <p className="neg-load-error" role="alert">{error}</p>;
  if (!datos) return null;

  const sinNada = datos.monedas.length === 0;

  return (
    <>
      {sinNada ? (
        <p className="neg-empty-state">
          {tipo === "cobrar"
            ? "No tenés nada por cobrar: todas tus ventas están saldadas."
            : "No tenés nada por pagar: todas tus compras están saldadas."}
        </p>
      ) : (
        datos.monedas.map((m) => (
          <div key={m.moneda} className="card" style={{ marginBottom: 16 }}>
            <div className="card-title">
              {tipo === "cobrar" ? "Por cobrar" : "Por pagar"} en {m.moneda}
            </div>

            <div className="neg-metricas">
              <div className="neg-metrica">
                <span>Total pendiente</span>
                <strong>{formatearMonto(m.total, m.moneda)}</strong>
              </div>
              <div className={`neg-metrica${m.vencido > 0 ? " is-danger" : ""}`}>
                <span>Vencido</span>
                <strong>{formatearMonto(m.vencido, m.moneda)}</strong>
              </div>
              <div className="neg-metrica">
                <span>{tipo === "cobrar" ? "Días promedio de cobro" : "Días promedio de pago"}</span>
                <strong>
                  {m.dias_promedio === null ? "—" : `${m.dias_promedio} días`}
                </strong>
                {m.dias_promedio === null && (
                  <small className="neg-metrica-nota">
                    Todavía no se {tipo === "cobrar" ? "cobró" : "pagó"} nada a crédito
                  </small>
                )}
              </div>
            </div>

            <div className="cartera-tramos">
              {m.lineas.map((l) => (
                <div
                  key={l.tramo}
                  className={`cartera-tramo${
                    l.tramo !== "corriente" && l.tramo !== "sin-vencimiento" ? " is-vencido" : ""
                  }`}
                >
                  <span className="cartera-tramo-nombre">{ETIQUETA_TRAMO[l.tramo]}</span>
                  <span className="cartera-tramo-monto">{formatearMonto(l.total, m.moneda)}</span>
                  <span className="cartera-tramo-cuenta">
                    {l.documentos} {l.documentos === 1 ? "documento" : "documentos"}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))
      )}

      {datos.vencidos.length > 0 && (
        <div className="card">
          <div className="card-title">
            <AlertTriangle size={15} /> {tipo === "cobrar" ? "A quién reclamar" : "Qué pagar"} primero
          </div>
          <div className="card-sub">Del atraso más viejo al más nuevo.</div>

          <div className="neg-lista">
            {datos.vencidos.map((d) => (
              <div key={d.id} className="neg-fila">
                <div className="neg-fila-texto">
                  <strong>{d.contacto_nombre ?? "Consumidor final"}</strong>
                  <small>
                    <Clock size={11} /> venció el {formatearDia(d.vence_el as string)} · del{" "}
                    {formatearDia(d.fecha)}
                  </small>
                </div>

                <div className="neg-fila-monto">{formatearMonto(d.saldo, d.moneda)}</div>

                {cobrando === d.id ? (
                  <div className="cartera-cobro">
                    <input
                      className="neg-input neg-cantidad"
                      inputMode="numeric"
                      autoFocus
                      placeholder={String(d.saldo)}
                      value={monto}
                      onChange={(e) => setMonto(e.target.value)}
                      aria-label="Monto a registrar"
                    />
                    <button
                      type="button"
                      className="reco-btn"
                      disabled={guardando}
                      onClick={() => void registrar(d)}
                    >
                      {guardando ? "Registrando…" : "Registrar"}
                    </button>
                    {/* `chip` y no `ghost-btn`: es la convención que ya usan
                        Compras y Confirmar para cancelar. Con ghost-btn el
                        borde azul hacía que "Cancelar" resaltara MÁS que
                        "Registrar", que es la acción principal. */}
                    <button
                      type="button"
                      className="chip"
                      disabled={guardando}
                      onClick={() => {
                        setCobrando(null);
                        setAvisoCobro("");
                      }}
                    >
                      Cancelar
                    </button>
                    {avisoCobro && <small className="neg-error" role="alert">{avisoCobro}</small>}
                  </div>
                ) : (
                  <button
                    type="button"
                    className="chip"
                    onClick={() => {
                      setCobrando(d.id);
                      // Se propone el saldo completo, que es el caso normal.
                      // Quien cobra una parte lo cambia; quien cobra todo no
                      // tiene que tipear un número que el sistema ya sabe.
                      setMonto(String(d.saldo));
                      setAvisoCobro("");
                    }}
                  >
                    {tipo === "cobrar" ? "Registrar cobro" : "Registrar pago"}
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

/** "15 de agosto", sin `new Date` sobre un ISO pelado (correría el día por zona horaria). */
function formatearDia(iso: string): string {
  const [, mes, dia] = iso.split("-");
  const MESES = [
    "enero", "febrero", "marzo", "abril", "mayo", "junio",
    "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
  ];
  return `${Number(dia)} de ${MESES[Number(mes) - 1]}`;
}

/**
 * La búsqueda, fuera del componente y sin tocar estado.
 *
 * Devuelve los datos o un motivo legible; quien llama decide qué hacer con
 * eso. Separarlo es lo que permite que el efecto no llame a `setState` antes
 * de su primer `await`.
 */
async function traer(tipo: "cobrar" | "pagar"): Promise<Respuesta | { error: string }> {
  try {
    const r = await fetch(`/api/erp/cartera?tipo=${tipo}`, { cache: "no-store" });
    if (r.status === 403) return { error: "Tu plan no incluye el módulo de negocio." };
    if (!r.ok) return { error: "No pudimos leer tu estado de cuenta." };
    return (await r.json()) as Respuesta;
  } catch {
    return { error: "No pudimos leer tu estado de cuenta." };
  }
}
