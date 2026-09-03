"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, BadgeDollarSign, Check, Package, Plus, ShoppingCart, TrendingUp, Undo2, Users } from "lucide-react";
import { formatearMonto } from "@/lib/finanzas/formato";
import { calcularVenta, tasaValida, type LineaVenta, type TasaIva } from "@/lib/erp/impuestos";
import { avisoMonedasMezcladas, monedaDelDocumento } from "@/lib/erp/moneda-documento";
import { calcularMargen, textoMargen } from "@/lib/erp/margen";
import Embudo from "./negocio/Embudo";
import Compras from "./negocio/Compras";
import Cartera from "./negocio/Cartera";
import Pronostico from "./negocio/Pronostico";
import Inventario from "./negocio/Inventario";
import ResultadoView from "./negocio/Resultado";
import Rentabilidad from "./negocio/Rentabilidad";
import Emisor from "./negocio/Emisor";
import Confirmar from "./negocio/Confirmar";
import Anular from "./negocio/Anular";
import FilaProducto from "./negocio/FilaProducto";
import CorregirCosto from "./negocio/CorregirCosto";
import ImportarProductos from "./negocio/ImportarProductos";
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
  /** El costo congelado al venderse. Null cuando no se sabía. */
  costo_unitario: number | null;
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

/**
 * Qué se vendió, para el renglón de la lista.
 *
 * Antes el renglón encabezaba con el cliente, y en un comercio que vende al
 * mostrador eso son cuatro filas seguidas que dicen "Consumidor final" y no
 * distinguen una venta de otra. Lo pidió una clienta usando EOS de verdad, y
 * tiene razón: lo que identifica una venta es lo que salió del estante.
 *
 * El cliente no se pierde, baja a la segunda línea — donde importa cuando
 * existe y no estorba cuando no.
 */
function loVendido(items: VentaItem[] | undefined): string {
  if (!items || items.length === 0) return "Venta sin detalle";

  const [primero, ...resto] = [...items].sort((a, b) => a.orden - b.orden);
  const cantidad = Number(primero.cantidad);

  // Diez unidades se dicen "10", no "10,00": el ruido decimal en una lista
  // que se lee de un vistazo cuesta más de lo que aporta.
  const veces = Number.isInteger(cantidad)
    ? String(cantidad)
    : String(cantidad).replace(".", ",");

  const cabeza = cantidad === 1 ? primero.descripcion : `${veces} × ${primero.descripcion}`;

  return resto.length === 0 ? cabeza : `${cabeza} y ${resto.length} más`;
}

type Pestania =
  | "ventas"
  | "compras"
  | "cartera"
  | "pronostico"
  | "resultado"
  | "rentabilidad"
  | "productos"
  | "inventario"
  | "clientes"
  | "embudo"
  | "emisor";

/*
 * El orden es el del día de trabajo, no el del organigrama: primero lo que
 * entra, después lo que sale, después el catálogo y la gente, y al final lo
 * que se mira de vez en cuando.
 *
 * Las tres primeras viven en este archivo porque comparten el estado de la
 * carga; las tres últimas son pantallas propias en `./negocio`, que es lo que
 * mantiene este archivo legible.
 */
const PESTANIAS: { clave: Pestania; etiqueta: string; detalle: string }[] = [
  { clave: "ventas", etiqueta: "Ventas", detalle: "Ingresos y cobros" },
  { clave: "compras", etiqueta: "Compras", detalle: "Gastos y proveedores" },
  { clave: "cartera", etiqueta: "Cartera", detalle: "Lo que te deben y lo que debés" },
  { clave: "pronostico", etiqueta: "Pronóstico", detalle: "La caja de los próximos 90 días" },
  { clave: "resultado", etiqueta: "Resultado", detalle: "Qué quedó y con qué contás" },
  { clave: "rentabilidad", etiqueta: "Rentabilidad", detalle: "Márgenes y crecimiento" },
  { clave: "productos", etiqueta: "Productos", detalle: "Catálogo y stock" },
  { clave: "inventario", etiqueta: "Inventario", detalle: "Valor, rotación y stock quieto" },
  { clave: "clientes", etiqueta: "Contactos", detalle: "Clientes y proveedores" },
  { clave: "embudo", etiqueta: "CRM", detalle: "Oportunidades y tareas" },
  { clave: "emisor", etiqueta: "Facturación", detalle: "Datos del emisor" },
];

