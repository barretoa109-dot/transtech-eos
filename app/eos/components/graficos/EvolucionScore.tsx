"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Minus, TrendingDown, TrendingUp } from "lucide-react";
import { indicesDeEtiquetas } from "@/lib/grafico/escala";
import {
  curvaD,
  diasEntre,
  masCercano,
  resumir,
  unoPorDia,
  ventana,
  zona,
  type PuntoScore,
} from "@/lib/grafico/serieScore";

const PERIODOS = [
  { dias: 7, label: "7 días" },
  { dias: 30, label: "30 días" },
  { dias: 90, label: "90 días" },
  { dias: 365, label: "1 año" },
] as const;

const ALTO = 220;
const M = { izq: 30, der: 14, arriba: 14, abajo: 28 };
const MARCAS_Y = [0, 25, 50, 75, 100];

const ZONA_TEXTO = { bajo: "Crítico", medio: "En desarrollo", alto: "Saludable" } as const;

/**
 * "Evolución del EOS Score", rehecho desde cero.
 *
 * Lo que tenía mal el anterior, y por qué cada cosa está como está:
 *
 * - Un viewBox de 640 estirado con `preserveAspectRatio="none"`: en un
 *   teléfono las fechas salían aplastadas a ~5px e ilegibles. Acá el ancho se
 *   MIDE y una unidad del SVG es un píxel, igual que en `LineaSVG`.
 * - La escala vertical salía de los datos (`min * 0.85`, `max * 1.08`): con
 *   todos los scores en 0 el rango colapsaba y la línea quedaba pegada al piso
 *   sin ninguna referencia. El score va de 0 a 100 por definición, así que el
 *   eje también, con las marcas escritas.
 * - Las fechas se parseaban como UTC y se formateaban en hora de Paraguay: cada
 *   etiqueta mostraba el día anterior al del briefing.
 * - No se podía leer ningún valor salvo el último. Ahora tocar o pasar el
 *   mouse muestra fecha, score y cambio contra el briefing anterior.
 * - Los filtros de período recortaban un historial que la API cortaba en 7
 *   filas. La serie ahora llega aparte, con un año de datos.
 */
export type FuenteScore = {
  clave: string;
  /** Lo que dice el selector cuando hay más de una fuente. */
  label: string;
  puntos: PuntoScore[];
  /** "día" para los scores rearmados desde indicadores, "briefing" para los del briefing. */
  unidad: "día" | "briefing";
};

