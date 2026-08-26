"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, HelpCircle, Minus } from "lucide-react";
import { formatearMonto, nombreDelMes } from "@/lib/finanzas/formato";
import { nombreDeMoneda } from "@/lib/finanzas/monedas";

/**
 * A dónde se fue la plata, y de dónde vino.
 *
 * El panel de estado contesta "¿estoy bien?". Esta tarjeta contesta las dos
 * preguntas que vienen enseguida — "¿en qué se me fue?" y "¿de dónde me
 * entró?" — que son las que convierten un veredicto en algo sobre lo que se
 * puede hacer algo.
 *
 * Cuatro decisiones de presentación:
 *
 *  - LA BARRA PRIMERO, LOS NÚMEROS DESPUÉS. La proporción se entiende de un
 *    vistazo; el monto exacto exige leer. Quien pasa rápido se lleva "el
 *    alquiler es la mitad de todo", que es la conclusión que importa.
 *  - LA COMPARACIÓN ES CONTRA EL MES ANTERIOR, no contra un promedio. "Gastaste
 *    más que tu media histórica" no es accionable; "en servicios gastaste
 *    200.000 más que en julio" sí. Al lado va la comparación con el mismo mes
 *    del año pasado, que es la que contesta "¿fue un mal mes o agosto siempre
 *    es así?".
 *  - LO QUE EOS NO ENTIENDE SE MUESTRA. Un desglose que reparte lo desconocido
 *    entre las categorías conocidas se ve más prolijo y miente. Acá "sin
 *    reconocer" tiene su propia fila, en gris y al final.
 *  - CADA MONEDA POR SEPARADO. Un reparto de rubros que mezcla dólares y
 *    guaraníes dice que el rubro más caro es aquel en el que se pagó con la
 *    moneda de número más grande, que no significa nada.
 */

type LineaDestino = {
  clave: string;
  etiqueta: string;
  total: number;
  cantidad: number;
  porcentaje: number;
  antes: number | null;
};

type LineaOrigen = {
  etiqueta: string;
  total: number;
  cantidad: number;
  porcentaje: number;
  antes: number | null;
};

type Mes = { mes: string; ingresos: number; gastos: number; neto: number };

type BloqueMoneda = {
  moneda: string;
  principal: boolean;
  desglose: {
    total: number;
    cantidad: number;
    sin_reconocer: number;
    destinos: LineaDestino[];
  };
  ingresos: { total: number; cantidad: number; origenes: LineaOrigen[] };
  historia: Mes[];
  mismo_mes_anio_pasado: { mes: string; ingresos: number; gastos: number } | null;
};

type Respuesta =
  | { configurado: false }
  | {
      configurado: true;
      moneda: string;
      mes: string;
      mes_previo: string | null;
      monedas: BloqueMoneda[];
    };

/** El umbral bajo el cual un cambio no vale la pena mencionar. */
const CAMBIO_RELEVANTE = 0.1;

