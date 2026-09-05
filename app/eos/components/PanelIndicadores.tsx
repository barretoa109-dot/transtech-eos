"use client";

import { useEffect, useMemo, useState } from "react";
import TarjetaKPI from "./TarjetaKPI";
import HistoriaKPI from "./HistoriaKPI";
import { porPrioridad } from "@/lib/kpi/formato";
import type { Familia, ResultadoKPI } from "@/lib/kpi/tipos";

/**
 * Los números con los que se dirige el negocio, en el panel.
 *
 * ============================================================
 * PRIMERO LO QUE RECLAMA ATENCIÓN
 * ============================================================
 *
 * Las tarjetas NO van en orden alfabético ni en el orden del catálogo: van
 * ordenadas por estado (`porPrioridad`). Un panel que ordena por nombre
 * esconde la única alerta entre veinte números tranquilos, y entonces el
 * usuario deja de mirarlo. Dentro de cada estado se conserva el orden del
 * catálogo, que ya está pensado.
 *
 * ============================================================
 * UNA MONEDA POR VEZ
 * ============================================================
 *
 * La regla del proyecto es que un total pertenece a una moneda y nunca se
 * convierte (no hay tipo de cambio en el modelo, y uno inventado es peor que
 * ninguno). El motor ya devuelve un resultado por moneda; acá se agrupan y,
 * si hay más de una, se elige con chips en vez de sumarlas.
 *
 * ============================================================
 * CUANDO FALTA UN MÓDULO NO ES UN ERROR
 * ============================================================
 *
 * ERP y CRM son anexos contratables. Quien no los tiene igual ve sus
 * indicadores de finanzas; los que dependen de lo que no contrató no se
 * calculan y la ruta los informa en `faltan`. Eso se muestra como una nota
 * al pie, no como una pantalla rota.
 */

type Respuesta = {
  resultados: ResultadoKPI[];
  periodo: { desde: string; hasta: string };
  faltan: { id: string; nombre: string; falta: string[] }[];
};

const ETIQUETA_FAMILIA: Record<Familia, string> = {
  finanzas: "Finanzas",
  ventas: "Ventas",
  crm: "Embudo",
  cartera: "Cobros y pagos",
  inventario: "Inventario",
  compras: "Compras",
};

