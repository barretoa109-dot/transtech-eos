"use client";

import { useEffect, useState } from "react";
import { PackageX } from "lucide-react";
import { formatearMonto } from "@/lib/finanzas/formato";

/**
 * Cuánto vale el stock y qué parte no se mueve.
 *
 * Los indicadores de rotación ya salen en el panel del dashboard. Acá va lo
 * que un número no puede dar: CUÁLES productos están quietos. "Tenés
 * Gs. 4.000.000 parados" no se puede accionar; "tenés Gs. 4.000.000 parados
 * en estos seis productos" sí.
 *
 * ============================================================
 * ANTES SE CALLABA; AHORA ES UNA PESTAÑA Y NO PUEDE
 * ============================================================
 *
 * Nació como una tarjeta adentro de otra vista, y ahí callarse cuando no había
 * nada que decir era lo correcto: una tarjeta de más es ruido.
 *
 * Desde que es una pestaña propia, lo mismo se volvió un error. Quien toca
 * "Inventario" y recibe una pantalla en blanco no puede distinguir tres cosas
 * muy distintas —está cargando, se cayó, o de verdad no hay stock— y la
 * primera conclusión de cualquiera es que se rompió.
 *
 * Por eso ahora las tres se dicen por separado.
 */

type Quieto = { id: string; nombre: string; stock: number; valor: number | null };

type MonedaInventario = {
  moneda: string;
  valor: number;
  productos: number;
  sin_costo: number;
  rotacion: number | null;
  dias_inventario: number | null;
  falta_rotacion: string | null;
  quietos: Quieto[];
};

type Respuesta = {
  periodo: { desde: string; hasta: string; dias: number };
  monedas: MonedaInventario[];
};

export default function Inventario() {
  const [datos, setDatos] = useState<Respuesta | null>(null);
  const [cargando, setCargando] = useState(true);
  // Separado de `datos === null` a propósito: "no se pudo leer" y "no hay
  // stock" se ven igual en pantalla si comparten la misma variable.
  const [error, setError] = useState(false);

  useEffect(() => {
    let vivo = true;
    (async () => {
      const res = await traer();
      if (!vivo) return;
      if (res) setDatos(res);
      else setError(true);
      setCargando(false);
    })();
    return () => {
      vivo = false;
    };
  }, []);

  if (cargando) return <p className="neg-loading">Calculando tu inventario…</p>;

  if (error) {
    return <p className="neg-load-error">No pudimos leer tu inventario.</p>;
  }

  if (!datos || datos.monedas.length === 0) {
    return (
      <p className="neg-empty-state">
        Todavía no hay stock que valorizar. En cuanto cargues productos con
        costo y registres movimientos, acá vas a ver cuánto vale tu depósito,
        cada cuánto rota y qué se quedó quieto.
      </p>
    );
  }

  return (
    <>
      {datos.monedas.map((m) => (
        <div key={m.moneda} className="card" style={{ marginBottom: 16 }}>
          <div className="card-title">Tu inventario en {m.moneda}</div>
          <div className="card-sub">Rotación de los últimos {datos.periodo.dias} días.</div>

          <div className="neg-metricas">
            <div className="neg-metrica">
              <span>Valor del stock</span>
              <strong>{formatearMonto(m.valor, m.moneda)}</strong>
              {m.sin_costo > 0 && (
                // El número real es MAYOR que el que se muestra, y quien lo
                // lea tiene que saberlo antes de decidir sobre él.
                <small className="neg-metrica-nota">
                  {m.sin_costo} de {m.productos} productos no tienen costo cargado: vale más que esto
                </small>
              )}
            </div>

            <div className="neg-metrica">
              <span>Rotación</span>
              <strong>{m.rotacion === null ? "—" : `${m.rotacion} veces`}</strong>
              {m.falta_rotacion && <small className="neg-metrica-nota">{m.falta_rotacion}</small>}
            </div>

            <div className="neg-metrica">
              <span>Días de inventario</span>
              <strong>{m.dias_inventario === null ? "—" : `${m.dias_inventario} días`}</strong>
              {m.dias_inventario !== null && (
                <small className="neg-metrica-nota">Lo que dura el stock al ritmo actual</small>
              )}
            </div>
          </div>

          {m.quietos.length > 0 && (
            <>
              <div className="inv-quietos-titulo">
                <PackageX size={14} /> No se movieron en {datos.periodo.dias} días
              </div>
              <div className="neg-lista">
                {m.quietos.map((q) => (
                  <div key={q.id} className="neg-fila">
                    <div className="neg-fila-texto">
                      <strong>{q.nombre}</strong>
                      <small>{q.stock} en stock</small>
                    </div>
                    <div className="neg-fila-monto">
                      {q.valor === null ? (
                        <span className="inv-sin-costo">sin costo cargado</span>
                      ) : (
                        formatearMonto(q.valor, m.moneda)
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      ))}
    </>
  );
}

/** Fuera del componente: así el efecto no toca estado antes de su primer await. */
async function traer(): Promise<Respuesta | null> {
  try {
    const r = await fetch("/api/erp/inventario", { cache: "no-store" });
    if (!r.ok) return null;
    return (await r.json()) as Respuesta;
  } catch {
    return null;
  }
}
