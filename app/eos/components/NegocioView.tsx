"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Plus, Receipt } from "lucide-react";
import { formatearMonto } from "@/lib/finanzas/formato";
import { calcularVenta, tasaValida, type LineaVenta, type TasaIva } from "@/lib/erp/impuestos";
import Embudo from "./negocio/Embudo";
import Compras from "./negocio/Compras";
import Emisor from "./negocio/Emisor";
import Anular from "./negocio/Anular";
import FilaProducto from "./negocio/FilaProducto";
import FilaContacto from "./negocio/FilaContacto";
import type { Contacto, Producto } from "./negocio/tipos";

/**
 * El negocio adentro de EOS.
 *
 * ============================================================
 * POR QUÉ TRES PESTAÑAS Y NO UN MENÚ DE VEINTE
 * ============================================================
 *
 * Un ERP de manual tiene módulos, submódulos y una pantalla de configuración
 * antes de poder cargar el primer producto. La persona para la que esto se
 * construyó —el que hoy anota las ventas en un cuaderno— abandona ahí mismo.
 *
 * Entonces son tres cosas, en el orden en que se necesitan: a quién le vendo,
 * qué vendo, y qué vendí. Todo lo demás —oportunidades, compras, actividades—
 * ya existe en la base y va a ir apareciendo, pero no puede estar en el camino
 * del primer día.
 *
 * ============================================================
 * EL TOTAL SE CALCULA ACÁ Y TAMBIÉN EN LA BASE
 * ============================================================
 *
 * Acá, para que el número se mueva mientras se carga la venta. En la base, para
 * cobrar. Es la misma cuenta escrita dos veces a propósito, con la misma regla
 * —el IVA se saca de adentro del precio, no se suma— y la de la base es la que
 * manda si alguna vez no coinciden.
 */


type VentaItem = {
  id: string;
  descripcion: string;
  cantidad: number;
  precio_unitario: number;
  iva: number;
  total: number;
  orden: number;
};

type Venta = {
  id: string;
  fecha: string;
  moneda: string;
  total: number;
  iva_total: number;
  condicion: string;
  estado: string;
  movimiento_id: string | null;
  contacto: { id: string; nombre: string } | null;
  items: VentaItem[];
};

type Pestania = "ventas" | "compras" | "productos" | "clientes" | "embudo" | "emisor";

/*
 * El orden es el del día de trabajo, no el del organigrama: primero lo que
 * entra, después lo que sale, después el catálogo y la gente, y al final lo
 * que se mira de vez en cuando.
 *
 * Las tres primeras viven en este archivo porque comparten el estado de la
 * carga; las tres últimas son pantallas propias en `./negocio`, que es lo que
 * mantiene este archivo legible.
 */
const PESTANIAS: { clave: Pestania; etiqueta: string }[] = [
  { clave: "ventas", etiqueta: "Ventas" },
  { clave: "compras", etiqueta: "Compras" },
  { clave: "productos", etiqueta: "Productos" },
  { clave: "clientes", etiqueta: "Clientes" },
  { clave: "embudo", etiqueta: "Embudo" },
  { clave: "emisor", etiqueta: "Facturación" },
];

