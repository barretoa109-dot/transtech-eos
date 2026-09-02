"use client";

import { useState } from "react";
import { Check, Pencil, X } from "lucide-react";

import { formatearMonto } from "@/lib/finanzas/formato";
import { calcularMargen, textoMargen } from "@/lib/erp/margen";
import { tasaValida } from "@/lib/erp/impuestos";

/**
 * Corregir lo que se cargó mal, en una venta o en una compra.
 *
 * ============================================================
 * POR QUÉ EXISTE
 * ============================================================
 *
 * Lo pidió Sofía, que usa EOS para su negocio: "poder editar si cargué mal el
 * costo". Son dos agujeros distintos con la misma forma.
 *
 * En VENTAS, cada línea congela el costo que el producto tenía al venderse,
 * para que la subida de un proveedor no cambie el margen de una venta de la
 * semana pasada. El efecto secundario es que un costo mal tipeado queda mal
 * para siempre: arreglar la ficha no arregla lo ya vendido.
 *
 * En COMPRAS, el precio que se paga ES el costo. Un número mal tipeado se
 * convierte en el costo del producto, en el margen de todo lo que se venda
 * después y en un gasto del panel.
 *
 * Corregir un error de carga no es reescribir la historia; es escribirla bien.
 *
 * ============================================================
 * UN SOLO COMPONENTE PARA LAS DOS
 * ============================================================
 *
 * Porque la pantalla es la misma —una lista de líneas con un número editable y
 * el margen al lado— y dos copias divergen: se arregla un detalle en ventas y
 * seis meses después alguien descubre que en compras nunca se arregló.
 *
 * Lo que cambia entre las dos va en esta tabla y en ningún otro lado.
 */

const MODOS = {
  venta: {
    boton: "Costo",
    titulo: "Corregir el costo de lo vendido",
    campo: "costo_unitario" as const,
    lista: "costos" as const,
    ruta: (id: string) => `/api/erp/ventas/${id}/costos`,
    marcador: "Costo por unidad",
    // En una venta, vacío es "no sé cuánto costó" — legítimo y distinto de
    // cero, que mostraría 100% de margen.
    permiteVacio: true,
    referencia: (monto: string) => `se vendió a ${monto} por unidad`,
    casilla: "Corregir también el costo en el catálogo",
    nota:
      "Dejalo marcado si te equivocaste al cargarlo. Desmarcalo si el costo cambió después " +
      "—subió el proveedor— y el de la ficha ya está bien.",
  },
  compra: {
    boton: "Editar",
    titulo: "Corregir lo que pagaste",
    campo: "precio_unitario" as const,
    lista: "precios" as const,
    ruta: (id: string) => `/api/erp/compras/${id}/precios`,
    marcador: "Precio por unidad",
    // Una compra sin precio no existe: algo se pagó.
    permiteVacio: false,
    referencia: (monto: string) => `figura a ${monto} por unidad`,
    casilla: "Actualizar también el costo en el catálogo",
    nota:
      "El total de la compra y su gasto se recalculan solos. Las cantidades no se editan acá: " +
      "el stock ya se sumó, y para cambiarlo hay que anular y volver a cargar.",
  },
};

type Item = {
  id: string;
  descripcion: string;
  cantidad: number;
  precio_unitario: number;
  iva: number;
  costo_unitario?: number | null;
};

export default function CorregirCosto({
  modo,
  documentoId,
  moneda,
  items,
  onCorregido,
}: {
  modo: keyof typeof MODOS;
  documentoId: string;
  moneda: string;
  items: Item[];
  onCorregido: () => void;
}) {
  const config = MODOS[modo];

  const [abierto, setAbierto] = useState(false);
  const [valores, setValores] = useState<Record<string, string>>({});
  const [tambienProducto, setTambienProducto] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");

  function valorInicial(item: Item): string {
    const actual = modo === "venta" ? item.costo_unitario : item.precio_unitario;
    return actual === null || actual === undefined ? "" : String(actual);
  }

  function abrir() {
    setValores(Object.fromEntries(items.map((i) => [i.id, valorInicial(i)])));
    setError("");
    setAbierto(true);
  }

  async function guardar() {
    if (guardando) return;

    if (!config.permiteVacio && items.some((i) => (valores[i.id] ?? "").trim() === "")) {
      setError("Todas las líneas necesitan un precio.");
      return;
    }

    setGuardando(true);
    setError("");

    try {
      const respuesta = await fetch(config.ruta(documentoId), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          [config.lista]: items.map((i) => ({
            item_id: i.id,
            [config.campo]: valores[i.id]?.trim() === "" ? null : valores[i.id],
          })),
          actualizar_producto: tambienProducto,
        }),
      });

      const datos = await respuesta.json().catch(() => null);
      if (!respuesta.ok) throw new Error(datos?.error || "No pudimos guardar la corrección.");

      setAbierto(false);
      onCorregido();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pudimos guardar la corrección.");
    } finally {
      setGuardando(false);
    }
  }

  if (!abierto) {
    return (
      <button type="button" className="chip" onClick={abrir}>
        <Pencil size={13} /> {config.boton}
      </button>
    );
  }

  return (
    <div className="neg-costos">
      <div className="neg-costos-titulo">
        {config.titulo}
        <button type="button" className="chip" onClick={() => setAbierto(false)} aria-label="Cerrar">
          <X size={13} />
        </button>
      </div>

      {items.map((item) => {
        /*
         * El margen se recalcula mientras escribe, con la misma función que la
         * ficha del producto y que los indicadores. Es lo que le dice si el
         * número que está tipeando tiene sentido antes de guardarlo.
         *
         * En una compra no hay precio de venta a mano, así que no hay margen
         * que mostrar: se muestra el total de la línea, que es lo que cambia.
         */
        const escrito = valores[item.id]?.trim() ?? "";
        const numero = escrito === "" ? null : Number(escrito);

        const margen =
          modo === "venta"
            ? calcularMargen({
                costo: numero,
                precio_venta: item.precio_unitario,
                iva: tasaValida(item.iva),
              })
            : null;

        return (
          <label className="neg-costos-fila" key={item.id}>
            <span className="neg-costos-nombre">
              {item.descripcion}
              <small>
                {config.referencia(formatearMonto(item.precio_unitario, moneda))}
                {" · "}
                {item.cantidad} {item.cantidad === 1 ? "unidad" : "unidades"}
              </small>
            </span>

            <input
              className="neg-input"
              inputMode="numeric"
              placeholder={config.marcador}
              value={valores[item.id] ?? ""}
              onChange={(e) =>
                setValores((previo) => ({
                  ...previo,
                  [item.id]: e.target.value.replace(/[^\d]/g, ""),
                }))
              }
            />

            <small
              className={`fila-margen${margen?.conocido && margen.pierde ? " is-perdida" : ""}`}
            >
              {margen
                ? textoMargen(margen)
                : numero === null
                  ? "Falta el precio"
                  : `Esta línea pasa a ${formatearMonto(numero * item.cantidad, moneda)}`}
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
        {config.casilla}
      </label>
      <p className="neg-costos-nota">{config.nota}</p>

      {error && <p className="neg-error">{error}</p>}

      <button type="button" className="reco-btn" disabled={guardando} onClick={guardar}>
        <Check size={14} /> {guardando ? "Guardando…" : "Guardar"}
      </button>
    </div>
  );
}
