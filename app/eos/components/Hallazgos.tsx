"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Info, Lightbulb, TrendingUp } from "lucide-react";
import type { Anomalia, Severidad } from "@/lib/kpi/anomalias";

/**
 * "¿Qué debería preocuparme hoy?"
 *
 * Va arriba de las tarjetas de indicadores porque responde antes: los números
 * son el material, esto es la lectura. Un panel que muestra veinticuatro
 * números y ninguna conclusión deja el trabajo de analista al empresario, que
 * es exactamente lo que EOS existe para no hacerle hacer.
 *
 * Cuando no hay nada que decir, no dice nada. Un "todo en orden" permanente
 * entrena a no leer el bloque, y el día que aparezca algo tampoco se va a leer.
 */

type Causa = { moneda: string; cambio: number; producto: string | null; cliente: string | null };

type Respuesta = {
  hallazgos: Anomalia[];
  causas: Causa[];
  periodo: { desde: string; hasta: string };
  con_historia: boolean;
};

const ICONO: Record<Severidad, typeof AlertTriangle> = {
  critico: AlertTriangle,
  atencion: AlertTriangle,
  oportunidad: TrendingUp,
  info: Info,
};

export default function Hallazgos() {
  const [datos, setDatos] = useState<Respuesta | null>(null);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    let vivo = true;

    (async () => {
      try {
        const r = await fetch("/api/kpi/hallazgos", { cache: "no-store" });
        if (!vivo) return;
        if (r.ok) setDatos(await r.json());
      } catch {
        // Silencio a propósito: este bloque es un extra sobre el panel. Si no
        // se puede calcular, no vale la pena mostrar un error donde debería
        // ir una conclusión — las tarjetas de abajo siguen estando.
      } finally {
        if (vivo) setCargando(false);
      }
    })();

    return () => {
      vivo = false;
    };
  }, []);

  if (cargando || !datos) return null;

  const hayCausa = datos.causas.some((c) => c.producto || c.cliente);
  if (datos.hallazgos.length === 0 && !hayCausa) return null;

  return (
    <section className="card">
      <div className="card-title">
        EOS encontró {datos.hallazgos.length}{" "}
        {datos.hallazgos.length === 1 ? "situación" : "situaciones"} para mirar
      </div>

      <ul className="hallazgo-lista">
        {datos.hallazgos.map((h) => {
          const Icono = ICONO[h.severidad];
          return (
            <li key={h.clave} className={`hallazgo is-${h.severidad}`}>
              <Icono className="hallazgo-icono" size={16} />
              <div>
                <strong>{h.titulo}</strong>
                <span className="hallazgo-evidencia">{h.evidencia}</span>
              </div>
            </li>
          );
        })}
      </ul>

      {hayCausa && (
        <div className="hallazgo-causas">
          <div className="hallazgo-causas-titulo">De dónde viene el movimiento de las ventas</div>
          {datos.causas.map((c) => (
            <div key={c.moneda}>
              {c.producto && <p>{c.producto}</p>}
              {c.cliente && <p>{c.cliente}</p>}
            </div>
          ))}
          {/* Se dice explícitamente que es aritmética y no una causa: quien lee
              esto tiene que saber que EOS no averiguó POR QUÉ bajaron. */}
          <p className="hallazgo-nota">
            <Lightbulb size={12} /> Es el reparto del cambio, no su causa. EOS no sabe por qué se
            movieron.
          </p>
        </div>
      )}

      {!datos.con_historia && (
        <p className="hallazgo-nota">
          Todavía sin historia: por ahora EOS solo puede mirar los valores de hoy. Con unos días de
          registro va a poder ver rachas y desvíos.
        </p>
      )}
    </section>
  );
}
