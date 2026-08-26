"use client";

import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, HelpCircle, Minus } from "lucide-react";
import { formatearMonto, nombreDelMes } from "@/lib/finanzas/formato";

/**
 * En qué se te fue la plata.
 *
 * El panel de estado contesta "¿estoy bien?". Esta tarjeta contesta la
 * pregunta que viene enseguida — "¿y en qué se me fue?" — que es la que
 * convierte un veredicto en algo sobre lo que se puede hacer algo.
 *
 * Tres decisiones de presentación:
 *
 *  - LA BARRA PRIMERO, LOS NÚMEROS DESPUÉS. La proporción se entiende de un
 *    vistazo; el monto exacto exige leer. Quien pasa rápido se lleva "el
 *    alquiler es la mitad de todo", que es la conclusión que importa.
 *  - LA COMPARACIÓN ES CONTRA EL MES ANTERIOR, no contra un promedio. "Gastaste
 *    más que tu media histórica" no es accionable; "en servicios gastaste
 *    200.000 más que en julio" sí.
 *  - LO QUE EOS NO ENTIENDE SE MUESTRA. Un desglose que reparte lo desconocido
 *    entre las categorías conocidas se ve más prolijo y miente. Acá "sin
 *    reconocer" tiene su propia fila, en gris y al final.
 */

type LineaDestino = {
  clave: string;
  etiqueta: string;
  total: number;
  cantidad: number;
  porcentaje: number;
  antes: number | null;
};

type Respuesta =
  | { configurado: false }
  | {
      configurado: true;
      moneda: string;
      mes: string;
      mes_previo: string | null;
      desglose: {
        total: number;
        cantidad: number;
        sin_reconocer: number;
        destinos: LineaDestino[];
      };
      historia: { mes: string; ingresos: number; gastos: number }[];
    };

/** El umbral bajo el cual un cambio no vale la pena mencionar. */
const CAMBIO_RELEVANTE = 0.1;

export default function FinanzasDestino() {
  const [data, setData] = useState<Respuesta | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch("/api/finanzas/destinos", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("fallo"))))
      .then(setData)
      .catch(() => setError(true));
  }, []);

  // Sin política configurada no se dice nada: el panel de estado de arriba ya
  // está invitando a configurarla, y pedirlo dos veces en la misma pantalla
  // parece un reclamo.
  if (error || data === null || !data.configurado) return null;

  const { desglose, historia, moneda, mes, mes_previo: mesPrevio } = data;
  const fmt = (valor: number) => formatearMonto(valor, moneda);

  if (desglose.cantidad === 0) {
    return (
      <div className="card">
        <div className="card-title">En qué se fue la plata</div>
        <p className="empty-note">
          Todavía no hay gastos registrados en {nombreDelMes(mes, true)}. En cuanto EOS lea el
          primero, acá vas a ver el reparto sin tener que anotar nada.
        </p>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="card-title">En qué se fue la plata</div>
      <div className="card-sub">
        {nombreDelMes(mes, true)} · {fmt(desglose.total)} en {desglose.cantidad}{" "}
        {desglose.cantidad === 1 ? "movimiento" : "movimientos"}
      </div>

      <div className="dest-barra" role="img" aria-label="Reparto de los gastos del mes por destino">
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
            <Cambio linea={d} mesPrevio={mesPrevio} fmt={fmt} />
          </div>
        ))}
      </div>

      {historia.length >= 2 && <Historia historia={historia} fmt={fmt} />}
    </div>
  );
}

/**
 * Cuánto cambió este destino contra el mes pasado.
 *
 * No se muestra porcentaje de variación a propósito: pasar de 10.000 a 30.000
 * es "+200%" y no significa nada. El monto de la diferencia sí.
 */
function Cambio({
  linea,
  mesPrevio,
  fmt,
}: {
  linea: LineaDestino;
  mesPrevio: string | null;
  fmt: (valor: number) => string;
}) {
  if (linea.antes === null || !mesPrevio) return <span className="dest-cambio" />;

  const diferencia = linea.total - linea.antes;
  const nombre = nombreDelMes(mesPrevio);

  // Un movimiento de menos del 10% es ruido del mes, no una tendencia.
  if (linea.antes > 0 && Math.abs(diferencia) / linea.antes < CAMBIO_RELEVANTE) {
    return (
      <span className="dest-cambio" title={`Igual que en ${nombre}`}>
        <Minus size={11} />
        igual
      </span>
    );
  }

  if (linea.antes === 0) {
    return (
      <span className="dest-cambio is-nuevo" title={`No hubo gastos de este tipo en ${nombre}`}>
        nuevo
      </span>
    );
  }

  const subio = diferencia > 0;

  return (
    <span
      className={`dest-cambio ${subio ? "is-sube" : "is-baja"}`}
      title={`${fmt(Math.abs(diferencia))} ${subio ? "más" : "menos"} que en ${nombre}`}
    >
      {subio ? <ArrowUp size={11} /> : <ArrowDown size={11} />}
      {fmt(Math.abs(diferencia))}
    </span>
  );
}

/**
 * Seis meses de entradas y salidas, una al lado de la otra.
 *
 * Las dos barras comparten escala. Es lo que hace visible de un vistazo el
 * único patrón que de verdad importa acá: si el mes cierra en rojo o en verde,
 * y si eso viene pasando o es de este mes nomás.
 */
function Historia({
  historia,
  fmt,
}: {
  historia: { mes: string; ingresos: number; gastos: number }[];
  fmt: (valor: number) => string;
}) {
  const techo = Math.max(...historia.flatMap((h) => [h.ingresos, h.gastos]), 1);

  return (
    <div className="dest-historia">
      <div className="dest-historia-head">
        <span className="dest-historia-titulo">Entradas y salidas</span>
        <span className="dest-historia-leyenda">
          <span className="dest-sw is-in" /> entró
          <span className="dest-sw is-out" /> salió
        </span>
      </div>

      <div className="dest-meses">
        {historia.map((h) => (
          <div className="dest-mes" key={h.mes}>
            <div className="dest-mes-barras">
              <span
                className="dest-mes-barra is-in"
                style={{ height: `${(h.ingresos / techo) * 100}%` }}
                title={`Entró ${fmt(h.ingresos)}`}
              />
              <span
                className="dest-mes-barra is-out"
                style={{ height: `${(h.gastos / techo) * 100}%` }}
                title={`Salió ${fmt(h.gastos)}`}
              />
            </div>
            <div className="dest-mes-label">{nombreDelMes(h.mes)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
