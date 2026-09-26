"use client";

import { useMemo, useState } from "react";
import { Check, PackagePlus } from "lucide-react";

import { formatearMonto } from "@/lib/finanzas/formato";
import { conceptosSinCatalogo, type CompraParaCatalogo } from "@/lib/erp/conceptos-sin-catalogo";
import { calcularMargen, textoMargen } from "@/lib/erp/margen";

/**
 * Pasar al catálogo lo que se compró escribiendo el concepto a mano.
 *
 * Una compra con un concepto libre no crea el producto, y quien empezó así ve
 * Productos vacío. Acá se ofrece cada concepto suelto con lo que ya se sabe
 * —costo y cantidad comprada— y se pide solo el precio de venta.
 *
 * Lo que se cargue sin precio de venta se saltea y sigue ofrecido: un producto
 * con precio cero vendería gratis sin avisar.
 */

type Fila = { nombre: string; precio: string; stock: string; llevaStock: boolean };

export default function PasarAlCatalogo({
  compras,
  nombresDelCatalogo,
  onCambio,
}: {
  compras: CompraParaCatalogo[];
  nombresDelCatalogo: string[];
  onCambio: () => void;
}) {
  const conceptos = useMemo(
    () => conceptosSinCatalogo(compras, nombresDelCatalogo),
    [compras, nombresDelCatalogo],
  );

  const [abierto, setAbierto] = useState(false);
  const [filas, setFilas] = useState<Record<string, Fila>>({});
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  const [exito, setExito] = useState("");

  function fila(clave: string, nombre: string, cantidad: number): Fila {
    return filas[clave] ?? { nombre, precio: "", stock: String(cantidad), llevaStock: true };
  }

  function cambiar(clave: string, base: Fila, cambio: Partial<Fila>) {
    setFilas((actual) => ({ ...actual, [clave]: { ...base, ...cambio } }));
  }

  async function guardar() {
    setGuardando(true);
    setError("");
    setExito("");

    let creados = 0;
    const fallidos: string[] = [];

    for (const c of conceptos) {
      const f = fila(c.clave, c.nombre, c.cantidad);
      if (!f.precio.trim() || !f.nombre.trim()) continue;

      try {
        const respuesta = await fetch("/api/erp/productos", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            nombre: f.nombre,
            precio_venta: Number(f.precio),
            costo: c.costo,
            iva: c.iva,
            moneda: c.moneda,
            controla_stock: f.llevaStock,
            stock_actual: f.llevaStock ? Number(f.stock) || 0 : 0,
          }),
        });

        if (respuesta.ok) creados += 1;
        else fallidos.push(f.nombre);
      } catch {
        fallidos.push(f.nombre);
      }
    }

    setGuardando(false);

    if (creados === 0 && fallidos.length === 0) {
      setError("Poné el precio de venta de al menos uno.");
      return;
    }

    if (creados > 0) {
      setFilas({});
      setExito(`Se agregaron ${creados} al catálogo.`);
      onCambio();
    }

    if (fallidos.length > 0) {
      setError(`No pudimos guardar: ${fallidos.join(", ")}. Probá de nuevo.`);
    }
  }

  if (conceptos.length === 0) {
    return exito ? (
      <p className="neg-feedback is-ok" role="status">
        <Check size={15} /> {exito}
      </p>
    ) : null;
  }

  return (
    <div className="neg-empty-state" style={{ alignItems: "stretch", textAlign: "left" }}>
      <strong>
        <PackagePlus size={16} style={{ display: "inline", marginRight: 6, verticalAlign: -3 }} />
        Compraste {conceptos.length} {conceptos.length === 1 ? "cosa que no está" : "cosas que no están"} en tu catálogo
      </strong>
      <p>
        Pasalas al catálogo para ver su stock y su margen. Ya sabemos el costo y cuánto compraste:
        solo falta el precio al que vendés.
      </p>

      {exito && (
        <p className="neg-feedback is-ok" role="status">
          <Check size={15} /> {exito}
        </p>
      )}

      {!abierto ? (
        <button type="button" className="chip active" onClick={() => setAbierto(true)}>
          Pasar al catálogo
        </button>
      ) : (
        <>
          {conceptos.map((c) => {
            const f = fila(c.clave, c.nombre, c.cantidad);
            const margen = calcularMargen({
              costo: c.costo,
              precio_venta: Number(f.precio) || 0,
              iva: c.iva,
            });

            return (
              <div className="neg-manual-item" key={c.clave}>
                <label className="neg-field neg-field-wide">
                  <span>Nombre</span>
                  <input
                    className="neg-input"
                    value={f.nombre}
                    maxLength={200}
                    onChange={(e) => cambiar(c.clave, f, { nombre: e.target.value })}
                  />
                </label>
                <label className="neg-field">
                  <span>Precio de venta (IVA incluido)</span>
                  <input
                    className="neg-input"
                    inputMode="numeric"
                    placeholder="Falta este"
                    value={f.precio}
                    onChange={(e) => cambiar(c.clave, f, { precio: e.target.value.replace(/[^\d]/g, "") })}
                  />
                </label>
                <label className="neg-field neg-field-small">
                  <span>Stock</span>
                  <input
                    className="neg-input"
                    inputMode="numeric"
                    disabled={!f.llevaStock}
                    value={f.llevaStock ? f.stock : ""}
                    onChange={(e) => cambiar(c.clave, f, { stock: e.target.value.replace(/[^\d.]/g, "") })}
                  />
                </label>
                <label className="neg-field neg-field-small">
                  <span>Lleva stock</span>
                  <input
                    type="checkbox"
                    checked={f.llevaStock}
                    onChange={(e) => cambiar(c.clave, f, { llevaStock: e.target.checked })}
                  />
                </label>
                <small style={{ flexBasis: "100%" }}>
                  Costo {formatearMonto(c.costo, c.moneda)} · comprado {c.cantidad}
                  {f.precio ? ` · ${textoMargen(margen)}` : ""}
                </small>
              </div>
            );
          })}

          {error && (
            <p className="neg-error" role="alert">
              {error}
            </p>
          )}

          <button type="button" className="reco-btn" disabled={guardando} onClick={() => void guardar()}>
            {guardando ? "Guardando…" : "Agregar al catálogo"}
          </button>
        </>
      )}
    </div>
  );
}
