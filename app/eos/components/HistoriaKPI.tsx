"use client";

import { useEffect, useState } from "react";
import LineaSVG from "./graficos/LineaSVG";
import { formatearValor } from "@/lib/kpi/formato";
import type { PuntoHistoria } from "@/lib/kpi/historia";
import type { Direccion, Tendencia, Unidad } from "@/lib/kpi/tipos";

/**
 * Cómo venía un indicador.
 *
 * Se carga cuando alguien abre UNA tarjeta, no con el panel: son 24
 * indicadores y casi nadie mira la historia de todos. Ver
 * `app/api/kpi/historia/route.ts`.
 *
 * Cuando la serie no alcanza para afirmar nada, `frase` viene null y acá no se
 * escribe un texto de relleno: se muestra el gráfico y se calla. Inventar
 * "se mantiene estable" con dos puntos es exactamente lo que hace que después
 * nadie le crea a las frases que sí valen.
 */

type Respuesta = {
  serie: { indicador: string; moneda: string; unidad: Unidad; puntos: PuntoHistoria[] };
  nombre: string;
  unidad: Unidad;
  direccion: Direccion;
  racha: { direccion: Tendencia; dias: number };
  frase: string | null;
  dias_sin_calcular: number;
};

export default function HistoriaKPI({ id, moneda }: { id: string; moneda: string }) {
  const [datos, setDatos] = useState<Respuesta | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");

  /*
   * El efecto NO resetea `cargando` ni `error` al cambiar de indicador.
   *
   * Hacerlo sería un setState síncrono adentro del efecto, que dispara
   * renders en cascada y que el lint del proyecto marca como error. En vez de
   * eso, quien monta este componente le pasa una `key` con el indicador y la
   * moneda: al cambiar cualquiera de los dos React lo remonta, y el estado
   * inicial ya es "cargando, sin error". Menos código y sin la cascada.
   */
  useEffect(() => {
    let vivo = true;

    (async () => {
      try {
        const r = await fetch(
          `/api/kpi/historia?id=${encodeURIComponent(id)}&moneda=${encodeURIComponent(moneda)}&dias=60`,
          { cache: "no-store" },
        );
        if (!vivo) return;
        if (!r.ok) {
          setError("No pudimos leer la historia de este indicador.");
          return;
        }
        setDatos(await r.json());
      } catch {
        if (vivo) setError("No pudimos leer la historia de este indicador.");
      } finally {
        if (vivo) setCargando(false);
      }
    })();

    return () => {
      vivo = false;
    };
  }, [id, moneda]);

  if (cargando) return <p className="neg-loading">Buscando la historia…</p>;
  if (error) return <p className="neg-load-error">{error}</p>;
  if (!datos) return null;

  const conValor = datos.serie.puntos.filter((p) => p.valor !== null);

  if (conValor.length === 0) {
    return (
      <p className="empty-note">
        Todavía no hay historia de este indicador. EOS saca una foto por día; en unos días vas a poder
        ver cómo viene.
      </p>
    );
  }

  return (
    <div className="kpi-historia">
      <LineaSVG
        puntos={datos.serie.puntos}
        etiqueta={diaMes}
        titulo={`Historia de ${datos.nombre}`}
        // Los porcentajes y los días se leen mejor con su rango propio; la
        // plata desde cero, porque "vendí 900.000 o 950.000" con el eje
        // recortado parece el doble de diferencia de la que es.
        desdeCero={datos.unidad === "moneda"}
      />

      {datos.frase && <p className="kpi-historia-frase">{datos.frase}</p>}

      {datos.dias_sin_calcular > 0 && (
        <p className="kpi-historia-hueco">
          Hace {datos.dias_sin_calcular} {datos.dias_sin_calcular === 1 ? "día" : "días"} que no se puede
          calcular.
        </p>
      )}

      <p className="kpi-historia-pie">
        {conValor.length} {conValor.length === 1 ? "día registrado" : "días registrados"} · último valor{" "}
        {formatearValor(conValor[conValor.length - 1].valor as number, datos.unidad, datos.serie.moneda)}
      </p>
    </div>
  );
}

/** "15 ago", sin `new Date` sobre un ISO pelado (correría el día por zona horaria). */
function diaMes(iso: string): string {
  const [, mes, dia] = iso.split("-");
  const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
  return `${Number(dia)} ${MESES[Number(mes) - 1]}`;
}
