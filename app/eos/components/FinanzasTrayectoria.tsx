"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ShieldCheck } from "lucide-react";
import { formatearMonto } from "@/lib/finanzas/formato";

/**
 * Los próximos 45 días de tu plata, dibujados.
 *
 * EOS ya calculaba esta curva: `detectarRiesgo` la recorre entera para
 * encontrar el día del aprieto. Lo que faltaba era mostrarla. Hasta ahora el
 * usuario recibía "el 28 te va a faltar 500.000" en una notificación y no
 * tenía dónde ir a ver por qué, ni qué pasa después del 28.
 *
 * Tres decisiones:
 *
 *  - LA LÍNEA DE RESERVA ES EL PROTAGONISTA, no el cero. Cruzar el cero es
 *    quedarse sin plata; cruzar la reserva es quedarse sin colchón, y eso pasa
 *    antes y es lo que EOS promete vigilar. El eje se recorta para que esa
 *    línea siempre se vea, aunque el saldo esté muy arriba.
 *  - EL DÍA MALO SE MARCA, no se explica en un párrafo aparte. El texto del
 *    aviso ya existe y es bueno; acá el trabajo del gráfico es ubicarlo en el
 *    tiempo, que es lo que el texto no puede hacer.
 *  - SIN RIESGO TAMBIÉN SE MUESTRA. Un panel que solo aparece cuando hay
 *    problema entrena a asustarse al verlo. Que esté siempre, y que la mayoría
 *    de los días diga "no hay nada a la vista", es parte de que se pueda creer
 *    cuando dice lo contrario.
 */

type Punto = {
  fecha: string;
  saldo: number;
  piso: number;
  eventos: { descripcion: string; monto: number; tipo: "ingreso" | "egreso" }[];
};

type Respuesta =
  | { configurado: false }
  | {
      configurado: true;
      moneda: string;
      riesgo: { fecha: string; dias: number; faltante: number } | null;
      aviso: string | null;
      trayectoria: {
        puntos: Punto[];
        reservaMinima: number;
        valle: { fecha: string; saldo: number };
        cruce: string | null;
      };
      horizonte: { desde: string; hasta: string };
    };

export default function FinanzasTrayectoria() {
  const [data, setData] = useState<Respuesta | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch("/api/finanzas/riesgo", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("fallo"))))
      .then(setData)
      .catch(() => setError(true));
  }, []);

  if (error || data === null || !data.configurado) return null;

  const { trayectoria, riesgo, aviso, moneda } = data;
  if (trayectoria.puntos.length < 2) return null;

  const fmt = (valor: number) => formatearMonto(valor, moneda);
  const hayRiesgo = Boolean(riesgo && trayectoria.cruce);

  return (
    <div className="card">
      <div className="chart-head">
        <div>
          <div className="card-title">Los próximos 45 días</div>
          <div className="card-sub" style={{ marginBottom: 0 }}>
            Con todo lo que EOS ya sabe que va a entrar y salir
          </div>
        </div>
        <span className={`fin-badge ${hayRiesgo ? "fin-badge-accion" : "fin-badge-seguro"}`}>
          {hayRiesgo ? <AlertTriangle size={14} /> : <ShieldCheck size={14} />}
          {hayRiesgo ? "HAY UN DÍA FLOJO" : "SIN SOBRESALTOS"}
        </span>
      </div>

      <CurvaSaldo trayectoria={trayectoria} fmt={fmt} />

      {hayRiesgo && aviso ? (
        <p className="tray-aviso">{aviso}</p>
      ) : (
        <p className="tray-aviso is-ok">
          Tu saldo no baja de la reserva en todo el período. El punto más flaco es el{" "}
          {formatearDiaMes(trayectoria.valle.fecha)}, con {fmt(trayectoria.valle.saldo)}.
        </p>
      )}
    </div>
  );
}

