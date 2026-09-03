"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, CalendarClock, HelpCircle } from "lucide-react";
import { formatearMonto } from "@/lib/finanzas/formato";

/**
 * Lo que viene: la caja a 30, 60 y 90 días.
 *
 * ============================================================
 * LO QUE NO SE CUENTA SE MUESTRA IGUAL
 * ============================================================
 *
 * El pronóstico deja afuera lo que ya venció y no se cobró, porque contarlo
 * daría un número que dice que la plata alcanza cuando no alcanza. Pero
 * dejarlo afuera Y no mostrarlo sería peor: alguien miraría un pronóstico
 * flaco sin entender que hay una fortuna en la calle. Va en su propia tarjeta,
 * al lado, con la lectura de por qué está aparte.
 *
 * ============================================================
 * LOS SUPUESTOS NO SE ESCONDEN EN UN TOOLTIP
 * ============================================================
 *
 * "Cada documento se cobra el día que vence" es una afirmación fuerte y casi
 * nunca cierta del todo. Va escrita debajo del número, en texto normal, no
 * detrás de un ícono que nadie toca. Un pronóstico cuyos supuestos hay que
 * buscar se lee como un hecho.
 *
 * ============================================================
 * "NO SE SABE" NO ES "ESTÁS BIEN"
 * ============================================================
 *
 * Sin el disponible de hoy no se puede decir qué día se cae la caja. La
 * pantalla dice eso mismo, y no muestra un saldo en cero ni un verde
 * tranquilizador, que es lo que haría creer que ya se comprobó que no hay
 * riesgo.
 */

type Partida = {
  fecha: string;
  monto: number;
  concepto: string;
  certeza: "comprometido" | "esperado" | "estimado";
  origen: "venta" | "compra" | "fijo";
  documento_id: string | null;
};

type Tramo = {
  dias: number;
  hasta: string;
  entradas: number;
  salidas: number;
  neto: number;
  saldo_proyectado: number | null;
  partidas: Partida[];
};

type Moneda = {
  moneda: string;
  saldo_inicial: number | null;
  tramos: Tramo[];
  vencido_sin_cobrar: number;
  vencido_documentos: number;
  vencido_sin_pagar: number;
  supuestos: string[];
  faltantes: string[];
  rojo: { fecha: string; saldo: number } | null;
};

type Escenario = {
  pregunta: string;
  diferencia: { moneda: string; neto: number; saldo: number | null }[];
  supuestos: string[];
};

type Respuesta = { hoy: string; monedas: Moneda[]; escenarios: Escenario[] };