export default function NegocioView() {
  const [pestania, setPestania] = useState<Pestania>("ventas");
  const [contactos, setContactos] = useState<Contacto[]>([]);
  const [productos, setProductos] = useState<Producto[]>([]);
  const [ventas, setVentas] = useState<Venta[]>([]);
  const [sinModulo, setSinModulo] = useState(false);
  const [sinErp, setSinErp] = useState(false);
  const [error, setError] = useState("");
  const [cargando, setCargando] = useState(true);

  const resumen = useMemo(() => {
    const porCobrar = ventas.filter((venta) => !venta.movimiento_id);
    const bajoMinimo = productos.filter((producto) => producto.bajo_minimo);

    return {
      ventas: ventas.length,
      porCobrar: porCobrar.length,
      productos: productos.length,
      bajoMinimo: bajoMinimo.length,
      contactos: contactos.length,
    };
  }, [contactos, productos, ventas]);

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
        if (respuestas.some((r) => r.status === 401)) {
          throw new Error("SESSION_EXPIRED");
        }

        // 403 es "no contrataste el módulo", y eso no es un error: es una
        // invitación. Mostrar "algo salió mal" ahí sería mentirle al usuario
        // sobre por qué no ve nada.
        if (respuestas.every((r) => r.status === 403)) {
          setSinModulo(true);
          return;
        }

        const erpNoActivo = respuestas[1].status === 403 || respuestas[2].status === 403;
        if (erpNoActivo) {
          const contactosData = respuestas[0].ok
            ? await respuestas[0].json().catch(() => null)
            : null;
          setContactos(contactosData?.contactos ?? []);
          setProductos([]);
          setVentas([]);
          setSinModulo(false);
          setSinErp(true);
          setError("");
          setPestania("embudo");
          return;
        }

        if (respuestas.some((r) => !r.ok)) {
          throw new Error("BUSINESS_UNAVAILABLE");
        }

        const [contactosData, productosData, ventasData] = await Promise.all(
          respuestas.map((r) => r.json().catch(() => null)),
        );

        setSinModulo(false);
        setSinErp(false);
        setError("");
        setContactos(contactosData?.contactos ?? []);
        setProductos(productosData?.productos ?? []);
        setVentas(ventasData?.ventas ?? []);
      })
      .catch((err) => {
        console.error("No se pudo cargar el negocio:", err);
        setError(
          err instanceof Error && err.message === "SESSION_EXPIRED"
            ? "Tu sesión venció. Volvé a iniciar sesión para cargar los datos reales de tu negocio."
            : "No pudimos cargar los datos de tu negocio. No los mostramos como vacíos porque podrían existir: reintentá la carga.",
        );
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
            Operaciones, inventario y relaciones comerciales en un solo lugar.
          </div>
        </div>

        {!cargando && !error && !sinErp && (
          <div className="neg-resumen" aria-label="Resumen operativo del negocio">
            <button type="button" className="neg-resumen-card" onClick={() => setPestania("ventas")}>
              <ShoppingCart size={17} />
              <span>Ventas</span>
              <strong>{resumen.ventas}</strong>
              <small>{resumen.porCobrar ? `${resumen.porCobrar} por cobrar` : "Cobros al día"}</small>
            </button>
            <button type="button" className="neg-resumen-card" onClick={() => setPestania("productos")}>
              <Package size={17} />
              <span>Productos</span>
              <strong>{resumen.productos}</strong>
              <small className={resumen.bajoMinimo ? "is-alert" : ""}>
                {resumen.bajoMinimo ? `${resumen.bajoMinimo} con stock bajo` : "Stock controlado"}
              </small>
            </button>
            <button type="button" className="neg-resumen-card" onClick={() => setPestania("clientes")}>
              <Users size={17} />
              <span>Contactos</span>
              <strong>{resumen.contactos}</strong>
              <small>Clientes y proveedores</small>
            </button>
            <button type="button" className="neg-resumen-card is-primary" onClick={() => setPestania("embudo")}>
              <TrendingUp size={17} />
              <span>CRM</span>
              <strong>Ver embudo</strong>
              <small>Oportunidades y seguimiento</small>
            </button>
            <button type="button" className="neg-resumen-card" onClick={() => setPestania("rentabilidad")}>
              <BadgeDollarSign size={17} />
              <span>Rentabilidad</span>
              <strong>Ver márgenes</strong>
              <small>Ganancia por producto</small>
            </button>
          </div>
        )}

        <nav className="neg-nav" aria-label="Áreas del negocio">
          {PESTANIAS.filter((p) => !sinErp || p.clave === "clientes" || p.clave === "embudo").map((p) => (
            <button
              key={p.clave}
              type="button"
              className={`neg-nav-item ${pestania === p.clave ? "active" : ""}`}
              onClick={() => setPestania(p.clave)}
              aria-current={pestania === p.clave ? "page" : undefined}
            >
              <span>{p.etiqueta}</span>
              <small>{p.detalle}</small>
            </button>
          ))}
        </nav>

        {sinErp && !cargando && (
          <div className="neg-module-note">
            <div>
              <strong>Tu CRM está activo</strong>
              <p>Podés gestionar contactos, oportunidades y seguimientos. Activá ERP cuando quieras sumar productos, ventas y compras.</p>
            </div>
            <a className="chip" href="/planes">Ver ERP</a>
          </div>
        )}

        {error && (
          <div className="neg-load-error" role="alert">
            <AlertTriangle size={18} />
            <div>
              <strong>No mostramos ceros si no pudimos verificar los datos</strong>
              <p>{error}</p>
              <button type="button" className="chip" onClick={() => { setError(""); setCargando(true); void cargar(); }}>
                Reintentar
              </button>
            </div>
          </div>
        )}

        {cargando ? (
          <p className="empty-note">Cargando tu negocio…</p>
        ) : error ? null : pestania === "ventas" ? (
          <Ventas
            ventas={ventas}
            contactos={contactos}
            productos={productos}
            onCambio={() => void cargar()}
          />
        ) : pestania === "compras" ? (
          <Compras
            contactos={contactos}
            productos={productos}
            onCambio={() => void cargar()}
          />
        ) : pestania === "cartera" ? (
          <Cartera onCambio={() => void cargar()} />
        ) : pestania === "pronostico" ? (
          <Pronostico />
        ) : pestania === "inventario" ? (
          <Inventario />
        ) : pestania === "resultado" ? (
          <ResultadoView />
        ) : pestania === "rentabilidad" ? (
          <Rentabilidad productos={productos} />
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

  // La moneda sale de los productos que están EN esta venta, no del primero
  // del catálogo. Ver `lib/erp/moneda-documento` y el trigger de la v93.
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

    // La base lo rechaza igual (trigger v93), pero enterarse acá evita perder
    // la carga entera contra un error que ya se podía ver.
    if (!monedaDocumento.ok) {
      setError(avisoMonedasMezcladas(monedaDocumento.monedas));
      return;
    }

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

            {error && <p className="neg-error">{error}</p>}

            <div className="chip-row" style={{ marginTop: 12 }}>
              <button
                type="button"
                className="reco-btn"
                disabled={lineas.length === 0 || guardando || mezclaMonedas}
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
            {ventas.map((v) => {
              /*
               * Una venta anulada tiene que VERSE anulada. Ver el comentario
               * largo en `negocio/Compras.tsx`: es el mismo error, reportado
               * por una clienta usando EOS de verdad. Anular borra el
               * movimiento, así que la fila volvía a ofrecer "Cobrar" y
               * "Anular" y parecía que el botón no había hecho nada.
               */
              const anulada = v.estado === "anulada";

              return (
                <div className={`neg-fila${anulada ? " neg-fila-anulada" : ""}`} key={v.id}>
                  <div className="neg-fila-texto">
                    <strong>{loVendido(v.items)}</strong>
                    <small>
                      {v.fecha} · {v.contacto?.nombre ?? "Consumidor final"} ·{" "}
                      {v.condicion === "credito" ? "a crédito" : "contado"}
                    </small>
                  </div>

                  <span className="neg-fila-monto">{formatearMonto(v.total, v.moneda)}</span>

                  {anulada ? (
                    <span className="neg-estado is-anulada">
                      <Undo2 size={12} /> anulada
                    </span>
                  ) : (
                    <>
                      {/*
                        Corregir el costo se ofrece en la venta y no sólo en el
                        producto, porque el costo de una venta ya hecha quedó
                        congelado: arreglar la ficha no arregla el margen de lo
                        que ya se vendió.
                      */}
                      <CorregirCosto
                        modo="venta"
                        documentoId={v.id}
                        moneda={v.moneda}
                        items={v.items ?? []}
                        onCorregido={onCambio}
                      />
                      {v.movimiento_id ? (
                        <span className="neg-estado is-ok">
                          <Check size={12} /> cobrada
                        </span>
                      ) : (
                        <Confirmar
                          etiqueta="Cobrar"
                          consecuencia={
                            `Se registra un ingreso de ${formatearMonto(v.total, v.moneda)} en tu panel, ` +
                            "con la fecha de hoy. Si te equivocaste de venta, se corrige anulándola."
                          }
                          confirmar="Sí, cobrar"
                          onConfirmar={() => void cobrar(v)}
                        />
                      )}

                      <Facturar ventaId={v.id} />

                      {/* Anular va al final: se lee después de las acciones normales. */}
                      <Anular recurso="ventas" id={v.id} onAnulado={onCambio} />
                    </>
                  )}
                </div>
              );
            })}
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

  /*
    Emitir quema un número correlativo. Ese número no se puede devolver: el
    siguiente comprobante saldrá con el que sigue, y el hueco queda. Por eso
    esta acción confirma aunque el papel todavía sea un borrador interno.
  */
  return (
    <Confirmar
      etiqueta="Comprobante"
      consecuencia={
        "Se emite el comprobante de esta venta y se usa el próximo número de tu " +
        "numeración, que no se puede devolver. Sale rotulado como borrador: todavía " +
        "no está firmado ni aprobado por la SET."
      }
      confirmar="Sí, emitir"
      onConfirmar={() => void emitir()}
      ocupado={estado === "emitiendo"}
      ocupadoTexto="Emitiendo…"
    />
  );
}

/* ============================================================
   PRODUCTOS
   ============================================================ */

function Productos({ productos, onCambio }: { productos: Producto[]; onCambio: () => void }) {
  const [nombre, setNombre] = useState("");
  const [precio, setPrecio] = useState("");
  const [costo, setCosto] = useState("");
  const [iva, setIva] = useState<TasaIva>(10);
  const [controlaStock, setControlaStock] = useState(false);
  const [stock, setStock] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");

  /*
   * El margen se calcula mientras escribe, no después.
   *
   * Es el único momento en que sirve: quien está poniendo el precio todavía
   * puede cambiarlo. Verlo recién en un informe, tres semanas más tarde, es
   * enterarse de que se estuvo vendiendo a pérdida.
   */
  const margen = calcularMargen({
    costo: costo.trim() === "" ? null : Number(costo),
    precio_venta: Number(precio) || 0,
    iva,
  });

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
          // Vacío es null, no cero: un costo en cero mostraría 100% de
          // margen en todo producto nuevo, que es un número precioso y falso.
          costo: costo.trim() === "" ? null : Number(costo),
          iva,
          controla_stock: controlaStock,
          stock_actual: Number(stock) || 0,
        }),
      });

      const resultado = await respuesta.json().catch(() => null);
      if (!respuesta.ok) throw new Error(resultado?.error || "No se pudo guardar.");

      setNombre("");
      setPrecio("");
      setCosto("");
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
        <div className="card-sub">El precio va como se lo decís al cliente: con IVA adentro. Si cargás el costo, EOS te dice el margen antes de guardar.</div>

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
          <input
            className="neg-input"
            placeholder="Costo (opcional)"
            inputMode="numeric"
            value={costo}
            onChange={(e) => setCosto(e.target.value.replace(/[^\d]/g, ""))}
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

        {Number(precio) > 0 && (
          <p className={`fila-margen${margen.conocido && margen.pierde ? " is-perdida" : ""}`}>
            {textoMargen(margen)}
            {margen.conocido && (
              <span className="fila-margen-detalle">
                {" · "}
                {margen.pierde ? "perdés" : "ganás"}{" "}
                {formatearMonto(Math.abs(margen.ganancia), "PYG")} por unidad
              </span>
            )}
          </p>
        )}

        {error && <p className="neg-error">{error}</p>}

        <button type="button" className="reco-btn" disabled={guardando} onClick={guardar}>
          {guardando ? "Guardando…" : "Agregar"}
        </button>
      </div>

      {/*
        Importar va ANTES del catálogo.

        Quien llega a esta pestaña por primera vez tiene su catálogo en una
        planilla, no en la cabeza. Ofrecerle cargar de a uno primero y la
        importación al final es hacerle empezar por el camino largo.
      */}
      <ImportarProductos onImportado={onCambio} />

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
