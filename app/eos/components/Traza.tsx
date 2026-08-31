"use client";

import { useState } from "react";
import { ArrowLeft, X } from "lucide-react";
import { formatearMonto } from "@/lib/finanzas/formato";
import type { ClaveCifra, Trazado } from "@/lib/finanzas/trazabilidad";

/**
 * "¿De dónde sale este número?"
 *
 * ============================================================
 * POR QUÉ UN NÚMERO QUE NO SE PUEDE ABRIR NO SIRVE
 * ============================================================
 *
 * Un panel financiero le pide al usuario que tome decisiones —gastar o no,
 * pagar hoy o el martes— sobre cifras que él no calculó. Si no puede
 * comprobarlas, tiene dos opciones: creer sin entender, o desconfiar de todo.
 * Las dos son malas, y la segunda es la que efectivamente pasa: la gente mira
 * el número, no le cierra con lo que tiene en la cabeza, y deja de abrir la
 * pantalla.
 *
 * Poder tocar cualquier cifra y ver exactamente qué la formó es lo que
 * convierte un panel que se mira en uno en el que se confía.
 *
 * ============================================================
 * DOS FORMAS DE ABRIRSE, PORQUE HAY DOS CLASES DE NÚMERO
 * ============================================================
 *
 * Los que son una SUMA se abren en su lista de movimientos, con la ventana de
 * fechas arriba para que se entienda qué entró y qué no.
 *
 * Los que son una CUENTA —el disponible real no es la suma de nada, es
 * `saldo − comprometido − reserva − ahorro`— se abren en la operación. Poner
 * una lista debajo de ellos sería inventar. Cada término de la cuenta que a su
 * vez se puede abrir es otro botón, así que tirando del hilo se llega igual
 * hasta los movimientos.
 *
 * El camino queda guardado para poder volver un paso, no cerrar y empezar de
 * nuevo: bajar tres niveles y perder el camino de vuelta es la forma más rápida
 * de que alguien no vuelva a bajar.
 */

/** El número, convertido en algo que se puede tocar cuando tiene traza. */
export function Cifra({
  valor,
  moneda,
  cifra,
  trazas,
  onAbrir,
  className,
}: {
  valor: number;
  moneda: string;
  cifra: ClaveCifra;
  trazas: Trazado[];
  onAbrir: (cifra: ClaveCifra) => void;
  className?: string;
}) {
  const tiene = trazas.some((t) => t.cifra === cifra);
  const texto = formatearMonto(valor, moneda);

  // Sin traza no se muestra un botón que no hace nada: prometer que se puede
  // abrir y que no pase nada es peor que no ofrecerlo.
  if (!tiene) return <span className={className}>{texto}</span>;

  return (
    <button
      type="button"
      className={`traza-cifra${className ? ` ${className}` : ""}`}
      onClick={() => onAbrir(cifra)}
      aria-label={`Ver de dónde sale ${texto}`}
    >
      {texto}
    </button>
  );
}

export default function Traza({
  trazas,
  inicial,
  moneda,
  onCerrar,
}: {
  trazas: Trazado[];
  inicial: ClaveCifra;
  moneda: string;
  onCerrar: () => void;
}) {
  const [camino, setCamino] = useState<ClaveCifra[]>([inicial]);
  const actual = trazas.find((t) => t.cifra === camino[camino.length - 1]);

  if (!actual) return null;

  const fmt = (v: number) => formatearMonto(v, moneda);

  return (
    <div className="traza" role="region" aria-label={`De dónde sale ${actual.etiqueta}`}>
      <div className="traza-cabecera">
        {camino.length > 1 && (
          <button
            type="button"
            className="traza-volver"
            onClick={() => setCamino((c) => c.slice(0, -1))}
            aria-label="Volver un paso"
          >
            <ArrowLeft size={14} />
          </button>
        )}

        <div className="traza-titulo">
          <strong>{actual.etiqueta}</strong>
          <span>{fmt(actual.total)}</span>
        </div>

        <button type="button" className="traza-cerrar" onClick={onCerrar} aria-label="Cerrar">
          <X size={14} />
        </button>
      </div>

      {/*
        Si el detalle no suma el total, se dice. Callarlo y mostrar la lista
        igual sería dejar que el usuario haga la cuenta, no le dé, y no sepa
        que el problema es nuestro.
      */}
      {!actual.cuadra && (
        <p className="traza-aviso" role="alert">
          Este desglose no cierra con el total. Es un problema nuestro y ya quedó
          registrado; el número de arriba sigue siendo el correcto.
        </p>
      )}

      {actual.tipo === "suma" ? (
        actual.partidas.length === 0 ? (
          <p className="traza-vacio">No hay movimientos que lo compongan todavía.</p>
        ) : (
          <>
            <p className="traza-ventana">
              Desde el {fecha(actual.desde)} hasta el {fecha(actual.hasta)} ·{" "}
              {actual.partidas.length}{" "}
              {actual.partidas.length === 1 ? "movimiento" : "movimientos"}
            </p>

            <ul className="traza-lista">
              {actual.partidas.map((p, i) => (
                <li key={`${p.fecha}-${p.descripcion}-${i}`}>
                  <span className="traza-fecha">{fecha(p.fecha)}</span>
                  <span className="traza-desc">{p.descripcion}</span>
                  <span className="traza-monto">{fmt(p.monto)}</span>
                </li>
              ))}
            </ul>
          </>
        )
      ) : (
        <ul className="traza-cuenta">
          {actual.terminos.map((t, i) => (
            <li key={`${t.etiqueta}-${i}`}>
              <span className="traza-signo" aria-hidden="true">
                {t.signo}
              </span>
              {t.cifra ? (
                <button
                  type="button"
                  className="traza-termino"
                  onClick={() => setCamino((c) => [...c, t.cifra as ClaveCifra])}
                >
                  {t.etiqueta}
                </button>
              ) : (
                <span className="traza-termino-fijo">{t.etiqueta}</span>
              )}
              <span className="traza-monto">{fmt(t.monto)}</span>
            </li>
          ))}

          <li className="traza-resultado">
            <span className="traza-signo" aria-hidden="true">
              =
            </span>
            <span className="traza-termino-fijo">{actual.etiqueta}</span>
            <span className="traza-monto">{fmt(actual.total)}</span>
          </li>
        </ul>
      )}
    </div>
  );
}

const MESES = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];

function fecha(iso: string) {
  const [anio, mes, dia] = iso.slice(0, 10).split("-").map(Number);
  if (!anio || !mes || !dia || mes < 1 || mes > 12) return iso;
  return `${dia} de ${MESES[mes - 1]}`;
}