export default function FinanzasDestino() {
  const [data, setData] = useState<Respuesta | null>(null);
  const [error, setError] = useState(false);
  const [monedaVista, setMonedaVista] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/finanzas/destinos", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("fallo"))))
      .then(setData)
      .catch(() => setError(true));
  }, []);

  const bloques = useMemo(
    () => (data && data.configurado ? (data.monedas ?? []) : []),
    [data],
  );

  // Sin política configurada no se dice nada: el panel de estado de arriba ya
  // está invitando a configurarla, y pedirlo dos veces en la misma pantalla
  // parece un reclamo.
  if (error || data === null || !data.configurado) return null;
  if (bloques.length === 0) return null;

  const bloque = bloques.find((b) => b.moneda === monedaVista) ?? bloques[0];
  const { desglose, ingresos, historia } = bloque;
  const mes = data.mes;
  const mesPrevio = data.mes_previo;
  const fmt = (valor: number) => formatearMonto(valor, bloque.moneda);

  // Con movimientos en más de una moneda hace falta elegir cuál se mira. Con
  // una sola, el selector sería un control que nunca hace nada.
  const selector =
    bloques.length > 1 ? (
      <div className="chip-row" style={{ marginBottom: 10 }}>
        {bloques.map((b) => (
          <button
            key={b.moneda}
            type="button"
            className={`chip ${b.moneda === bloque.moneda ? "active" : ""}`}
            onClick={() => setMonedaVista(b.moneda)}
          >
            {nombreDeMoneda(b.moneda)}
          </button>
        ))}
      </div>
    ) : null;

  if (desglose.cantidad === 0 && ingresos.cantidad === 0) {
    return (
      <div className="card">
        <div className="card-title">A dónde va tu plata</div>
        {selector}
        <p className="empty-note">
          Todavía no hay movimientos registrados en {nombreDelMes(mes, true)}. En cuanto EOS lea el
          primero, acá vas a ver el reparto sin tener que anotar nada.
        </p>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="card-title">A dónde va tu plata</div>
      <div className="card-sub">
        {nombreDelMes(mes, true)} · entró {fmt(ingresos.total)} · salió {fmt(desglose.total)}
      </div>

      {selector}

      <Interanual bloque={bloque} mes={mes} fmt={fmt} />

      {desglose.cantidad > 0 && (
        <>
          <div className="dest-seccion">En qué se fue</div>

          <div
            className="dest-barra"
            role="img"
            aria-label="Reparto de los gastos del mes por destino"
          >
            {desglose.destinos.map((d) => (
              <span
                key={d.clave}
                className={`dest-tramo dest-${d.clave}`}
                style={{ width: `${d.porcentaje}%` }}
                title={`${d.etiqueta}: ${d.porcentaje}%`}
              />
            ))}
          </div>

          <div className="dest-lista">
            {desglose.destinos.map((d) => (
              <div className="dest-fila" key={d.clave}>
                <span className={`dest-punto dest-${d.clave}`} />
                <span className="dest-nombre">
                  {d.etiqueta}
                  {d.clave === "otros" && (
                    <span
                      className="dest-ayuda"
                      title="EOS todavía no supo a qué rubro pertenecen estos gastos. Se muestran aparte en vez de repartirlos a ojo."
                    >
                      <HelpCircle size={12} />
                    </span>
                  )}
                </span>
                <span className="dest-monto">{fmt(d.total)}</span>
                <span className="dest-peso">{d.porcentaje}%</span>
                <Cambio antes={d.antes} total={d.total} mesPrevio={mesPrevio} fmt={fmt} />
              </div>
            ))}
          </div>
        </>
      )}

      {ingresos.cantidad > 0 && (
        <>
          <div className="dest-seccion">De dónde vino</div>

          <div className="dest-lista">
            {ingresos.origenes.map((o) => (
              <div className="dest-fila" key={o.etiqueta}>
                <span className="dest-punto dest-ingreso" />
                <span className="dest-nombre">{o.etiqueta}</span>
                <span className="dest-monto">{fmt(o.total)}</span>
                <span className="dest-peso">{o.porcentaje}%</span>
                <Cambio antes={o.antes} total={o.total} mesPrevio={mesPrevio} fmt={fmt} />
              </div>
            ))}
          </div>
        </>
      )}

      {historia.length >= 2 && <Historia historia={historia} fmt={fmt} />}
    </div>
  );
}

/**
 * La comparación con el mismo mes del año pasado.
 *
 * Es la única que distingue un mal mes de un mes normal: en un negocio con
 * estacionalidad, comparar agosto contra julio dice bastante menos que agosto
 * contra agosto. Cuando no hay un año de historia todavía, no se muestra nada
 * en vez de comparar contra lo que haya.
 */
function Interanual({
  bloque,
  mes,
  fmt,
}: {
  bloque: BloqueMoneda;
  mes: string;
  fmt: (valor: number) => string;
}) {
  const previo = bloque.mismo_mes_anio_pasado;
  if (!previo) return null;

  const diferencia = bloque.desglose.total - previo.gastos;
  const relevante = previo.gastos > 0 && Math.abs(diferencia) / previo.gastos >= CAMBIO_RELEVANTE;

  if (!relevante) {
    return (
      <p className="dest-interanual">
        Gastaste casi lo mismo que en {nombreDelMes(previo.mes, true)} del año pasado.
      </p>
    );
  }

  return (
    <p className="dest-interanual">
      {diferencia > 0 ? "Gastaste " : "Gastaste "}
      <strong className={diferencia > 0 ? "is-up" : "is-down"}>
        {fmt(Math.abs(diferencia))} {diferencia > 0 ? "más" : "menos"}
      </strong>{" "}
      que en {nombreDelMes(mes, true)} del año pasado.
    </p>
  );
}

function Cambio({
  antes,
  total,
  mesPrevio,
  fmt,
}: {
  antes: number | null;
  total: number;
  mesPrevio: string | null;
  fmt: (valor: number) => string;
}) {
  // Sin mes anterior con datos no hay comparación posible, y un "0%" ahí se
  // lee como "no cambió" cuando en realidad es "no sé".
  if (antes === null || mesPrevio === null) return <span className="dest-cambio" />;

  const diferencia = total - antes;
  const base = antes === 0 ? total : antes;
  const proporcion = base === 0 ? 0 : Math.abs(diferencia) / base;

  if (proporcion < CAMBIO_RELEVANTE) {
    return (
      <span className="dest-cambio is-igual" title={`Igual que en ${nombreDelMes(mesPrevio)}`}>
        <Minus size={11} />
      </span>
    );
  }

  const subio = diferencia > 0;

  return (
    <span
      className={`dest-cambio ${subio ? "is-up" : "is-down"}`}
      title={`${subio ? "Más" : "Menos"} que en ${nombreDelMes(mesPrevio)}: ${fmt(Math.abs(diferencia))}`}
    >
      {subio ? <ArrowUp size={11} /> : <ArrowDown size={11} />}
      {fmt(Math.abs(diferencia))}
    </span>
  );
}

