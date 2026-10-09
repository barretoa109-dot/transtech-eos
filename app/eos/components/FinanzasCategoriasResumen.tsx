"use client";

import { useEffect, useState } from "react";
import { TrendingDown, TrendingUp } from "lucide-react";
import { formatearMonto } from "@/lib/finanzas/formato";
import { DESTINOS } from "@/lib/finanzas/destinos";

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
      desglose: { destinos: LineaDestino[] };
    };

const CLAVES_SISTEMA = new Set(DESTINOS.map((d) => d.clave));

/**
 * El mapa completo de tus categorías del mes: cuánto, cuántos movimientos y
 * si subió o bajó contra el mes anterior.
 *
 * "En qué se fue" ya muestra esto mismo arriba de todo, pero mezclado con la
 * comparación interanual, "de dónde vino" y el gráfico del año — es la foto
 * del mes. Acá es el mapa completo, el ancla de "Categorías": mismos datos
 * (mismo endpoint, `/api/finanzas/destinos`), sin repetir el cálculo.
 *
 * "Por clasificar" no aparece como una tarjeta más acá: ya tiene su propio
 * bloque arriba, con los movimientos uno por uno y sus chips de categoría
 * rápida (`PorClasificar`, reusado de "Movimientos").
 */
export default function FinanzasCategoriasResumen() {
  const [data, setData] = useState<Respuesta | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let vigente = true;
    fetch("/api/finanzas/destinos", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<Respuesta>) : Promise.reject(new Error())))
      .then((datos) => {
        if (vigente) setData(datos);
      })
      .catch(() => {
        if (vigente) setError(true);
      });
    return () => {
      vigente = false;
    };
  }, []);

  if (error || data === null) return null;
  if (!data.configurado) return null;

  const fmt = (v: number) => formatearMonto(v, data.moneda);
  const destinos = data.desglose.destinos.filter((d) => d.clave !== "otros");
  if (destinos.length === 0) return null;

  return (
    <div className="card">
      <div className="card-title">Tus categorías</div>
      <div className="card-sub">Este mes, comparado con el anterior</div>

      <div className="cat-resumen-grid">
        {destinos.map((d) => {
          const propia = !CLAVES_SISTEMA.has(d.clave);
          const cambio = d.antes !== null && d.antes > 0 ? ((d.total - d.antes) / d.antes) * 100 : null;

          return (
            <div className="cat-resumen-card" key={d.clave}>
              <div className="cat-resumen-top">
                <span className={`dest-punto dest-${d.clave}`} />
                <span className="cat-resumen-nombre">{d.etiqueta}</span>
                {propia && <span className="cat-resumen-tag">propia</span>}
              </div>
              <div className="cat-resumen-monto-fila">
                <strong>{fmt(d.total)}</strong>
                {cambio !== null && (
                  <span className={`cat-resumen-trend ${cambio > 0 ? "is-up" : cambio < 0 ? "is-down" : ""}`}>
                    {cambio > 0 ? <TrendingUp size={12} /> : cambio < 0 ? <TrendingDown size={12} /> : null}
                    {cambio === 0 ? "=" : `${cambio > 0 ? "+" : ""}${Math.round(cambio)}%`}
                  </span>
                )}
              </div>
              <div className="cat-resumen-meta">
                {d.cantidad} {d.cantidad === 1 ? "movimiento" : "movimientos"} · {d.porcentaje}% del mes
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
