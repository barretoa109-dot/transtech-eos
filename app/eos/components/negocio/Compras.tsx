"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Anular from "./Anular";
import { Check } from "lucide-react";
import { formatearMonto } from "@/lib/finanzas/formato";
import { calcularVenta, tasaValida, type LineaVenta } from "@/lib/erp/impuestos";
import type { Compra, Contacto, Producto } from "./tipos";

/**
 * Lo que el negocio compra.
 *
 * El espejo de las ventas, con la diferencia que importa: acá la plata sale y
 * el stock entra. Y una compra a crédito no descuenta nada todavía — anotarla
 * como gasto hoy mostraría menos disponible del que hay, y el usuario dejaría
 * de gastar plata que sí tiene.
 *
 * El precio que se carga es el de la FACTURA del proveedor, con IVA incluido
 * como viene. Registrarla además actualiza el costo del producto: sin eso, el
 * margen que muestre cualquier informe es el del día que se cargó el producto,
 * y en Paraguay los precios de reposición se mueven seguido.
 */

type LineaEnEdicion = LineaVenta & { producto_id: string | null };

export default function Compras({
  contactos,
  productos,
  onCambio,
}: {
  contactos: Contacto[];
  productos: Producto[];
  onCambio: () => void;
}) {
  const [compras, setCompras] = useState<Compra[]>([]);
  const [cargando, setCargando] = useState(true);
  const [abierto, setAbierto] = useState(false);
  const [contactoId, setContactoId] = useState("");
  const [comprobante, setComprobante] = useState("");
  const [condicion, setCondicion] = useState<"contado" | "credito">("contado");
  const [lineas, setLineas] = useState<LineaEnEdicion[]>([]);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");

  const cargar = useCallback(() => {
    return fetch("/api/erp/compras", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => setCompras(data?.compras ?? []))
      .catch((err) => console.error("No se pudieron cargar las compras:", err))
      .finally(() => setCargando(false));
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const totales = useMemo(() => calcularVenta(lineas), [lineas]);
  const moneda = productos[0]?.moneda ?? "PYG";

  function agregar(producto: Producto) {
    setLineas((actual) => {
      const yaEsta = actual.find((l) => l.producto_id === producto.id);

      if (yaEsta) {
        return actual.map((l) =>
          l.producto_id === producto.id ? { ...l, cantidad: l.cantidad + 1 } : l,
        );
      }

      return [
        ...actual,
        {
          producto_id: producto.id,
          descripcion: producto.nombre,
          cantidad: 1,
          // El costo conocido como punto de partida, no el precio de venta:
          // arrancar con el precio de venta hace registrar compras al valor de
          // la góndola y borra el margen de un plumazo.
          precio_unitario: Number(producto.costo ?? 0),
          iva: tasaValida(producto.iva),
        },
      ];
    });
  }

  async function registrar() {
    if (lineas.length === 0 || guardando) return;

    setGuardando(true);
    setError("");

    try {
      const respuesta = await fetch("/api/erp/compras", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contacto_id: contactoId || null,
          numero_comprobante: comprobante || null,
          condicion,
          moneda,
          items: lineas.map((l) => ({
            producto_id: l.producto_id,
            descripcion: l.descripcion,
            cantidad: l.cantidad,
            precio_unitario: l.precio_unitario,
            iva: l.iva,
          })),
        }),
      });

      const resultado = await respuesta.json().catch(() => null);
      if (!respuesta.ok) throw new Error(resultado?.error || "No se pudo registrar la compra.");

      setLineas([]);
      setComprobante("");
      setAbierto(false);
      void cargar();
      // El panel financiero cambió: la compra pagada ya descontó.
      onCambio();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo registrar la compra.");
    } finally {
      setGuardando(false);
    }
  }

  async function pagar(compra: Compra) {
    const respuesta = await fetch(`/api/erp/compras/${compra.id}/pagar`, { method: "POST" });

    if (respuesta.ok) {
      void cargar();
      onCambio();
    }
  }

  return (
    <>
      <div className="card">
        <div className="card-title">Registrar una compra</div>

        {productos.length === 0 ? (
          <p className="empty-note">
            Primero cargá los productos que comprás, en la pestaña Productos.
          </p>
        ) : !abierto ? (
          <button type="button" className="reco-btn" onClick={() => setAbierto(true)}>
            Nueva compra
          </button>
        ) : (
          <>
            <div className="neg-form">
              <select
                className="neg-input"
                value={contactoId}
                onChange={(e) => setContactoId(e.target.value)}
              >
                <option value="">Sin proveedor</option>
                {contactos.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nombre}
                  </option>
                ))}
              </select>
              <input
                className="neg-input"
                placeholder="Nº de factura del proveedor"
                value={comprobante}
                maxLength={40}
                onChange={(e) => setComprobante(e.target.value)}
              />
              <select
                className="neg-input"
                value={condicion}
                onChange={(e) =>
                  setCondicion(e.target.value === "credito" ? "credito" : "contado")
                }
              >
                <option value="contado">Contado</option>
                <option value="credito">Crédito</option>
              </select>
            </div>

            <div className="neg-catalogo">
              {productos.map((p) => (
                <button key={p.id} type="button" className="neg-chip" onClick={() => agregar(p)}>
                  {p.nombre}
                  <span>{p.controla_stock ? `${p.stock_actual} en stock` : "sin stock"}</span>
                </button>
              ))}
            </div>

            {lineas.length > 0 && (
              <div className="neg-lineas">
                {totales.lineas.map((l, i) => (
                  <div className="neg-linea" key={`${l.descripcion}-${i}`}>
                    <span className="neg-linea-nombre">{l.descripcion}</span>
                    <input
                      className="neg-input neg-cantidad"
                      type="number"
                      min={1}
                      step="1"
                      value={lineas[i].cantidad}
                      onChange={(e) =>
                        setLineas((actual) =>
                          actual.map((linea, j) =>
                            j === i ? { ...linea, cantidad: Number(e.target.value) || 1 } : linea,
                          ),
                        )
                      }
                    />
                    <input
                      className="neg-input neg-cantidad"
                      inputMode="numeric"
                      placeholder="Costo"
                      value={lineas[i].precio_unitario || ""}
                      onChange={(e) =>
                        setLineas((actual) =>
                          actual.map((linea, j) =>
                            j === i
                              ? {
                                  ...linea,
                                  precio_unitario: Number(e.target.value.replace(/[^\d]/g, "")) || 0,
                                }
                              : linea,
                          ),
                        )
                      }
                    />
                    <span className="neg-linea-total">{formatearMonto(l.total, moneda)}</span>
                    <button
                      type="button"
                      className="neg-quitar"
                      onClick={() => setLineas((actual) => actual.filter((_, j) => j !== i))}
                      aria-label={`Quitar ${l.descripcion}`}
                    >
                      ×
                    </button>
                  </div>
                ))}

                <div className="neg-total">
                  <span>IVA incluido {formatearMonto(totales.iva_total, moneda)}</span>
                  <strong>{formatearMonto(totales.total, moneda)}</strong>
                </div>
              </div>
            )}

            {error && <p className="neg-error">{error}</p>}

            <div className="chip-row" style={{ marginTop: 12 }}>
              <button
                type="button"
                className="reco-btn"
                disabled={lineas.length === 0 || guardando}
                onClick={registrar}
              >
                {guardando ? "Registrando…" : "Registrar compra"}
              </button>
              <button type="button" className="chip" onClick={() => setAbierto(false)}>
                Cancelar
              </button>
            </div>
          </>
        )}
      </div>

      <div className="card">
        <div className="card-title">Últimas compras</div>

        {cargando ? (
          <p className="empty-note">Cargando…</p>
        ) : compras.length === 0 ? (
          <p className="empty-note">Todavía no registraste ninguna compra.</p>
        ) : (
          <div className="neg-lista">
            {compras.map((c) => (
              <div className="neg-fila" key={c.id}>
                <div className="neg-fila-texto">
                  <strong>{c.contacto?.nombre ?? "Sin proveedor"}</strong>
                  <small>
                    {c.fecha}
                    {c.numero_comprobante ? ` · ${c.numero_comprobante}` : ""} ·{" "}
                    {c.condicion === "credito" ? "a crédito" : "contado"}
                  </small>
                </div>

                <span className="neg-fila-monto">{formatearMonto(c.total, c.moneda)}</span>

                {c.movimiento_id ? (
                  <span className="neg-estado is-ok">
                    <Check size={12} /> pagada
                  </span>
                ) : (
                  <button type="button" className="chip" onClick={() => pagar(c)}>
                    Pagar
                  </button>
                )}

                <Anular recurso="compras" id={c.id} onAnulado={cargar} />
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
