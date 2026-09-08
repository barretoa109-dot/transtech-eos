"use client";

import { useCallback, useEffect, useState } from "react";
import { PiggyBank } from "lucide-react";

import { formatearMonto } from "@/lib/finanzas/formato";

type Presupuesto = {
  ingreso_esperado: number;
  obligaciones: number;
  detalle_obligaciones: { descripcion: string; monto: number }[];
  ahorro: number;
  para_el_dia_a_dia: number;
  gasto_habitual: number | null;
  margen: number | null;
  consumido: number;
  restante: number;
  dias_transcurridos: number;
  dias_restantes: number;
  ritmo_diario: number;
  proyeccion_cierre: number;
  alcanza: boolean;
  confianza: { nivel: number; motivos: string[] };
};

type Respuesta = { configurado?: boolean; moneda?: string; presupuesto?: Presupuesto };

/**
 * El presupuesto que armó EOS, no el que llenó el usuario.
 *
 * ============================================================
 * CINCO LÍNEAS Y UNA CONCLUSIÓN
 * ============================================================
 *
 * Lo que entra, lo comprometido, lo que se aparta para ahorrar, lo que queda
 * para vivir, y si eso alcanza contra lo que esa persona suele gastar.
 *
 * Nada de veinticinco categorías con un control deslizante cada una. La
 * doctrina lo prohíbe y además nadie las mantiene después de la primera semana.
 *
 * ============================================================
 * LA CONCLUSIÓN VA ARRIBA
 * ============================================================
 *
 * "Vas a cerrar el mes 400.000 por encima de lo que hay" es lo que la persona
 * vino a saber. Las cinco líneas son el respaldo, y van debajo para quien
 * quiera revisarlas.
 *
 * ============================================================
 * Y LO QUE NO SE SABE SE DICE
 * ============================================================
 *
 * Un presupuesto con ingreso desconocido y sin historial es una cuenta sobre
 * ceros. Se muestra igual —esconderlo no lo mejora— pero con lo que le falta
 * escrito al lado, porque un número sin contexto se lee como un veredicto.
 */
export default function FinanzasPresupuesto({ moneda = "PYG" }: { moneda?: string }) {
  const [datos, setDatos] = useState<Respuesta | null>(null);

  const cargar = useCallback(() => {
    return fetch("/api/finanzas/presupuesto", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("fallo"))))
      .then(setDatos)
      .catch(() => setDatos(null));
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  if (!datos || datos.configurado === false || !datos.presupuesto) return null;

  const p = datos.presupuesto;

  // Sin ingreso no hay presupuesto que mostrar, solo una cuenta sobre ceros.
  if (p.ingreso_esperado <= 0) return null;

  const fmt = (n: number) => formatearMonto(n, moneda);
  const consumidoPct =
    p.ingreso_esperado - p.ahorro > 0
      ? Math.min(100, Math.round((p.consumido / (p.ingreso_esperado - p.ahorro)) * 100))
      : 0;

  return (
    <div className="card fin-card">
      <div className="fin-head">
        <span className={`fin-badge ${p.alcanza ? "fin-badge-seguro" : "fin-badge-atencion"}`}>
          <PiggyBank size={14} />
          TU MES
        </span>
      </div>

      {/* La conclusión primero. */}
      <p className="prose" style={{ marginTop: 8, marginBottom: 14, fontSize: 14 }}>
        Llevás gastados <strong>{fmt(p.consumido)}</strong> en {p.dias_transcurridos}{" "}
        {p.dias_transcurridos === 1 ? "día" : "días"}
        {p.dias_restantes > 0 ? (
          <>
            {" "}
            y quedan {p.dias_restantes}. A este ritmo cerrás el mes en{" "}
            <strong>{fmt(p.proyeccion_cierre)}</strong>
            {p.alcanza ? (
              <>, dentro de lo que hay.</>
            ) : (
              <>
                , que es {fmt(p.proyeccion_cierre - (p.ingreso_esperado - p.ahorro))} más de lo que
                tenés para gastar.
              </>
            )}
          </>
        ) : (
          <>. El mes ya cerró.</>
        )}
      </p>

      {/* Las cinco líneas: el respaldo de la conclusión de arriba. */}
      <div className="fin-rows">
        <div className="fin-row">
          <span className="fin-row-label">Esperás cobrar</span>
          <span className="fin-row-value is-ok">{fmt(p.ingreso_esperado)}</span>
        </div>
        <div className="fin-row">
          <span className="fin-row-label">
            Comprometido
            {p.detalle_obligaciones.length > 0 && (
              <span className="prose" style={{ display: "block", fontSize: 12, opacity: 0.65 }}>
                {p.detalle_obligaciones
                  .slice(0, 3)
                  .map((o) => o.descripcion)
                  .join(", ")}
                {p.detalle_obligaciones.length > 3 ? ` y ${p.detalle_obligaciones.length - 3} más` : ""}
              </span>
            )}
          </span>
          <span className="fin-row-value">− {fmt(p.obligaciones)}</span>
        </div>
        <div className="fin-row">
          <span className="fin-row-label">Para tu ahorro</span>
          <span className="fin-row-value">− {fmt(p.ahorro)}</span>
        </div>
        <div className="fin-row">
          <span className="fin-row-label">
            <strong>Te queda para el día a día</strong>
          </span>
          <span className="fin-row-value">
            <strong>{fmt(p.para_el_dia_a_dia)}</strong>
          </span>
        </div>
      </div>

      {/* El margen, que sale de la persona y no de un porcentaje inventado. */}
      {p.margen !== null && p.gasto_habitual !== null && (
        <p className="prose" style={{ marginTop: 12, fontSize: 13 }}>
          {p.margen >= 0 ? (
            <>
              Normalmente gastás <strong>{fmt(p.gasto_habitual)}</strong> por mes, así que te
              sobrarían <strong>{fmt(p.margen)}</strong>.
            </>
          ) : (
            <>
              Normalmente gastás <strong>{fmt(p.gasto_habitual)}</strong> por mes, que es{" "}
              <strong>{fmt(Math.abs(p.margen))}</strong> más de lo que te queda. Eso es lo que hay
              que resolver este mes.
            </>
          )}
        </p>
      )}

      {/* Cuánto se lleva consumido, en una barra y no en un gráfico. */}
      <div style={{ marginTop: 12 }}>
        <div
          style={{
            height: 6,
            borderRadius: 999,
            background: "var(--line-soft)",
            overflow: "hidden",
          }}
          role="img"
          aria-label={`Llevás consumido el ${consumidoPct}% de lo que tenés para gastar este mes`}
        >
          <div
            style={{
              width: `${consumidoPct}%`,
              height: "100%",
              background: p.alcanza ? "var(--green)" : "var(--amber)",
            }}
          />
        </div>
        <p className="prose" style={{ fontSize: 12, opacity: 0.7, marginTop: 6 }}>
          {consumidoPct}% consumido · quedan {fmt(p.restante)}
        </p>
      </div>

      {/* Lo que EOS todavía no sabe, dicho. */}
      {p.confianza.motivos.length > 0 && (
        <p className="prose" style={{ marginTop: 10, fontSize: 12, opacity: 0.7 }}>
          Con lo que tengo hasta ahora: {p.confianza.motivos.join("; ")}.
        </p>
      )}
    </div>
  );
}