export default function EvolucionScore({
  fuentes,
  motivosSinScore = [],
}: {
  fuentes: FuenteScore[];
  /** Por qué no se pudo calcular el score real, cuando el gráfico cae al del briefing. */
  motivosSinScore?: string[];
}) {
  const [dias, setDias] = useState<number>(30);
  const [claveFuente, setClaveFuente] = useState<string | null>(null);
  const fuente = fuentes.find((f) => f.clave === claveFuente) ?? fuentes[0];
  const puntos = useMemo(() => fuente?.puntos ?? [], [fuente]);
  const unidad = fuente?.unidad ?? "briefing";
  const plural = unidad === "día" ? "días con datos" : "briefings";
  const [activo, setActivo] = useState<number | null>(null);
  const idGradiente = useId().replace(/:/g, "");

  const contenedor = useRef<HTMLDivElement>(null);
  const [ancho, setAncho] = useState(600);

  useEffect(() => {
    const nodo = contenedor.current;
    if (!nodo) return;
    const observador = new ResizeObserver(([entrada]) => {
      const medido = entrada.contentRect.width;
      if (medido > 0) setAncho(medido);
    });
    observador.observe(nodo);
    return () => observador.disconnect();
  }, []);

  const serieCompleta = useMemo(() => unoPorDia(puntos), [puntos]);
  const serie = useMemo(() => ventana(serieCompleta, dias, hoyEnParaguay()), [serieCompleta, dias]);
  const resumen = resumir(serie);

  // Si el período elegido quedó vacío pero hay datos más viejos, se dice así en
  // vez de mostrar "todavía no hay historial", que sería falso.
  const hayMasViejos = serie.length === 0 && serieCompleta.length > 0;

  const utilAncho = Math.max(1, ancho - M.izq - M.der);
  const piso = ALTO - M.abajo;
  const utilAlto = piso - M.arriba;

  // El eje x es por FECHA, no por índice: si faltó el briefing tres días, la
  // distancia entre los dos puntos tiene que mostrarlo.
  const primera = serie[0]?.fecha;
  const tramo = primera ? Math.max(1, diasEntre(primera, serie[serie.length - 1].fecha)) : 1;
  const x = (fecha: string) =>
    serie.length <= 1 ? M.izq + utilAncho / 2 : M.izq + (diasEntre(primera!, fecha) / tramo) * utilAncho;
  const y = (v: number) => M.arriba + (1 - v / 100) * utilAlto;

  const pts = serie.map((p) => ({ x: x(p.fecha), y: y(p.score) }));
  const linea = curvaD(pts);
  const area =
    pts.length > 1 ? `${linea} L${pts[pts.length - 1].x.toFixed(1)},${piso} L${pts[0].x.toFixed(1)},${piso} Z` : "";

  const etiquetas = indicesDeEtiquetas(serie.length, utilAncho, 58);
  const mostrarPuntos = serie.length <= 31;
  // Solo el score del briefing tiene ceros de relleno; uno rearmado desde los
  // indicadores que da 0 es un 0 de verdad y no lleva este aviso.
  const todoCero = unidad === "briefing" && serie.length > 0 && serie.every((p) => p.score === 0);

  const iActivo = activo !== null && activo < serie.length ? activo : null;
  const puntoActivo = iActivo !== null ? serie[iActivo] : null;
  const previoActivo = iActivo !== null && iActivo > 0 ? serie[iActivo - 1] : null;

  function elegirPorPuntero(evento: React.PointerEvent<SVGSVGElement>) {
    if (pts.length === 0) return;
    const caja = evento.currentTarget.getBoundingClientRect();
    setActivo(masCercano(pts.map((p) => p.x), evento.clientX - caja.left));
  }

  function mover(evento: React.KeyboardEvent<SVGSVGElement>) {
    if (serie.length === 0) return;
    const ultimo = serie.length - 1;
    if (evento.key === "ArrowLeft") setActivo((a) => Math.max(0, (a ?? ultimo + 1) - 1));
    else if (evento.key === "ArrowRight") setActivo((a) => Math.min(ultimo, (a ?? -1) + 1));
    else if (evento.key === "Home") setActivo(0);
    else if (evento.key === "End") setActivo(ultimo);
    else if (evento.key === "Escape") setActivo(null);
    else return;
    evento.preventDefault();
  }

  const cambio = resumen?.cambio ?? null;
  const tendencia = cambio === null || cambio === 0 ? "igual" : cambio > 0 ? "sube" : "baja";

  return (
    <div className="card evo-card">
      <div className="evo-head">
        <div>
          <div className="card-title">Evolución del EOS Score</div>
          <div className="card-sub evo-sub">
            {serie.length === 0
              ? "Sin datos en este período"
              : `${serie.length} ${serie.length === 1 ? (unidad === "día" ? "día con datos" : "briefing") : plural} en los últimos ${dias} días`}
          </div>
        </div>
        <div className="evo-controles">
        {fuentes.length > 1 && (
          <div className="evo-periodos evo-fuentes" role="group" aria-label="Qué score mirar">
            {fuentes.map((f) => (
              <button
                key={f.clave}
                type="button"
                className={fuente?.clave === f.clave ? "activo" : ""}
                aria-pressed={fuente?.clave === f.clave}
                onClick={() => {
                  setClaveFuente(f.clave);
                  setActivo(null);
                }}
              >
                {f.label}
              </button>
            ))}
          </div>
        )}
        <div className="evo-periodos" role="group" aria-label="Período del gráfico">
          {PERIODOS.map((p) => (
            <button
              key={p.dias}
              type="button"
              className={dias === p.dias ? "activo" : ""}
              aria-pressed={dias === p.dias}
              onClick={() => {
                setDias(p.dias);
                setActivo(null);
              }}
            >
              {p.label}
            </button>
          ))}
        </div>
        </div>
      </div>

      {resumen && (
        <div className="evo-resumen">
          <div className="evo-actual">
            <span className="evo-numero">{resumen.actual}</span>
            <span className="evo-de">/100</span>
            <span className={`evo-zona ${zona(resumen.actual)}`}>{ZONA_TEXTO[zona(resumen.actual)]}</span>
          </div>
          {cambio !== null && (
            <div className={`evo-cambio ${tendencia}`}>
              {tendencia === "sube" ? <TrendingUp size={14} /> : tendencia === "baja" ? <TrendingDown size={14} /> : <Minus size={14} />}
              {cambio > 0 ? "+" : ""}
              {cambio} pts <span>en el período</span>
            </div>
          )}
          <dl className="evo-stats">
            <div>
              <dt>Promedio</dt>
              <dd>{resumen.promedio}</dd>
            </div>
            <div>
              <dt>Máximo</dt>
              <dd>{resumen.maximo}</dd>
            </div>
            <div>
              <dt>Mínimo</dt>
              <dd>{resumen.minimo}</dd>
            </div>
          </dl>
        </div>
      )}

      <div ref={contenedor} className="evo-lienzo">
        {serie.length === 0 ? (
          <div className="chart-empty">
            {hayMasViejos
              ? "No hay datos en este período. Probá con un período más largo."
              : "Todavía no hay historial. Cada día EOS suma un punto a este gráfico."}
          </div>
        ) : (
          <>
            <svg
              key={`${fuente?.clave}-${dias}`}
              className="evo-svg"
              width={ancho}
              height={ALTO}
              viewBox={`0 0 ${ancho} ${ALTO}`}
              role="img"
              aria-label={`Evolución del EOS Score: ${serie.length} ${plural}, score actual ${resumen?.actual ?? 0} sobre 100.`}
              tabIndex={0}
              onPointerDown={elegirPorPuntero}
              onPointerMove={elegirPorPuntero}
              onPointerLeave={(e) => {
                if (e.pointerType === "mouse") setActivo(null);
              }}
              onKeyDown={mover}
              onBlur={() => setActivo(null)}
            >
              <defs>
                <linearGradient id={idGradiente} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="currentColor" stopOpacity="0.28" />
                  <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
                </linearGradient>
              </defs>

              {/* Las tres franjas de fondo: dan lectura sin tener que saber qué es "bueno". */}
              <rect className="evo-franja alto" x={M.izq} y={y(100)} width={utilAncho} height={y(70) - y(100)} />
              <rect className="evo-franja medio" x={M.izq} y={y(70)} width={utilAncho} height={y(40) - y(70)} />
              <rect className="evo-franja bajo" x={M.izq} y={y(40)} width={utilAncho} height={y(0) - y(40)} />

              {MARCAS_Y.map((v) => (
                <g key={v}>
                  <line className={`evo-grilla ${v === 0 ? "base" : ""}`} x1={M.izq} x2={ancho - M.der} y1={y(v)} y2={y(v)} />
                  <text className="evo-eje-y" x={M.izq - 8} y={y(v)} dy="0.32em" textAnchor="end">
                    {v}
                  </text>
                </g>
              ))}

              {area && <path className="evo-area" d={area} fill={`url(#${idGradiente})`} />}
              {pts.length > 1 && <path className="evo-linea" d={linea} pathLength={1} />}

              {puntoActivo && (
                <line
                  className="evo-guia"
                  x1={pts[iActivo!].x}
                  x2={pts[iActivo!].x}
                  y1={M.arriba}
                  y2={piso}
                />
              )}

              {pts.map((p, i) => {
                const ultimo = i === pts.length - 1;
                const esActivo = i === iActivo;
                if (!mostrarPuntos && !ultimo && !esActivo) return null;
                return (
                  <g key={serie[i].fecha}>
                    {(ultimo || esActivo) && <circle className="evo-halo" cx={p.x} cy={p.y} r={10} />}
                    <circle
                      className={`evo-punto ${ultimo ? "ultimo" : ""} ${esActivo ? "activo" : ""}`}
                      cx={p.x}
                      cy={p.y}
                      r={esActivo || ultimo ? 5 : 3.5}
                    />
                  </g>
                );
              })}

              {etiquetas.map((i) => (
                <text
                  key={i}
                  className="evo-eje-x"
                  x={pts[i].x}
                  y={ALTO - 8}
                  textAnchor={
                    serie.length === 1 ? "middle" : i === 0 ? "start" : i === serie.length - 1 ? "end" : "middle"
                  }
                >
                  {fechaCorta(serie[i].fecha)}
                </text>
              ))}
            </svg>

            {puntoActivo && (
              <div
                className="evo-tooltip"
                style={{
                  left: Math.min(Math.max(pts[iActivo!].x, 70), ancho - 70),
                  top: pts[iActivo!].y,
                }}
                role="status"
              >
                <div className="evo-tt-fecha">{fechaLarga(puntoActivo.fecha)}</div>
                <div className="evo-tt-valor">
                  <strong>{puntoActivo.score}</strong>/100
                </div>
                {previoActivo && (
                  <div
                    className={`evo-tt-delta ${
                      puntoActivo.score > previoActivo.score ? "sube" : puntoActivo.score < previoActivo.score ? "baja" : "igual"
                    }`}
                  >
                    {puntoActivo.score - previoActivo.score > 0 ? "+" : ""}
                    {puntoActivo.score - previoActivo.score} vs. {fechaCorta(previoActivo.fecha)}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {serie.length === 1 && (
        <p className="evo-nota">Mañana se suma otro punto y vas a ver hacia dónde va la tendencia.</p>
      )}
      {unidad === "briefing" && motivosSinScore.length > 0 ? (
        <div className="evo-nota aviso">
          <strong>Por qué el score no se puede calcular todavía:</strong>
          <ul className="evo-motivos">
            {motivosSinScore.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </div>
      ) : (
        todoCero && (
          <p className="evo-nota aviso">
            Todos los briefings de este período tienen score 0: EOS todavía no tuvo datos suficientes para puntuar tu
            situación. Registrá objetivos, tareas y movimientos para que el score empiece a reflejarla.
          </p>
        )
      )}
    </div>
  );
}

/*
 * Las fechas se formatean en UTC a propósito: `briefing_date` es un día, no un
 * instante. Leído como medianoche UTC y mostrado en hora de Paraguay (UTC-3)
 * caía en el día anterior, que es lo que hacía el gráfico viejo.
 */
function fechaCorta(fecha: string): string {
  return new Date(`${fecha}T00:00:00Z`)
    .toLocaleDateString("es-PY", { day: "numeric", month: "short", timeZone: "UTC" })
    .replace(".", "");
}

function fechaLarga(fecha: string): string {
  const texto = new Date(`${fecha}T00:00:00Z`).toLocaleDateString("es-PY", {
    weekday: "short",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

function hoyEnParaguay(): string {
  const partes = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Asuncion",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(new Date())
      .map((p) => [p.type, p.value]),
  );
  return `${partes.year}-${partes.month}-${partes.day}`;
}