export default function PanelIndicadores() {
  const [datos, setDatos] = useState<Respuesta | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [moneda, setMoneda] = useState<string | null>(null);
  const [familia, setFamilia] = useState<Familia | "todas">("todas");
  const [abierto, setAbierto] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;

    (async () => {
      try {
        const r = await fetch("/api/kpi", { cache: "no-store" });
        if (!vivo) return;

        if (r.status === 401) {
          // La sesión venció: el shell entero ya maneja ese caso. Acá el panel
          // se calla en vez de mostrar un error sobre otro.
          setDatos(null);
          return;
        }
        if (!r.ok) {
          setError("No pudimos calcular tus indicadores en este momento.");
          return;
        }

        const cuerpo: Respuesta = await r.json();
        setDatos(cuerpo);
      } catch {
        if (vivo) setError("No pudimos calcular tus indicadores en este momento.");
      } finally {
        if (vivo) setCargando(false);
      }
    })();

    return () => {
      vivo = false;
    };
  }, []);

  const monedas = useMemo(
    () => [...new Set((datos?.resultados ?? []).map((r) => r.moneda))].sort(),
    [datos],
  );

  const monedaActiva = moneda ?? monedas[0] ?? null;

  const familiasPresentes = useMemo(() => {
    const orden: Familia[] = ["finanzas", "ventas", "cartera", "compras", "inventario", "crm"];
    const presentes = new Set(
      (datos?.resultados ?? []).filter((r) => r.moneda === monedaActiva).map((r) => r.familia),
    );
    return orden.filter((f) => presentes.has(f));
  }, [datos, monedaActiva]);

  const visibles = useMemo(() => {
    const deMoneda = (datos?.resultados ?? []).filter((r) => r.moneda === monedaActiva);
    const filtrados = familia === "todas" ? deMoneda : deMoneda.filter((r) => r.familia === familia);
    return porPrioridad(filtrados);
  }, [datos, monedaActiva, familia]);

  // El indicador abierto sale de lo VISIBLE: si se cambia de moneda o de
  // familia y el que estaba abierto ya no está en pantalla, el detalle se
  // cierra solo en vez de quedar mostrando la historia de algo que no se ve.
  const abiertoKpi = visibles.find((r) => r.id === abierto) ?? null;

  if (cargando) {
    return (
      <section className="card">
        <div className="card-title">Tus indicadores</div>
        <p className="neg-loading">Calculando…</p>
      </section>
    );
  }

  if (error) {
    return (
      <section className="card">
        <div className="card-title">Tus indicadores</div>
        <p className="neg-load-error" role="alert">{error}</p>
      </section>
    );
  }

  // Sin datos todavía, el panel se calla — la misma doctrina que el resto de
  // las tarjetas del dashboard. Un bloque de guiones no informa nada y ocupa
  // la pantalla que necesita lo que sí tiene algo que decir.
  if (!datos || datos.resultados.length === 0) return null;

  return (
    <section className="card">
      <div className="card-title">Tus indicadores</div>
      <div className="card-sub">
        Del {formatearDia(datos.periodo.desde)} al {formatearDia(datos.periodo.hasta)}, comparado con el
        período anterior de igual largo.
      </div>

      {monedas.length > 1 && (
        <div className="chip-row">
          {monedas.map((m) => (
            <button
              key={m}
              type="button"
              className={`chip ${m === monedaActiva ? "active" : ""}`}
              onClick={() => setMoneda(m)}
            >
              {m}
            </button>
          ))}
        </div>
      )}

      {familiasPresentes.length > 1 && (
        <div className="chip-row">
          <button
            type="button"
            className={`chip ${familia === "todas" ? "active" : ""}`}
            onClick={() => setFamilia("todas")}
          >
            Todos
          </button>
          {familiasPresentes.map((f) => (
            <button
              key={f}
              type="button"
              className={`chip ${familia === f ? "active" : ""}`}
              onClick={() => setFamilia(f)}
            >
              {ETIQUETA_FAMILIA[f]}
            </button>
          ))}
        </div>
      )}

      <div className="kpi-grid">
        {visibles.map((kpi, i) => (
          <TarjetaKPI
            key={kpi.id}
            kpi={kpi}
            retraso={Math.min(i, 8) * 0.04}
            abierto={abierto === kpi.id}
            onAbrir={() => setAbierto(abierto === kpi.id ? null : kpi.id)}
          />
        ))}
      </div>

      {/* La historia va DEBAJO de la grilla y no dentro de la tarjeta: adentro
          la haría cuatro veces más alta y descolocaría toda la fila. Es el
          mismo criterio de `Traza.tsx`, que abre el detalle en su propio
          espacio en vez de empujar el panel. */}
      {abiertoKpi && (
        <div className="kpi-detalle">
          <div className="kpi-detalle-head">
            <strong>{abiertoKpi.nombre}</strong>
            <button type="button" className="ghost-btn" onClick={() => setAbierto(null)}>
              Cerrar
            </button>
          </div>
          {/* La `key` hace que React lo remonte al cambiar de indicador o de
              moneda: así el estado arranca en "cargando" sin que el efecto
              tenga que resetearlo con un setState en cascada. */}
          <HistoriaKPI
            key={`${abiertoKpi.id}-${abiertoKpi.moneda}`}
            id={abiertoKpi.id}
            moneda={abiertoKpi.moneda}
          />
        </div>
      )}

      {datos.faltan.length > 0 && (
        <details className="kpi-faltan">
          <summary>{datos.faltan.length} indicadores que EOS todavía no puede calcular</summary>
          <ul>
            {datos.faltan.map((f) => (
              <li key={f.id}>
                <strong>{f.nombre}</strong> — necesita {f.falta.join(", ")}.
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

/** "15 de agosto", sin `new Date` sobre un ISO pelado (correría el día por zona horaria). */
function formatearDia(iso: string): string {
  const [, mes, dia] = iso.split("-");
  const MESES = [
    "enero", "febrero", "marzo", "abril", "mayo", "junio",
    "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
  ];
  return `${Number(dia)} de ${MESES[Number(mes) - 1]}`;
}