/**
 * Doce meses de entradas, salidas y resultado.
 *
 * Antes eran seis barras de `div` con altura en porcentaje. Se pasó a SVG por
 * dos motivos concretos, no por prolijidad:
 *
 *  1. **Entran doce meses.** Con divs flexibles, doce columnas dobles quedan de
 *     dos píxeles en un teléfono; en un SVG con `viewBox` el navegador escala
 *     el dibujo entero y las proporciones se mantienen.
 *  2. **Se puede dibujar el neto.** Las barras dicen cuánto entró y cuánto
 *     salió; la línea dice si el mes cerró arriba o abajo de cero, que es la
 *     conclusión, y es la que hace visible una racha de meses en rojo antes de
 *     que se convierta en un problema.
 */
function Historia({ historia, fmt }: { historia: Mes[]; fmt: (valor: number) => string }) {
  const W = 640;
  const H = 190;
  const padT = 14;
  const padB = 26;
  const padL = 6;
  const padR = 6;

  const techo = Math.max(...historia.flatMap((h) => [h.ingresos, h.gastos]), 1);
  const piso = Math.min(...historia.map((h) => h.neto), 0);

  const ancho = (W - padL - padR) / historia.length;
  const anchoBarra = Math.min(14, ancho * 0.32);

  const alto = H - padT - padB;
  const y = (valor: number) => padT + alto - (valor / techo) * alto;

  // El cero del neto no está en el piso del gráfico: si algún mes cerró en
  // rojo, la línea tiene que poder bajar por debajo de él y verse.
  const rango = techo - piso;
  const yNeto = (valor: number) => padT + alto - ((valor - piso) / (rango || 1)) * alto;

  const centro = (i: number) => padL + i * ancho + ancho / 2;

  const linea = historia
    .map((h, i) => `${i === 0 ? "M" : "L"}${centro(i).toFixed(1)},${yNeto(h.neto).toFixed(1)}`)
    .join(" ");

  return (
    <div className="dest-historia">
      <div className="dest-historia-head">
        <span className="dest-historia-titulo">Cómo viene el año</span>
        <span className="dest-historia-leyenda">
          <span className="dest-sw is-in" /> entró
          <span className="dest-sw is-out" /> salió
          <span className="dest-sw is-neto" /> resultado
        </span>
      </div>

      <svg
        className="dest-svg"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label="Entradas, salidas y resultado de los últimos meses"
      >
        {piso < 0 && (
          <line
            className="dest-cero"
            x1={padL}
            y1={yNeto(0)}
            x2={W - padR}
            y2={yNeto(0)}
          />
        )}

        {historia.map((h, i) => (
          <g key={h.mes}>
            <rect
              className="dest-bar is-in"
              x={centro(i) - anchoBarra - 1}
              y={y(h.ingresos)}
              width={anchoBarra}
              height={Math.max(1, padT + alto - y(h.ingresos))}
            >
              <title>{`${nombreDelMes(h.mes)}: entró ${fmt(h.ingresos)}`}</title>
            </rect>
            <rect
              className="dest-bar is-out"
              x={centro(i) + 1}
              y={y(h.gastos)}
              width={anchoBarra}
              height={Math.max(1, padT + alto - y(h.gastos))}
            >
              <title>{`${nombreDelMes(h.mes)}: salió ${fmt(h.gastos)}`}</title>
            </rect>
          </g>
        ))}

        <path className="dest-linea-neto" d={linea} />

        {historia.map((h, i) => (
          <circle
            key={`p-${h.mes}`}
            className={`dest-punto-neto ${h.neto < 0 ? "is-rojo" : ""}`}
            cx={centro(i)}
            cy={yNeto(h.neto)}
            r={2.6}
          >
            <title>{`${nombreDelMes(h.mes)}: resultado ${fmt(h.neto)}`}</title>
          </circle>
        ))}

        {historia.map((h, i) => (
          // Con doce meses las etiquetas se pisan: se escribe una sí y una no,
          // y siempre la última, que es el mes en curso.
          (historia.length <= 7 || i % 2 === 1 || i === historia.length - 1) && (
            <text key={`l-${h.mes}`} className="dest-eje" x={centro(i)} y={H - 8} textAnchor="middle">
              {nombreDelMes(h.mes)}
            </text>
          )
        ))}
      </svg>
    </div>
  );
}
