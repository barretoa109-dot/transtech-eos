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
 * Se calla solo cuando no hay nada que decir, igual que el resto del módulo.
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

  useEffect(() => {
    let vivo = true;
    (async () => {
      const res = await traer();
      if (!vivo) return;
      if (res) setDatos(res);
      setCargando(false);
    })();
    return () => {
      vivo = false;
    };
  }, []);

  if (cargando || !datos || datos.monedas.length === 0) return null;

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