export default function NegocioView() {
  const [pestania, setPestania] = useState<Pestania>("ventas");
  const [contactos, setContactos] = useState<Contacto[]>([]);
  const [productos, setProductos] = useState<Producto[]>([]);
  const [ventas, setVentas] = useState<Venta[]>([]);
  const [sinModulo, setSinModulo] = useState(false);
  const [error, setError] = useState("");
  const [cargando, setCargando] = useState(true);

  /*
   * No prende el cartel de "cargando" al empezar.
   *
   * El estado ya nace en true para la primera carga; en las siguientes —cuando
   * se agrega un producto o se cobra una venta— la lista se actualiza sin
   * parpadear en blanco. Y de paso evita un setState síncrono dentro del
   * efecto, que dispara un render en cascada.
   */
  /*
   * Cadena de promesas y no `async`, igual que el resto de los paneles.
   *
   * La regla de React que prohíbe llamar setState de forma síncrona dentro de
   * un efecto mira la función que se invoca, no si adentro hay awaits. Con la
   * cadena, los setState quedan dentro de callbacks y el efecto solo dispara
   * la carga — que es exactamente lo que hace, y lo que la regla quiere.
   */
  const cargar = useCallback(() => {
    return Promise.all([
      fetch("/api/erp/contactos", { cache: "no-store" }),
      fetch("/api/erp/productos", { cache: "no-store" }),
      fetch("/api/erp/ventas", { cache: "no-store" }),
    ])
      .then(async (respuestas) => {
        // 403 es "no contrataste el módulo", y eso no es un error: es una
        // invitación. Mostrar "algo salió mal" ahí sería mentirle al usuario
        // sobre por qué no ve nada.
        if (respuestas.some((r) => r.status === 403)) {
          setSinModulo(true);
          return;
        }

        const [contactosData, productosData, ventasData] = await Promise.all(
          respuestas.map((r) => r.json().catch(() => null)),
        );

        setContactos(contactosData?.contactos ?? []);
        setProductos(productosData?.productos ?? []);
        setVentas(ventasData?.ventas ?? []);
      })
      .catch((err) => {
        console.error("No se pudo cargar el negocio:", err);
        setError("No pudimos cargar tu negocio en este momento.");
      })
      .finally(() => setCargando(false));
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  if (sinModulo) {
    return (
      <div className="view" id="view-negocio">
        <div className="page page-in">
          <div className="page-header">
            <div className="page-eyebrow">Negocio</div>
            <div className="page-title">Tu ERP y tu CRM, adentro de EOS</div>
            <div className="page-sub">
              Clientes, productos y ventas conectados a tu panel financiero.
            </div>
          </div>

          <div className="card">
            <div className="card-title">Todavía no lo tenés activo</div>
            <p className="prose">
              El módulo de gestión se contrata aparte. Con él, cada venta que cargues aparece
              sola en tu disponible real: no hay que anotar la plata dos veces.
            </p>
            <a className="reco-btn" href="/planes" style={{ display: "inline-flex", marginTop: 12 }}>
              Ver cómo sumarlo
            </a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="view" id="view-negocio">
      <div className="page page-in">
        <div className="page-header">
          <div className="page-eyebrow">Negocio</div>
          <div className="page-title">Tu ERP y tu CRM</div>
          <div className="page-sub">
            Lo que vendés, a quién, y cuánto entró. Cada venta cobrada cae sola en tu panel.
          </div>
        </div>

        <div className="chip-row">
          {PESTANIAS.map((p) => (
            <button
              key={p.clave}
              type="button"
              className={`chip ${pestania === p.clave ? "active" : ""}`}
              onClick={() => setPestania(p.clave)}
            >
              {p.etiqueta}
            </button>
          ))}
        </div>

        {error && (
          <div className="card" style={{ borderColor: "var(--amber)", color: "var(--amber)" }}>
            {error}
          </div>
        )}

        {cargando ? (
          <p className="empty-note">Cargando tu negocio…</p>
        ) : pestania === "ventas" ? (
          <Ventas
            ventas={ventas}
            contactos={contactos}
            productos={productos}
            onCambio={() => void cargar()}
          />
        ) : pestania === "compras" ? (
          <Compras
            contactos={contactos.filter((c) => c.es_proveedor || !c.es_cliente)}
            productos={productos}
            onCambio={() => void cargar()}
          />
        ) : pestania === "productos" ? (
          <Productos productos={productos} onCambio={() => void cargar()} />
        ) : pestania === "embudo" ? (
          <Embudo contactos={contactos} />
        ) : pestania === "emisor" ? (
          <Emisor />
        ) : (
          <Clientes contactos={contactos} onCambio={() => void cargar()} />
        )}
      </div>
    </div>
  );
}

/* ============================================================
   VENTAS
   ============================================================ */

type LineaEnEdicion = LineaVenta & { producto_id: string | null };

function Ventas({
  ventas,
  contactos,
  productos,
  onCambio,
}: {
  ventas: Venta[];
  contactos: Contacto[];
  productos: Producto[];
  onCambio: () => void;
}) {
  const [abierto, setAbierto] = useState(false);
  const [contactoId, setContactoId] = useState("");
  const [condicion, setCondicion] = useState<"contado" | "credito">("contado");
  const [lineas, setLineas] = useState<LineaEnEdicion[]>([]);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");

  const totales = useMemo(() => calcularVenta(lineas), [lineas]);
  const moneda = productos[0]?.moneda ?? "PYG";

  function agregar(producto: Producto) {
    setLineas((actual) => {
      // Sumar cantidad en vez de repetir la línea: es lo que espera quien está
      // cargando una venta con el cliente enfrente.
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
          precio_unitario: producto.precio_venta,
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
      const respuesta = await fetch("/api/erp/ventas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contacto_id: contactoId || null,
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
      if (!respuesta.ok) throw new Error(resultado?.error || "No se pudo registrar la venta.");

      setLineas([]);
      setContactoId("");
      setAbierto(false);
      onCambio();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo registrar la venta.");
    } finally {
      setGuardando(false);
    }
  }

  async function cobrar(venta: Venta) {
    try {
      const respuesta = await fetch(`/api/erp/ventas/${venta.id}/cobrar`, { method: "POST" });
      if (respuesta.ok) onCambio();
    } catch (err) {
      console.error("No se pudo cobrar la venta:", err);
    }
  }

  return (
    <>
      <div className="card">
        <div className="card-title">Cargar una venta</div>

        {productos.length === 0 ? (
          <p className="empty-note">
            Primero cargá al menos un producto o servicio en la pestaña Productos.
          </p>
        ) : !abierto ? (
          <button type="button" className="reco-btn" onClick={() => setAbierto(true)}>
            <Plus size={13} style={{ display: "inline", marginRight: 4, verticalAlign: -2 }} />
            Nueva venta
          </button>
        ) : (
          <>
            <div className="field-row">
              <span className="field-label">Cliente</span>
              <select
                className="neg-input"
                value={contactoId}
                onChange={(e) => setContactoId(e.target.value)}
              >
                <option value="">Consumidor final</option>
                {contactos
                  .filter((c) => c.es_cliente)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nombre}
                    </option>
                  ))}
              </select>
            </div>

            <div className="field-row">
              <span className="field-label">
                Condición
                <span className="field-hint">
                  A crédito la plata no entra al panel hasta que la cobres
                </span>
              </span>
              <select
                className="neg-input"
                value={condicion}
                onChange={(e) => setCondicion(e.target.value === "credito" ? "credito" : "contado")}
              >
                <option value="contado">Contado</option>
                <option value="credito">Crédito</option>
              </select>
            </div>

            <div className="neg-catalogo">
              {productos.map((p) => (
                <button key={p.id} type="button" className="neg-chip" onClick={() => agregar(p)}>
                  {p.nombre}
                  <span>{formatearMonto(p.precio_venta, p.moneda)}</span>
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
                {guardando ? "Registrando…" : "Registrar venta"}
              </button>
              <button type="button" className="chip" onClick={() => setAbierto(false)}>
                Cancelar
              </button>
            </div>
          </>
        )}
      </div>

      <div className="card">
        <div className="card-title">Últimas ventas</div>

        {ventas.length === 0 ? (
          <p className="empty-note">Todavía no cargaste ninguna venta.</p>
        ) : (
          <div className="neg-lista">
            {ventas.map((v) => (
              <div className="neg-fila" key={v.id}>
                <div className="neg-fila-texto">
                  <strong>{v.contacto?.nombre ?? "Consumidor final"}</strong>
                  <small>
                    {v.fecha} · {v.items?.length ?? 0}{" "}
                    {(v.items?.length ?? 0) === 1 ? "ítem" : "ítems"} ·{" "}
                    {v.condicion === "credito" ? "a crédito" : "contado"}
                  </small>
                </div>

                <span className="neg-fila-monto">{formatearMonto(v.total, v.moneda)}</span>

                {v.movimiento_id ? (
                  <span className="neg-estado is-ok">
                    <Check size={12} /> cobrada
                  </span>
                ) : (
                  <button type="button" className="chip" onClick={() => cobrar(v)}>
                    Cobrar
                  </button>
                )}

                <Facturar ventaId={v.id} />

                {/* Anular va al final: se lee después de las acciones normales. */}
                <Anular recurso="ventas" id={v.id} onAnulado={onCambio} />
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

/**
 * Emitir el comprobante de una venta.
 *
 * Dice "comprobante" y no "factura" mientras el documento no esté aprobado por
 * SIFEN. La diferencia no es de vocabulario: llamar factura a un borrador mete
 * al usuario en un problema con la SET, y el que aprieta el botón confía en que
 * el sistema no le mienta sobre eso.
 */
function Facturar({ ventaId }: { ventaId: string }) {
  const [estado, setEstado] = useState<"listo" | "emitiendo" | "hecho" | "sin-modulo" | "error">(
    "listo",
  );
  const [url, setUrl] = useState("");
  const [mensaje, setMensaje] = useState("");

  async function emitir() {
    setEstado("emitiendo");

    try {
      const respuesta = await fetch("/api/facturacion/emitir", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ venta_id: ventaId }),
      });

      if (respuesta.status === 403) {
        setEstado("sin-modulo");
        return;
      }

      const resultado = await respuesta.json().catch(() => null);

      if (!respuesta.ok) {
        setMensaje(resultado?.error || "No se pudo emitir el comprobante.");
        setEstado("error");
        return;
      }

      setUrl(resultado?.comprobante_url ?? "");
      setMensaje(resultado?.numero ?? "");
      setEstado("hecho");
    } catch (err) {
      console.error("No se pudo emitir el comprobante:", err);
      setEstado("error");
    }
  }

  if (estado === "sin-modulo") return <span className="neg-estado">sin facturación</span>;

  if (estado === "hecho") {
    return url ? (
      <a className="chip" href={url} rel="noopener noreferrer">
        {mensaje || "Comprobante"}
      </a>
    ) : (
      <span className="neg-estado is-ok">{mensaje}</span>
    );
  }

  if (estado === "error") return <span className="neg-estado is-mal">{mensaje}</span>;

  return (
    <button type="button" className="chip" disabled={estado === "emitiendo"} onClick={emitir}>
      <Receipt size={12} style={{ display: "inline", marginRight: 4, verticalAlign: -2 }} />
      {estado === "emitiendo" ? "Emitiendo…" : "Comprobante"}
    </button>
  );
}

/* ============================================================
   PRODUCTOS
   ============================================================ */

function Productos({ productos, onCambio }: { productos: Producto[]; onCambio: () => void }) {
  const [nombre, setNombre] = useState("");
  const [precio, setPrecio] = useState("");
  const [iva, setIva] = useState<TasaIva>(10);
  const [controlaStock, setControlaStock] = useState(false);
  const [stock, setStock] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");

  async function guardar() {
    if (!nombre.trim() || guardando) return;

    setGuardando(true);
    setError("");

    try {
      const respuesta = await fetch("/api/erp/productos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nombre,
          precio_venta: Number(precio) || 0,
          iva,
          controla_stock: controlaStock,
          stock_actual: Number(stock) || 0,
        }),
      });

      const resultado = await respuesta.json().catch(() => null);
      if (!respuesta.ok) throw new Error(resultado?.error || "No se pudo guardar.");

      setNombre("");
      setPrecio("");
      setStock("");
      onCambio();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar.");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <>
      <div className="card">
        <div className="card-title">Nuevo producto o servicio</div>
        <div className="card-sub">El precio va como se lo decís al cliente: con IVA adentro.</div>

        <div className="neg-form">
          <input
            className="neg-input"
            placeholder="Nombre"
            value={nombre}
            maxLength={200}
            onChange={(e) => setNombre(e.target.value)}
          />
          <input
            className="neg-input"
            placeholder="Precio final"
            inputMode="numeric"
            value={precio}
            onChange={(e) => setPrecio(e.target.value.replace(/[^\d]/g, ""))}
          />
          <select
            className="neg-input"
            value={iva}
            onChange={(e) => setIva(tasaValida(Number(e.target.value)))}
          >
            <option value={10}>IVA 10%</option>
            <option value={5}>IVA 5%</option>
            <option value={0}>Exenta</option>
          </select>
          <label className="neg-check">
            <input
              type="checkbox"
              checked={controlaStock}
              onChange={(e) => setControlaStock(e.target.checked)}
            />
            Llevar stock
          </label>
          {controlaStock && (
            <input
              className="neg-input"
              placeholder="Stock inicial"
              inputMode="numeric"
              value={stock}
              onChange={(e) => setStock(e.target.value.replace(/[^\d]/g, ""))}
            />
          )}
        </div>

        {error && <p className="neg-error">{error}</p>}

        <button type="button" className="reco-btn" disabled={guardando} onClick={guardar}>
          {guardando ? "Guardando…" : "Agregar"}
        </button>
      </div>

      <div className="card">
        <div className="card-title">Tu catálogo</div>

        {productos.length === 0 ? (
          <p className="empty-note">Todavía no cargaste productos.</p>
        ) : (
          <div className="neg-lista">
            {productos.map((p) => (
              <FilaProducto key={p.id} producto={p} onCambio={onCambio} />
            ))}
          </div>
        )}
      </div>
    </>
  );
}

/* ============================================================
   CLIENTES
   ============================================================ */

function Clientes({ contactos, onCambio }: { contactos: Contacto[]; onCambio: () => void }) {
  const [nombre, setNombre] = useState("");
  const [ruc, setRuc] = useState("");
  const [rucDv, setRucDv] = useState("");
  const [telefono, setTelefono] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");

  async function guardar() {
    if (!nombre.trim() || guardando) return;

    setGuardando(true);
    setError("");

    try {
      const respuesta = await fetch("/api/erp/contactos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nombre,
          ruc: ruc || null,
          ruc_dv: rucDv === "" ? undefined : Number(rucDv),
          telefono: telefono || null,
        }),
      });

      const resultado = await respuesta.json().catch(() => null);
      if (!respuesta.ok) throw new Error(resultado?.error || "No se pudo guardar.");

      setNombre("");
      setRuc("");
      setRucDv("");
      setTelefono("");
      onCambio();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar.");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <>
      <div className="card">
        <div className="card-title">Nuevo cliente</div>
        <div className="card-sub">
          El RUC se valida al guardarlo: un dígito mal no se descubre hasta que la factura se
          rechaza, y para entonces el cliente ya se llevó el comprobante.
        </div>

        <div className="neg-form">
          <input
            className="neg-input"
            placeholder="Nombre o razón social"
            value={nombre}
            maxLength={160}
            onChange={(e) => setNombre(e.target.value)}
          />
          <input
            className="neg-input"
            placeholder="RUC (opcional)"
            inputMode="numeric"
            value={ruc}
            onChange={(e) => setRuc(e.target.value.replace(/[^\d]/g, ""))}
          />
          <input
            className="neg-input neg-cantidad"
            placeholder="DV"
            inputMode="numeric"
            maxLength={1}
            value={rucDv}
            onChange={(e) => setRucDv(e.target.value.replace(/[^\d]/g, ""))}
          />
          <input
            className="neg-input"
            placeholder="Teléfono"
            value={telefono}
            onChange={(e) => setTelefono(e.target.value)}
          />
        </div>

        {error && <p className="neg-error">{error}</p>}

        <button type="button" className="reco-btn" disabled={guardando} onClick={guardar}>
          {guardando ? "Guardando…" : "Agregar"}
        </button>
      </div>

      <div className="card">
        <div className="card-title">Tu gente</div>

        {contactos.length === 0 ? (
          <p className="empty-note">Todavía no cargaste clientes.</p>
        ) : (
          <div className="neg-lista">
            {contactos.map((c) => (
              <FilaContacto key={c.id} contacto={c} onCambio={onCambio} />
            ))}
          </div>
        )}
      </div>
    </>
  );
}