export default function Pronostico() {
  const [datos, setDatos] = useState<Respuesta | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [dias, setDias] = useState(30);

  useEffect(() => {
    let vivo = true;
    (async () => {
      const res = await traer();
      if (!vivo) return;
      if ("error" in res) setError(res.error);
      else setDatos(res);
      setCargando(false);
    })();
    return () => {
      vivo = false;
    };
  }, []);

  if (cargando) return <p className="neg-loading">Calculando lo que viene…</p>;
  if (error) return <p className="neg-load-error">{error}</p>;
  if (!datos) return null;

  if (datos.monedas.length === 0) {
    return (
      <p className="neg-empty-state">
        Todavía no hay nada que proyectar. En cuanto cargues ventas o compras con vencimiento, acá
        vas a ver cuánto entra y cuánto sale en los próximos tres meses.
      </p>
    );
  }

  return (
    <div className="neg-pronostico">
      <div className="chip-row">
        {[30, 60, 90].map((d) => (
          <button
            key={d}
            type="button"
            className={`chip ${dias === d ? "active" : ""}`}
            onClick={() => setDias(d)}
          >
            {d} días
          </button>
        ))}
      </div>

      {datos.monedas.map((m) => {
        const t = m.tramos.find((x) => x.dias === dias) ?? m.tramos[0];

        return (
          <div key={m.moneda} className="card" style={{ marginBottom: 16 }}>
            <div className="card-title">
              <CalendarClock size={15} /> Próximos {dias} días en {m.moneda}
            </div>
            <div className="card-sub">Hasta el {formatearDia(t.hasta)}</div>

            <div className="neg-metricas">
              <div className="neg-metrica">
                <span>Entra</span>
                <strong>{formatearMonto(t.entradas, m.moneda)}</strong>
              </div>
              <div className="neg-metrica">
                <span>Sale</span>
                <strong>{formatearMonto(t.salidas, m.moneda)}</strong>
              </div>
              <div className={`neg-metrica${t.neto < 0 ? " is-danger" : ""}`}>
                <span>Queda</span>
                <strong>{formatearMonto(t.neto, m.moneda)}</strong>
              </div>
            </div>

            {/*
              El saldo proyectado solo aparece cuando se conoce el de hoy. Un
              cero acá se leería como "no te queda nada", que es una afirmación
              muy distinta de "no sabemos con cuánto arrancás".
            */}
            {t.saldo_proyectado !== null ? (
              <p className="prose">
                Arrancando con {formatearMonto(m.saldo_inicial ?? 0, m.moneda)}, al{" "}
                {formatearDia(t.hasta)} tendrías{" "}
                <strong>{formatearMonto(t.saldo_proyectado, m.moneda)}</strong>.
              </p>
            ) : null}

            {m.rojo && (
              <p className="neg-error">
                <AlertTriangle size={13} /> La caja se te va a cero el {formatearDia(m.rojo.fecha)}
              </p>
            )}

            {m.supuestos.length > 0 && (
              <div className="pron-supuestos">
                <span className="pron-supuestos-titulo">Esto da por hecho que:</span>
                <ul>
                  {m.supuestos.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ul>
              </div>
            )}

            {m.faltantes.length > 0 && (
              <div className="pron-faltantes">
                {m.faltantes.map((f) => (
                  <p key={f}>{f}</p>
                ))}
              </div>
            )}

            {t.partidas.length > 0 && (
              <>
                <div className="emp-subtitulo">
                  {dias === 30 ? "Qué pasa este mes" : `Qué pasa entre el día ${dias - 30} y el ${dias}`}
                </div>
                <div className="neg-lista">
                  {t.partidas.map((p, i) => (
                    <div key={`${p.documento_id ?? p.concepto}-${p.fecha}-${i}`} className="neg-fila">
                      <div className="neg-fila-texto">
                        <strong>{p.concepto}</strong>
                        <small>
                          {formatearDia(p.fecha)}
                          {p.certeza === "esperado" && " · se repite todos los meses"}
                        </small>
                      </div>
                      <div className={`neg-fila-monto${p.monto < 0 ? " is-danger" : ""}`}>
                        {formatearMonto(p.monto, m.moneda)}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        );
      })}

      {/* Lo que quedó afuera, y por qué. */}
      {datos.monedas
        .filter((m) => m.vencido_sin_cobrar > 0)
        .map((m) => (
          <div key={`vencido-${m.moneda}`} className="card" style={{ marginBottom: 16 }}>
            <div className="card-title">
              <AlertTriangle size={15} /> Fuera del pronóstico
            </div>
            <div className="neg-metricas">
              <div className="neg-metrica is-danger">
                <span>Vencido sin cobrar</span>
                <strong>{formatearMonto(m.vencido_sin_cobrar, m.moneda)}</strong>
                <small className="neg-metrica-nota">
                  {m.vencido_documentos}{" "}
                  {m.vencido_documentos === 1 ? "documento" : "documentos"}
                </small>
              </div>
            </div>
            <p className="prose">
              No se cuenta como que va a entrar: ya no entró cuando debía. Si lo cobrás, el
              pronóstico mejora en ese monto.
            </p>
          </div>
        ))}

      {datos.escenarios.length > 0 && (
        <div className="card">
          <div className="card-title">
            <HelpCircle size={15} /> ¿Y si…?
          </div>
          <div className="card-sub">
            De qué tamaño es cada palanca. No son recomendaciones.
          </div>

          <div className="neg-lista">
            {datos.escenarios.map((e) => (
              <div key={e.pregunta} className="pron-escenario">
                <strong>{e.pregunta}</strong>
                <div className="pron-escenario-cifras">
                  {e.diferencia
                    .filter((d) => d.neto !== 0)
                    .map((d) => (
                      <span key={d.moneda} className={d.neto > 0 ? "is-mejor" : "is-peor"}>
                        {d.neto > 0 ? "+" : ""}
                        {formatearMonto(d.neto, d.moneda)} a 90 días
                      </span>
                    ))}
                  {e.diferencia.every((d) => d.neto === 0) && (
                    <span>No cambia el total a 90 días, solo cuándo se mueve la plata.</span>
                  )}
                </div>
                {e.supuestos.map((s) => (
                  <small key={s}>{s}</small>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** Fuera del componente: así el efecto no toca estado antes de su primer await. */
async function traer(): Promise<Respuesta | { error: string }> {
  try {
    const r = await fetch("/api/pronostico", { cache: "no-store" });
    if (!r.ok) {
      const cuerpo = await r.json().catch(() => ({}));
      return { error: cuerpo?.error ?? "No pudimos calcular tu pronóstico." };
    }
    return (await r.json()) as Respuesta;
  } catch {
    return { error: "No pudimos calcular tu pronóstico." };
  }
}

function formatearDia(fecha: string): string {
  const [a, m, d] = fecha.split("-").map(Number);
  return new Date(Date.UTC(a, m - 1, d)).toLocaleDateString("es-PY", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}
