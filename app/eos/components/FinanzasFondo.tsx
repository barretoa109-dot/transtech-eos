"use client";

import { useCallback, useEffect, useState } from "react";
import { LifeBuoy } from "lucide-react";

import { formatearMonto } from "@/lib/finanzas/formato";

type Opcion = { meses: number; meta: number; falta: number; aporte_mensual: number };

type Fondo = {
  gasto_esencial: number;
  base: "observado" | "declarado";
  detalle: { etiqueta: string; monto: number }[];
  sin_reconocer: number;
  fondo_actual: number;
  meses_cubiertos: number | null;
  meses_elegidos: number | null;
  meta: number | null;
  falta: number | null;
  aporte_mensual: number | null;
  opciones: Opcion[];
  sugerencia: { meses: number; porque: string } | null;
  confianza: { nivel: number; motivos: string[] };
};

type Respuesta = {
  configurado?: boolean;
  fondo?: Fondo;
  /** El objetivo que respalda al fondo, si ya existe. */
  fondo_objetivo?: { id: string } | null;
};

/**
 * El fondo de emergencia, con los números de esta persona.
 *
 * ============================================================
 * LA PREGUNTA VA ANTES QUE EL CONSEJO
 * ============================================================
 *
 * "Tres a seis meses" es la recomendación más repetida de la educación
 * financiera y viene de economías con seguro de desempleo. Acá no se afirma:
 * se muestra lo que cuesta CADA opción con el gasto esencial real de la
 * persona, y elige ella.
 *
 * Cuando EOS tiene un dato que sostenga una sugerencia —que el ingreso llega
 * parejo o que varía— la dice CON el motivo al lado. Sin dato, no sugiere.
 *
 * ============================================================
 * PRIMERO CUÁNTO AGUANTA HOY
 * ============================================================
 *
 * "Si hoy se corta tu ingreso, aguantás 1,2 meses" es la respuesta a la
 * pregunta que trae quien abre esto. La meta y el aporte vienen después.
 */
