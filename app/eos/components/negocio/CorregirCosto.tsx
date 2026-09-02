"use client";

import { useState } from "react";
import { Check, Pencil, X } from "lucide-react";

import { formatearMonto } from "@/lib/finanzas/formato";
import { calcularMargen, textoMargen } from "@/lib/erp/margen";
import { tasaValida } from "@/lib/erp/impuestos";

/**
 * Corregir el costo de una venta ya registrada.
 *
 * ============================================================
 * POR QUÉ EXISTE
 * ============================================================
 *
 * Cada línea de venta congela el costo que el producto tenía al venderse, para
 * que la subida de un proveedor no cambie el margen de una venta de la semana
 * pasada. El efecto secundario es que un costo mal tipeado queda mal para
 * siempre: arreglar la ficha del producto no arregla lo ya vendido.
 *
 * Lo pidió Sofía, que usa EOS para su negocio. Corregir un error de carga no
 * es reescribir la historia; es escribirla bien.
 *
 * ============================================================
 * SOLO EL COSTO
 * ============================================================
 *
 * Ni el precio, ni la cantidad, ni el total. Eso ya se contó en el stock, en
 * el panel financiero y en el embudo, y cambiarlo por atrás dejaría dos
 * verdades circulando. Para eso está anular y volver a cargar, que deja
 * rastro de las dos.
 */

type Item = {
  id: string;
  descripcion: string;
  cantidad: number;
  precio_unitario: number;
  iva: number;
  costo_unitario?: number | null;
};

export default function CorregirCosto({
  ventaId,
  moneda,
  items,
  onCorregido,
}: {
  ventaId: string;
  moneda: string;
  items: Item[];
  onCorregido: () => void;
}) {
  const [abierto, setAbierto] = useState(false);
  const [valores, setValores] = useState<Record<string, string>>({});
  const [tambienProducto, setTambienProducto] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");

  function abrir() {
    setValores(
      Object.fromEntries(
        items.map((i) => [
          i.id,
          i.costo_unitario === null || i.costo_unitario === undefined
            ? ""
            : String(i.costo_unitario),
        ]),
      ),
    );
    setError("");
    setAbierto(true);
  }

  async function guardar() {
    if (guardando) return;

    setGuardando(true);
    setError("");

    try {
      const respuesta = await fetch(`/api/erp/ventas/${ventaId}/costos`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          costos: items.map((i) => ({
            item_id: i.id,
            costo_unitario: valores[i.id]?.trim() === "" ? null : valores[i.id],
          })),
          actualizar_producto: tambienProducto,
        }),
      });

      const datos = await respuesta.json().catch(() => null);
      if (!respuesta.ok) throw new Error(datos?.error || "No pudimos corregir el costo.");

      setAbierto(false);
      onCorregido();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pudimos corregir el costo.");
    } finally {
      setGuardando(false);
    }
  }

  if (!abierto) {
    return (
      <button type="button" className="chip" onClick={abrir}>
        <Pencil size={13} /> Costo
      </button>
    );
  }

  return (
    <div className="neg-costos">
      <div className="neg-costos-titulo">
        Corregir el costo de lo vendido
        <button type="button" className="chip" onClick={() => setAbierto(false)}>
          <X size={13} />
        </button>
      </div>

      {items.map((item) => {
        /*
         * El margen se recalcula mientras escribe, con la misma función que la
         * ficha del producto y que los indicadores. Es lo que le dice si el
         * número que está tipeando tiene sentido antes de guardarlo.
         */
        const margen = calcularMargen({
          costo: valores[item.id]?.trim() === "" ? null : Number(valores[item.id]),
          precio_venta: item.precio_unitario,
          iva: tasaValida(item.iva),
        });

        return (
          <label className="neg-costos-fila" key={item.id}>
            <span className="neg-costos-nombre">
              {item.descripcion}
              <small>
                se vendió a {formatearMonto(item.precio_unitario, moneda)} por unidad
              </small>
            </span>

            <input
              className="neg-input"
              inputMode="numeric"
              placeholder="Costo por unidad"
              value={valores[item.id] ?? ""}
              onChange={(e) =>
                setValores((previo) => ({
                  ...previo,
                  [item.id]: e.target.value.replace(/[^\d]/g, ""),
                }))
              }
            />

            <small className={`fila-margen${margen.conocido && margen.pierde ? " is-perdida" : ""}`}>
              {textoMargen(margen)}
            </small>
          </label>
        );
      })}

      <label className="neg-check">
        <input
          type="checkbox"
          checked={tambienProducto}
          onChange={(e) => setTambienProducto(e.target.checked)}
        />
        Corregir también el costo en el catálogo
      </label>
      <p className="neg-costos-nota">
        Dejalo marcado si te equivocaste al cargarlo. Desmarcalo si el costo cambió después
        —subió el proveedor— y el de la ficha ya está bien.
      </p>

      {error && <p className="neg-error">{error}</p>}

      <button type="button" className="reco-btn" disabled={guardando} onClick={guardar}>
        <Check size={14} /> {guardando ? "Guardando…" : "Guardar el costo"}
      </button>
    </div>
  );
}
