"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Confirmar from "./Confirmar";
import Anular from "./Anular";
import { AlertCircle, Check, PackagePlus, Plus, ReceiptText, Search, ShoppingCart } from "lucide-react";
import { formatearMonto } from "@/lib/finanzas/formato";
import { calcularVenta, tasaValida, type LineaVenta } from "@/lib/erp/impuestos";
import { avisoMonedasMezcladas, monedaDelDocumento } from "@/lib/erp/moneda-documento";
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
  const [errorCarga, setErrorCarga] = useState("");
  const [exito, setExito] = useState("");
  const [busqueda, setBusqueda] = useState("");
  const [pagandoId, setPagandoId] = useState<string | null>(null);

  const cargar = useCallback(() => {
    return Promise.resolve()
      .then(() => {
        setErrorCarga("");
        setCargando(true);
        return fetch("/api/erp/compras", { cache: "no-store" });
      })
      .then(async (r) => {
        const data = await r.json().catch(() => null);
        if (!r.ok) throw new Error(data?.error || "No se pudieron cargar las compras.");
        return data;
      })
      .then((data) => setCompras(data?.compras ?? []))
      .catch((err) => {
        console.error("No se pudieron cargar las compras:", err);
        setErrorCarga(err instanceof Error ? err.message : "No se pudieron cargar las compras.");
      })
      .finally(() => setCargando(false));
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const totales = useMemo(() => calcularVenta(lineas), [lineas]);
  const productosVisibles = useMemo(() => {
    const termino = busqueda.trim().toLocaleLowerCase("es");
    if (!termino) return productos;
    return productos.filter((p) =>
      `${p.nombre} ${p.codigo ?? ""}`.toLocaleLowerCase("es").includes(termino),
    );
  }, [busqueda, productos]);
  const resumen = useMemo(() => {
    const pendientes = compras.filter((c) => !c.movimiento_id);
    const monedas = new Set(compras.map((c) => c.moneda));
    const montoPendiente = monedas.size <= 1
      ? pendientes.reduce((suma, c) => suma + Number(c.total || 0), 0)
      : null;
    return { pendientes: pendientes.length, montoPendiente, moneda: compras[0]?.moneda ?? "PYG" };
  }, [compras]);

  // La moneda sale de los productos que están EN esta compra, no del primero
  // del catálogo: con un solo producto en dólares arriba de la lista, toda
  // compra en guaraníes se registraba como USD. Ver `lib/erp/moneda-documento`.
  const monedaDocumento = useMemo(
    () => monedaDelDocumento(lineas.map((l) => productos.find((p) => p.id === l.producto_id)?.moneda)),
    [lineas, productos],
  );

  const moneda = monedaDocumento.ok ? monedaDocumento.moneda : "PYG";
  const mezclaMonedas = !monedaDocumento.ok;

  /** Cada línea se muestra en la moneda de SU producto, mezcladas o no. */
  function monedaDeLinea(productoId: string | null | undefined) {
    const resultado = monedaDelDocumento([productos.find((p) => p.id === productoId)?.moneda]);
    return resultado.ok ? resultado.moneda : moneda;
  }

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
    if (lineas.some((l) => l.cantidad <= 0 || l.precio_unitario <= 0)) {
      setError("Revisá las cantidades y costos: deben ser mayores que cero.");
      return;
    }

    // La base lo rechaza igual (trigger v93), pero enterarse acá evita perder
    // la carga entera contra un error que ya se podía ver.
    if (!monedaDocumento.ok) {
      setError(avisoMonedasMezcladas(monedaDocumento.monedas));
      return;
    }

    setGuardando(true);
    setError("");
    setExito("");

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
      setContactoId("");
      setCondicion("contado");
      setAbierto(false);
      setExito("Compra registrada. El stock y los indicadores ya están actualizados.");
      await cargar();
      // El panel financiero cambió: la compra pagada ya descontó.
      onCambio();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo registrar la compra.");
    } finally {
      setGuardando(false);
    }
  }

  async function pagar(compra: Compra) {
    if (pagandoId) return;
    setPagandoId(compra.id);
    setError("");
    setExito("");
    try {
      const respuesta = await fetch(`/api/erp/compras/${compra.id}/pagar`, { method: "POST" });
      const resultado = await respuesta.json().catch(() => null);
      if (!respuesta.ok) throw new Error(resultado?.error || "No se pudo registrar el pago.");
      setExito("Pago registrado en el panel financiero.");
      await cargar();
      onCambio();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo registrar el pago.");
    } finally {
      setPagandoId(null);
    }
  }

  return (
    <>
      <div className="card">
        <div className="neg-section-heading">
          <div>
            <div className="card-title">Compras y abastecimiento</div>
            <div className="card-sub">Registrá facturas, actualizá costos y mantené el stock al día.</div>
          </div>
          {productos.length > 0 && !abierto && (
            <button type="button" className="reco-btn" onClick={() => { setAbierto(true); setExito(""); }}>
              <Plus size={16} /> Nueva compra
            </button>
          )}
        </div>

        {!cargando && compras.length > 0 && (
          <div className="neg-metricas" aria-label="Resumen de compras">
            <div className="neg-metrica"><span>Compras registradas</span><strong>{compras.length}</strong></div>
            <div className="neg-metrica"><span>Pagos pendientes</span><strong>{resumen.pendientes}</strong></div>
            <div className="neg-metrica"><span>Saldo pendiente</span><strong>{resumen.montoPendiente === null ? "Varias monedas" : formatearMonto(resumen.montoPendiente, resumen.moneda)}</strong></div>
          </div>
        )}

        {exito && <p className="neg-feedback is-ok" role="status"><Check size={15} /> {exito}</p>}

        {productos.length === 0 ? (
          <div className="neg-empty-state">
            <PackagePlus size={28} />
            <strong>Prepará tu catálogo antes de comprar</strong>
            <p>Cargá al menos un producto en la pestaña Productos. Después vas a poder registrar facturas y actualizar existencias automáticamente.</p>
          </div>
        ) : abierto ? (
          <>
            <div className="neg-form-title"><ReceiptText size={17} /> Datos de la factura</div>
            <div className="neg-form">
              <label className="neg-field"><span>Proveedor</span><select className="neg-input" value={contactoId} onChange={(e) => setContactoId(e.target.value)}><option value="">Sin proveedor asignado</option>{contactos.filter((c) => c.es_proveedor).map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}</select></label>
              <label className="neg-field"><span>Nº de factura</span><input className="neg-input" placeholder="Ej. 001-001-0001234" value={comprobante} maxLength={40} onChange={(e) => setComprobante(e.target.value)} /></label>
              <label className="neg-field"><span>Condición</span><select className="neg-input" value={condicion} onChange={(e) => setCondicion(e.target.value === "credito" ? "credito" : "contado")}><option value="contado">Contado · registrar pago ahora</option><option value="credito">Crédito · pagar después</option></select></label>
            </div>

            <div className="neg-form-title"><ShoppingCart size={17} /> Productos de la compra</div>
            <label className="neg-search"><Search size={15} /><input value={busqueda} placeholder="Buscar por nombre o código" onChange={(e) => setBusqueda(e.target.value)} /></label>
            <div className="neg-catalogo">
              {productosVisibles.map((p) => (
                <button key={p.id} type="button" className="neg-chip" onClick={() => agregar(p)}>
                  {p.nombre}
                  <span>{p.codigo ? `${p.codigo} · ` : ""}{p.controla_stock ? `${p.stock_actual} en stock` : "servicio"}</span>
                </button>
              ))}
            </div>
            {productosVisibles.length === 0 && <p className="empty-note">No encontramos productos con “{busqueda}”.</p>}

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
                    <span className="neg-linea-total">
                      {formatearMonto(l.total, monedaDeLinea(lineas[i]?.producto_id))}
                    </span>
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

                {/*
                  Con dos monedas adentro no se muestra ningún total: el único
                  que se podría dibujar sería la suma de guaraníes con dólares,
                  y ese número no existe. Se dice el problema en su lugar.
                */}
                {mezclaMonedas ? (
                  <p className="neg-error" role="alert">
                    {avisoMonedasMezcladas(monedaDocumento.monedas)}
                  </p>
                ) : (
                  <div className="neg-total">
                    <span>IVA incluido {formatearMonto(totales.iva_total, moneda)}</span>
                    <strong>{formatearMonto(totales.total, moneda)}</strong>
                  </div>
                )}
              </div>
            )}

            {error && <p className="neg-error" role="alert"><AlertCircle size={14} /> {error}</p>}

            <div className="chip-row" style={{ marginTop: 12 }}>
              <button
                type="button"
                className="reco-btn"
                disabled={lineas.length === 0 || guardando || mezclaMonedas}
                onClick={registrar}
              >
                {guardando ? "Registrando…" : "Registrar compra"}
              </button>
              <button type="button" className="chip" disabled={guardando} onClick={() => { setAbierto(false); setLineas([]); setError(""); }}>
                Cancelar
              </button>
            </div>
          </>
        ) : null}
      </div>

      <div className="card">
        <div className="card-title">Últimas compras</div>

        {cargando ? (
          <div className="neg-loading" role="status"><span /> Cargando compras…</div>
        ) : errorCarga ? (
          <div className="neg-empty-state is-error"><AlertCircle size={25} /><strong>No pudimos cargar las compras</strong><p>{errorCarga}</p><button type="button" className="chip active" onClick={() => void cargar()}>Reintentar</button></div>
        ) : compras.length === 0 ? (
          <div className="neg-empty-state"><ReceiptText size={28} /><strong>Tu historial empieza con la primera factura</strong><p>Las compras registradas aparecerán acá con su proveedor, condición de pago y total.</p>{productos.length > 0 && <button type="button" className="chip active" onClick={() => setAbierto(true)}>Registrar primera compra</button>}</div>
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
                  <Confirmar
                    etiqueta="Pagar"
                    consecuencia={
                      `Se registra un egreso de ${formatearMonto(c.total, c.moneda)} en tu panel, ` +
                      "con la fecha de hoy. Si te equivocaste de compra, se corrige anulándola."
                    }
                    confirmar="Sí, pagar"
                    onConfirmar={() => void pagar(c)}
                    ocupado={pagandoId === c.id}
                    ocupadoTexto="Registrando…"
                  />
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