export default function FinanzasFondo({ moneda = "PYG" }: { moneda?: string }) {
  const [datos, setDatos] = useState<Respuesta | null>(null);
  const [guardando, setGuardando] = useState(false);

  const cargar = useCallback(() => {
    return fetch("/api/finanzas/objetivos", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("fallo"))))
      .then(setDatos)
      .catch(() => setDatos(null));
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const fondo = datos?.fondo;
  if (!datos || datos.configurado === false || !fondo) return null;

  // Sin saber cuánto cuesta un mes de vida no hay fondo que calcular, y una
  // tarjeta que dice "no sé nada" no vale el espacio que ocupa.
  if (fondo.gasto_esencial <= 0) return null;

  const fmt = (n: number) => formatearMonto(n, moneda);
  const cubiertos = fondo.meses_cubiertos ?? 0;

  /** Adoptar una cobertura crea el objetivo si no existía, o lo actualiza. */
  async function elegir(meses: number) {
    setGuardando(true);
    try {
      const existente = datos?.fondo_objetivo ?? null;

      await fetch("/api/finanzas/objetivos", {
        method: existente ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          existente
            ? { id: existente.id, meses_cobertura: meses }
            : {
                titulo: "Fondo de emergencia",
                clase: "fondo_emergencia",
                valor_objetivo: (fondo?.gasto_esencial ?? 0) * meses,
                valor_actual: fondo?.fondo_actual ?? 0,
                meses_cobertura: meses,
                // El más importante de todos: es el que sostiene a los demás
                // cuando algo sale mal.
                prioridad: 1,
                moneda,
              },
        ),
      });

      await cargar();
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="card fin-card">
      <div className="fin-head">
        <span
          className={`fin-badge ${cubiertos >= 3 ? "fin-badge-seguro" : cubiertos >= 1 ? "fin-badge-atencion" : "fin-badge-accion"}`}
        >
          <LifeBuoy size={14} />
          SI SE CORTA TU INGRESO
        </span>
      </div>

      {/* La conclusión primero. */}
      <p className="prose" style={{ marginTop: 8, marginBottom: 12, fontSize: 14 }}>
        {fondo.fondo_actual > 0 ? (
          <>
            Con <strong>{fmt(fondo.fondo_actual)}</strong> apartados aguantás{" "}
            <strong>{redondearMeses(cubiertos)}</strong>, porque un mes tuyo cuesta{" "}
            {fmt(fondo.gasto_esencial)}.
          </>
        ) : (
          <>
            Un mes tuyo cuesta <strong>{fmt(fondo.gasto_esencial)}</strong> en lo que se paga sí o
            sí. Hoy no tenés nada apartado para cubrirlo.
          </>
        )}
      </p>

      {/* Cuando ya eligió, la meta y el aporte. */}
      {fondo.meses_elegidos !== null && fondo.meta !== null ? (
        <div className="fin-rows">
          <div className="fin-row">
            <span className="fin-row-label">
              Elegiste cubrir {fondo.meses_elegidos} {fondo.meses_elegidos === 1 ? "mes" : "meses"}
            </span>
            <span className="fin-row-value">{fmt(fondo.meta)}</span>
          </div>
          <div className="fin-row">
            <span className="fin-row-label">Te falta</span>
            <span className="fin-row-value">{fmt(fondo.falta ?? 0)}</span>
          </div>
          {(fondo.aporte_mensual ?? 0) > 0 && (
            <div className="fin-row">
              <span className="fin-row-label">
                <strong>Apartando por mes lo tenés en un año</strong>
              </span>
              <span className="fin-row-value">
                <strong>{fmt(fondo.aporte_mensual ?? 0)}</strong>
              </span>
            </div>
          )}
        </div>
      ) : (
        <>
          <p className="prose" style={{ fontSize: 13, marginBottom: 8 }}>
            ¿Cuántos meses querés poder cubrir? No hay un número correcto: depende de cuánto
            tardarías en reemplazar tu ingreso.
          </p>

          <div style={{ display: "grid", gap: 6 }}>
            {fondo.opciones.map((o) => (
              <button
                key={o.meses}
                type="button"
                className="reco-btn"
                onClick={() => void elegir(o.meses)}
                disabled={guardando}
                style={{ cursor: guardando ? "wait" : "pointer", textAlign: "left" }}
              >
                <strong>{o.meses} meses</strong> · {fmt(o.meta)}
                {o.falta > 0 ? <> · apartando {fmt(o.aporte_mensual)} por mes llegás en un año</> : <> · ya lo tenés</>}
              </button>
            ))}
          </div>
        </>
      )}

      {/* La sugerencia, siempre con su motivo. */}
      {fondo.sugerencia && fondo.meses_elegidos === null && (
        <p className="prose" style={{ marginTop: 10, fontSize: 13 }}>
          Yo miraría los {fondo.sugerencia.meses} meses: {fondo.sugerencia.porque}.
        </p>
      )}

      {/* De dónde salió el gasto esencial. */}
      <p className="prose" style={{ marginTop: 10, fontSize: 12, opacity: 0.65 }}>
        {fondo.base === "declarado"
          ? `Ese mes sale de lo que declaraste como fijo y de tus cuotas: ${fondo.detalle
              .slice(0, 3)
              .map((d) => d.etiqueta)
              .join(", ")}${fondo.detalle.length > 3 ? ` y ${fondo.detalle.length - 3} más` : ""}.`
          : "Ese mes sale de lo que te veo gastar en vivienda, servicios, mercado, salud, transporte, colegio, cuotas e impuestos. La comida fuera y las suscripciones quedan afuera porque son lo primero que se recorta."}
        {fondo.sin_reconocer > 0 && (
          <> Hay {fmt(fondo.sin_reconocer)} por mes que todavía no supe clasificar y no conté.</>
        )}
      </p>

      {fondo.confianza.motivos.length > 0 && (
        <p className="prose" style={{ marginTop: 6, fontSize: 12, opacity: 0.6 }}>
          {fondo.confianza.motivos.join("; ")}.
        </p>
      )}
    </div>
  );
}

/** "1,2 meses" se lee peor que "poco más de un mes" cuando el número es chico. */
function redondearMeses(meses: number): string {
  if (meses < 1) {
    const dias = Math.round(meses * 30);
    return dias <= 1 ? "menos de un día" : `unos ${dias} días`;
  }
  if (meses < 2) return "poco más de un mes";

  return `${meses.toFixed(1).replace(".", ",").replace(",0", "")} meses`;
}
