"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowDownLeft, ArrowUpRight, CalendarClock } from "lucide-react";

import { formatearMonto } from "@/lib/finanzas/formato";
import { correrSaldo, primerApriete } from "@/lib/finanzas/calendario";

type Evento = {
  fecha: string;
  descripcion: string;
  monto: number;
  direccion: "entra" | "sale";
  fuente: "anotado" | "previsible" | "cuota";
  confianza: number;
};

type Respuesta = {
  configurado?: boolean;
  moneda?: string;
  desde?: string;
  hasta?: string;
  saldo_actual?: number;
  reserva_minima?: number;
  eventos?: Evento[];
};

const HORIZONTES = [
  { dias: 7, etiqueta: "7 días" },
  { dias: 30, etiqueta: "30 días" },
  { dias: 90, etiqueta: "90 días" },
] as const;

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

/**
 * Lo que viene, en orden, con el saldo que va quedando.
 *
 * ============================================================
 * LA CURVA DICE CUÁNTO; ESTO DICE QUÉ
 * ============================================================
 *
 * La trayectoria del saldo ya existía y es la que avisa "el 28 te vas a quedar
 * corto". Pero alguien que ve la línea bajar el 25 no sabe si es el alquiler,
 * la tarjeta o la cuota del auto, y esas tres se resuelven de maneras
 * distintas: una se negocia, otra se pospone, la tercera no se toca.
 *
 * La lista es lo que convierte un pronóstico en algo sobre lo que se puede
 * actuar.
 *
 * ============================================================
 * EL SALDO DESPUÉS DE CADA EVENTO
 * ============================================================
 *
 * Es la columna que hace el trabajo. Ver "alquiler 2.000.000" no dice nada por
 * sí solo; ver que después del alquiler quedan 180.000 y que la cuota del auto
 * vence tres días más tarde dice todo, y lo dice sin que la persona sume nada.
 *
 * Cuando ese saldo cruza la reserva mínima, la fila se marca. Ahí está el
 * problema, con nombre y fecha.
 *
 * ============================================================
 * LO ANOTADO Y LO DEDUCIDO NO SE MUESTRAN IGUAL
 * ============================================================
 *
 * Un fijo declarado va a pasar. Una serie que EOS dedujo de verla repetirse
 * puede no pasar. Presentar las dos con la misma cara convertiría una
 * estimación en un compromiso, que es la clase de precisión falsa que este
 * panel tiene prohibida.
 */
export default function FinanzasCalendario({ moneda = "PYG" }: { moneda?: string }) {
  const [datos, setDatos] = useState<Respuesta | null>(null);
  const [dias, setDias] = useState<number>(30);

  const cargar = useCallback(() => {
    return fetch("/api/finanzas/calendario", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("fallo"))))
      .then(setDatos)
      .catch(() => setDatos(null));
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const eventos = useMemo(() => (datos?.eventos ?? []) as Evento[], [datos]);

  /*
   * La cuenta vive en `lib/finanzas/calendario.ts`, con sus pruebas.
   *
   * El error que esconde este cálculo es que el saldo se acumule solo sobre
   * los eventos VISIBLES: alguien que mira 7 días vería el saldo de una cuenta
   * que empieza hoy en vez del suyo, y sería creíble. Eso está probado allá,
   * no confiado a que acá nadie lo toque.
   */
  const filas = useMemo(
    () =>
      correrSaldo({
        eventos,
        saldoInicial: datos?.saldo_actual ?? 0,
        reservaMinima: datos?.reserva_minima ?? 0,
        hasta: fechaMas(datos?.desde ?? "", dias),
      }),
    [eventos, dias, datos],
  );

  if (!datos || datos.configurado === false) return null;
  if (eventos.length === 0) return null;

  const reserva = datos.reserva_minima ?? 0;
  const primerRojo = primerApriete(filas);

  return (
    <div className="card fin-card">
      <div className="fin-head">
        <span className={`fin-badge ${primerRojo ? "fin-badge-atencion" : "fin-badge-neutral"}`}>
          <CalendarClock size={14} />
          LO QUE VIENE
        </span>
      </div>

      <div className="chip-row" style={{ marginTop: 8, marginBottom: 12 }}>
        {HORIZONTES.map((h) => (
          <button
            key={h.dias}
            type="button"
            className={`chip${dias === h.dias ? " active" : ""}`}
            onClick={() => setDias(h.dias)}
          >
            {h.etiqueta}
          </button>
        ))}
      </div>

      {/* El aviso primero: si hay un día en que no alcanza, eso es lo que la
          persona vino a saber, y no tiene que encontrarlo leyendo la lista. */}
      {primerRojo && (
        <p className="prose" style={{ marginBottom: 12, fontSize: 13 }}>
          <AlertTriangle size={13} style={{ display: "inline", marginRight: 5, verticalAlign: -2 }} />
          El {dia(primerRojo.fecha)}, después de {primerRojo.descripcion}, te quedarían{" "}
          <strong>{formatearMonto(primerRojo.saldo, moneda)}</strong>
          {reserva > 0 ? (
            <>
              {" "}
              — por debajo del colchón de {formatearMonto(reserva, moneda)} que pediste mantener.
            </>
          ) : (
            <> en rojo.</>
          )}
        </p>
      )}

      {filas.length === 0 ? (
        <p className="empty-note">
          No viene nada en {dias === 7 ? "la semana" : `los próximos ${dias} días`}.
        </p>
      ) : (
        <div className="fin-rows">
          {filas.map((f, i) => (
            <div
              className="fin-row"
              key={`${f.fecha}-${f.descripcion}-${i}`}
              style={{ alignItems: "flex-start" }}
            >
              <span className="fin-row-label">
                {f.direccion === "entra" ? (
                  <ArrowUpRight size={12} style={{ display: "inline", marginRight: 5, verticalAlign: -1 }} />
                ) : (
                  <ArrowDownLeft size={12} style={{ display: "inline", marginRight: 5, verticalAlign: -1 }} />
                )}
                <strong>{dia(f.fecha)}</strong> · {f.descripcion}
                {/* Lo deducido se dice, no se disimula. */}
                {f.fuente === "previsible" && (
                  <span className="prose" style={{ display: "block", fontSize: 12, opacity: 0.65 }}>
                    lo deduje de verlo repetirse
                  </span>
                )}
                {f.fuente === "cuota" && (
                  <span className="prose" style={{ display: "block", fontSize: 12, opacity: 0.65 }}>
                    cuota de una deuda
                  </span>
                )}
              </span>

              <span style={{ textAlign: "right" }}>
                <span className={`fin-row-value ${f.direccion === "entra" ? "is-ok" : ""}`}>
                  {f.direccion === "entra" ? "+" : "−"} {formatearMonto(f.monto, moneda)}
                </span>
                {/* La columna que hace el trabajo: qué queda después. */}
                <span
                  className="prose"
                  style={{
                    display: "block",
                    fontSize: 12,
                    opacity: f.bajoReserva ? 1 : 0.6,
                    color: f.bajoReserva ? "var(--red-texto)" : undefined,
                  }}
                >
                  quedan {formatearMonto(f.saldo, moneda)}
                </span>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function dia(iso: string): string {
  const [, mes, numero] = iso.split("-");
  return `${Number(numero)} ${MESES[Number(mes) - 1] ?? ""}`;
}

function fechaMas(iso: string, dias: number): string {
  if (!iso) return "9999-12-31";
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}
