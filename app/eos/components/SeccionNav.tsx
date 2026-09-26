"use client";

import { Settings } from "lucide-react";

/**
 * La navegación de Negocio y de Personal: pestañas con verbos y, adentro de
 * cada una, subpestañas.
 *
 * Las dos secciones tienen el mismo esqueleto a propósito —resumen arriba,
 * pestañas, y la configuración aparte en el engranaje— para que quien aprende
 * a moverse en una ya sepa moverse en la otra.
 *
 * Antes eran dos navegaciones distintas: Negocio con cuatro bloques grises de
 * grupos que ocupaban media pantalla antes de la primera venta, y Personal con
 * siete chips del mismo peso. Las dos cosas pedían leer todo para encontrar
 * una.
 *
 * La pestaña marcada `ajuste` va sola a la derecha con el engranaje: lo que se
 * configura una vez no compite con lo que se usa todos los días.
 */
export type SubSeccion<K extends string> = {
  clave: K;
  etiqueta: string;
  /** Una línea que dice qué hay adentro. Se muestra al lado de las subpestañas. */
  detalle: string;
};

export type Seccion<S extends string, K extends string> = {
  clave: S;
  etiqueta: string;
  subs: SubSeccion<K>[];
  /** Cuántas cosas piden atención adentro. Sin número, no se muestra nada. */
  aviso?: number;
  ajuste?: boolean;
};

type Props<S extends string, K extends string> = {
  secciones: Seccion<S, K>[];
  seccion: S;
  sub: K;
  onSeccion: (clave: S) => void;
  onSub: (clave: K) => void;
  ariaLabel: string;
};

export default function SeccionNav<S extends string, K extends string>({
  secciones,
  seccion,
  sub,
  onSeccion,
  onSub,
  ariaLabel,
}: Props<S, K>) {
  const actual = secciones.find((s) => s.clave === seccion) ?? secciones[0];
  const principales = secciones.filter((s) => !s.ajuste);
  const ajuste = secciones.find((s) => s.ajuste);
  const subActual = actual.subs.find((s) => s.clave === sub) ?? actual.subs[0];

  const pestania = (s: Seccion<S, K>) => (
    <button
      key={s.clave}
      type="button"
      role="tab"
      aria-selected={s.clave === actual.clave}
      className={`sec-tab${s.ajuste ? " is-ajuste" : ""}${s.clave === actual.clave ? " active" : ""}`}
      onClick={() => onSeccion(s.clave)}
      title={s.ajuste ? s.etiqueta : undefined}
    >
      {s.ajuste && <Settings size={15} aria-hidden="true" />}
      <span className="sec-tab-texto">{s.etiqueta}</span>
      {!!s.aviso && s.aviso > 0 && (
        <span className="sec-tab-aviso" aria-label={`${s.aviso} para atender`}>
          {s.aviso}
        </span>
      )}
    </button>
  );

  return (
    <>
      <div className="sec-nav" role="tablist" aria-label={ariaLabel}>
        <div className="sec-tabs">{principales.map(pestania)}</div>
        {ajuste && pestania(ajuste)}
      </div>

      {actual.subs.length > 1 && (
        <div className="sec-subs" role="tablist" aria-label={`Partes de ${actual.etiqueta}`}>
          {actual.subs.map((s) => (
            <button
              key={s.clave}
              type="button"
              role="tab"
              aria-selected={s.clave === subActual.clave}
              className={`chip${s.clave === subActual.clave ? " active" : ""}`}
              onClick={() => onSub(s.clave)}
            >
              {s.etiqueta}
            </button>
          ))}
          <span className="sec-sub-detalle">{subActual.detalle}</span>
        </div>
      )}
    </>
  );
}

/**
 * Qué sección contiene una subpestaña. Las pantallas guardan la subpestaña
 * (es lo que decide qué se muestra) y de ahí sale la pestaña marcada.
 */
export function seccionDe<S extends string, K extends string>(secciones: Seccion<S, K>[], sub: K): S {
  return (secciones.find((s) => s.subs.some((x) => x.clave === sub)) ?? secciones[0]).clave;
}
