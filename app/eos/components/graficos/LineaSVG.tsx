"use client";

import { useEffect, useRef, useState } from "react";
import { areaD, escalar, indicesDeEtiquetas, lineaD, tramos } from "@/lib/grafico/escala";

/**
 * Una línea con su área, dibujada sobre el andamiaje compartido.
 *
 * Toda la aritmética vive en `lib/grafico/escala.ts` y está testeada ahí. Acá
 * queda solo el SVG. `children` recibe las escalas ya armadas para que quien
 * lo use pueda dibujar sus propias marcas —una franja, un cruce, un umbral—
 * en el mismo sistema de coordenadas, sin que este componente tenga que
 * conocerlas.
 */
export default function LineaSVG({
  puntos,
  alto = 180,
  etiqueta,
  desdeCero = false,
  titulo,
  children,
}: {
  /** Un valor null es un día sin dato: deja hueco, no se dibuja como cero. */
  puntos: { fecha: string; valor: number | null }[];
  alto?: number;
  /** Cómo se escribe la fecha bajo el eje. */
  etiqueta: (fecha: string) => string;
  desdeCero?: boolean;
  titulo: string;
  children?: (e: ReturnType<typeof escalar>) => React.ReactNode;
}) {
  /*
   * El ancho se MIDE, no se fija.
   *
   * Un viewBox fijo escalado por CSS comprime todo lo de adentro, incluido el
   * texto: medido acá, un viewBox de 640 dentro de un contenedor de 300px
   * dejaba las etiquetas de 10,5px renderizando a 6,3px, ilegibles. Es
   * exactamente el bug que `FinanzasTrayectoria` ya había resuelto midiendo su
   * contenedor, y está documentado en `eosApp.css`.
   *
   * Con el ancho real, una unidad del SVG es un píxel y el texto sale como
   * texto en cualquier pantalla.
   */
  const contenedor = useRef<HTMLDivElement>(null);
  const [ancho, setAncho] = useState(640);

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
  const conValor = puntos
    .map((p, i) => ({ i, v: p.valor }))
    .filter((p): p is { i: number; v: number } => p.v !== null);

  const e = escalar(
    conValor.map((p) => p.v),
    { ancho, alto, ...(desdeCero ? { min: 0 } : {}) },
  );

  // Las escalas se arman con los valores, pero el eje x se recorre por la
  // cantidad total de puntos: si se usara solo los que tienen valor, un hueco
  // de tres días se vería como un día y la serie mentiría sobre el tiempo.
  const ex = escalar(
    puntos.map((_, i) => i),
    { ancho, alto, ...(desdeCero ? { min: 0 } : {}) },
  );
  const escala = { ...e, x: ex.x };

  const marcas = indicesDeEtiquetas(puntos.length, ancho);

  if (conValor.length === 0) {
    return (
      <div ref={contenedor}>
        <p className="chart-empty">Todavía no hay historia de este indicador.</p>
      </div>
    );
  }

  return (
    <div ref={contenedor} className="kpi-linea-caja">
    <svg
      className="kpi-linea"
      width={ancho}
      height={alto}
      viewBox={`0 0 ${ancho} ${alto}`}
      role="img"
      aria-label={titulo}
    >
      <defs>
        <linearGradient id="kpiLineaGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#1656bd" stopOpacity="0.20" />
          <stop offset="100%" stopColor="#1656bd" stopOpacity="0" />
        </linearGradient>
      </defs>

      {children?.(escala)}

      <path className="kpi-linea-area" d={areaD(conValor, escala)} />

      {/* Primero el puente punteado entre tramos, debajo del trazo sólido:
          marca que ahí no hubo dato en vez de afirmar un recorrido. */}
      <path className="kpi-linea-hueco" d={lineaD(conValor, escala)} />

      {tramos(conValor).map((t, n) => (
        <path key={n} className="kpi-linea-trazo" d={lineaD(t, escala)} />
      ))}

      {conValor.length > 0 && (
        <circle
          className="kpi-linea-hoy"
          cx={escala.x(conValor[conValor.length - 1].i)}
          cy={escala.y(conValor[conValor.length - 1].v)}
          r={4}
        />
      )}

      {marcas.map((i) => (
        <text
          key={i}
          className="axis-label"
          x={escala.x(i)}
          y={alto - 8}
          // La primera y la última se anclan a su borde: centradas se salen
          // del recuadro y el navegador las recorta a la mitad. Es la misma
          // corrección que ya tenía FinanzasTrayectoria.
          textAnchor={i === 0 ? "start" : i === puntos.length - 1 ? "end" : "middle"}
        >
          {etiqueta(puntos[i].fecha)}
        </text>
      ))}
    </svg>
    </div>
  );
}