function CurvaSaldo({
  trayectoria,
  fmt,
}: {
  trayectoria: {
    puntos: Punto[];
    reservaMinima: number;
    valle: { fecha: string; saldo: number };
    cruce: string | null;
  };
  fmt: (valor: number) => string;
}) {
  const { puntos, reservaMinima, cruce } = trayectoria;

  /**
   * El ancho se MIDE, no se estira.
   *
   * Lo natural sería un viewBox fijo con `preserveAspectRatio="none"`, que es
   * lo que hace el gráfico del score. Pero eso escala los ejes de forma
   * despareja: en un teléfono de 375px, un viewBox de 640 se comprime al 44%
   * horizontal contra 100% vertical, y todo el texto de adentro —la etiqueta
   * de la reserva, las fechas, el día del cruce— queda aplastado hasta ser
   * ilegible justo en la pantalla donde más se lo mira.
   *
   * Midiendo el contenedor, el SVG dibuja en píxeles reales y el texto sale
   * como texto en cualquier ancho.
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

  const W = ancho;
  const H = 210;
  const padL = 6;
  const padR = 6;
  const padT = 18;
  const padB = 30;

  const escala = useMemo(() => {
    const saldos = puntos.map((p) => p.saldo);

    // La reserva entra en la escala SIEMPRE. Si el saldo se mantiene muy por
    // encima, la línea quedaría fuera del recuadro y el gráfico dejaría de
    // mostrar justamente aquello contra lo que se está comparando.
    const crudoMin = Math.min(...saldos, reservaMinima, 0);
    const crudoMax = Math.max(...saldos, reservaMinima);
    const margen = (crudoMax - crudoMin) * 0.12 || Math.abs(crudoMax) * 0.12 || 1;

    return { min: crudoMin - margen, max: crudoMax + margen };
  }, [puntos, reservaMinima]);

  const x = (i: number) => padL + (i / (puntos.length - 1)) * (W - padL - padR);
  const y = (v: number) =>
    padT + (1 - (v - escala.min) / (escala.max - escala.min || 1)) * (H - padT - padB);

  const linea = puntos
    .map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.saldo).toFixed(1)}`)
    .join(" ");

  const area = `M${x(0)},${H - padB} L${puntos
    .map((p, i) => `${x(i).toFixed(1)},${y(p.saldo).toFixed(1)}`)
    .join(" L")} L${x(puntos.length - 1)},${H - padB} Z`;

  const yReserva = y(reservaMinima);
  const iCruce = cruce ? puntos.findIndex((p) => p.fecha === cruce) : -1;

  // Cuántas fechas entran sin pisarse. Una etiqueta como "28 ago" mide unos
  // 40px; con 56 de paso quedan separadas y legibles. En un teléfono salen
  // tres o cuatro, que es lo que se puede leer ahí.
  const cabenEtiquetas = Math.max(2, Math.floor((W - padL - padR) / 56));
  const paso = Math.max(1, Math.ceil((puntos.length - 1) / (cabenEtiquetas - 1)));

  return (
    <div className="tray-caja" ref={contenedor}>
    <svg className="tray-svg" width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img"
      aria-label="Saldo proyectado para los próximos 45 días">
      <defs>
        <linearGradient id="trayGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#1656bd" stopOpacity="0.20" />
          <stop offset="100%" stopColor="#1656bd" stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* La franja de abajo es "por debajo de tu reserva": el territorio que
          EOS promete que no vas a pisar sin enterarte antes. */}
      <rect
        className="tray-zona"
        x={padL}
        y={yReserva}
        width={W - padL - padR}
        height={Math.max(0, H - padB - yReserva)}
      />
      <line className="tray-reserva" x1={padL} y1={yReserva} x2={W - padR} y2={yReserva} />
      <text className="tray-reserva-label" x={padL + 4} y={yReserva - 5}>
        Tu reserva · {fmt(reservaMinima)}
      </text>

      <path className="tray-area" d={area} />
      <path className="tray-linea" d={linea} />

      {iCruce >= 0 && (
        <>
          <line className="tray-cruce" x1={x(iCruce)} y1={padT} x2={x(iCruce)} y2={H - padB} />
          <circle className="tray-punto-cruce" cx={x(iCruce)} cy={y(puntos[iCruce].piso)} r={5} />
          <text
            className="tray-cruce-label"
            x={Math.min(x(iCruce) + 6, W - padR - 60)}
            y={padT + 10}
          >
            {formatearDiaMes(cruce as string)}
          </text>
        </>
      )}

      <circle className="tray-hoy" cx={x(0)} cy={y(puntos[0].saldo)} r={4} />

      {puntos.map((p, i) =>
        i % paso === 0 || i === puntos.length - 1 ? (
          <text
            key={p.fecha}
            className="axis-label"
            x={x(i)}
            y={H - 8}
            // La primera y la última se anclan a su borde: centradas se salen
            // del recuadro y el navegador las recorta a la mitad.
            textAnchor={i === 0 ? "start" : i === puntos.length - 1 ? "end" : "middle"}
          >
            {formatearDiaMes(p.fecha)}
          </text>
        ) : null,
      )}
    </svg>
    </div>
  );
}

const MESES_CORTOS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "set", "oct", "nov", "dic"];

/**
 * "28 ago" sin pasar por `new Date`.
 *
 * `new Date("2026-08-28")` es medianoche UTC: formateado en la zona de
 * Paraguay muestra el 27. Un día de corrimiento en el día del aprieto es
 * exactamente el error que hace que nadie vuelva a confiar en el aviso.
 */
function formatearDiaMes(iso: string): string {
  const dia = Number(iso.slice(8, 10));
  const mes = Number(iso.slice(5, 7));
  if (!dia || !mes || mes < 1 || mes > 12) return iso;
  return `${dia} ${MESES_CORTOS[mes - 1]}`;
}
