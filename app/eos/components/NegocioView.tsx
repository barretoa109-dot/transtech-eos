"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, BadgeDollarSign, Check, Handshake, MoreHorizontal, Package, Pencil, Plus, ShoppingCart, Undo2 } from "lucide-react";
import { formatearMonto } from "@/lib/finanzas/formato";
import { useEscape } from "./useEscape";
import { calcularVenta, tasaValida, type LineaVenta, type TasaIva } from "@/lib/erp/impuestos";
import { avisoMonedasMezcladas, monedaDelDocumento } from "@/lib/erp/moneda-documento";
import { calcularMargen, textoMargen } from "@/lib/erp/margen";
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
import type { Contacto, Producto } from "./negocio/tipos";

/**
 * El ERP de EOS.
 *
 * ============================================================
 * ACÁ YA NO VIVE EL CRM
 * ============================================================
 *
 * Hasta esta reorganización, esta misma pantalla se llamaba "Tu ERP y tu
 * CRM" y tenía Contactos y el embudo de oportunidades como dos pestañas más,
 * bajo un grupo "Relaciones". Eso mezclaba dos productos que la base y el
 * motor de indicadores ya trataban por separado (`eos_erp_*` vs `eos_crm_*`,
 * familias de KPI separadas, y hasta el módulo que se factura es distinto)
 * en una sola pantalla y un solo título confuso. El CRM ahora es su propia
 * sección (`CRMView.tsx`, accesible con `onOpenCRM`); acá quedan solo las
 * operaciones del negocio: vender, comprar, cobrar, pagar, el catálogo y el
 * stock.
 *
 * `contactos` se sigue trayendo acá porque Ventas y Compras necesitan elegir
 * un cliente o proveedor — es dato compartido, no CRM en esta pantalla.
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
  producto_id: string | null;
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
  | "emisor";

/*
 * El orden es el del día de trabajo, no el del organigrama: primero lo que
 * entra, después lo que sale, después el catálogo, y al final lo que se mira
 * de vez en cuando.
 *
 * Las tres primeras viven en este archivo porque comparten el estado de la
 * carga; las demás son pantallas propias en `./negocio`, que es lo que
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
  { clave: "emisor", etiqueta: "Facturación", detalle: "Datos del emisor" },
];

/*
 * Ocho pestañas en una sola grilla ya se leen como un menú largo. Agruparlas
 * no cambia ninguna pestaña, ni el estado, ni qué pantalla se renderiza con
 * cada `clave` — solo cómo se presenta la misma lista.
 */
const GRUPOS_NAV: { etiqueta: string; claves: Pestania[] }[] = [
  { etiqueta: "Operar", claves: ["ventas", "compras", "cartera"] },
  { etiqueta: "Catálogo", claves: ["productos", "inventario"] },
  { etiqueta: "Analizar", claves: ["pronostico", "resultado", "rentabilidad"] },
  { etiqueta: "Configurar", claves: ["emisor"] },
];

type NegocioViewProps = {
  /** Abre el chat completo — ver la misma nota en GastosView. */
  onOpenChat?: () => void;
  /** Lleva a la sección de CRM — ver el comentario de cabecera del archivo. */
  onOpenCRM?: () => void;
};

export default function NegocioView({ onOpenChat, onOpenCRM }: NegocioViewProps) {
  const [pestania, setPestania] = useState<Pestania>("ventas");
  const [contactos, setContactos] = useState<Contacto[]>([]);
  const [productos, setProductos] = useState<Producto[]>([]);
  const [ventas, setVentas] = useState<Venta[]>([]);
  const [sinModulo, setSinModulo] = useState(false);
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
        //
        // Esta pantalla ya es ERP puro (ver el comentario de cabecera): sin
        // productos o sin ventas es directamente "sin ERP", sin un estado
        // intermedio para cuando solo tiene CRM — ese caso ahora vive en
        // `CRMView.tsx`, que tiene su propia puerta.
        const sinErp = respuestas[1].status === 403 || respuestas[2].status === 403;
        if (sinErp) {
          setSinModulo(true);
          return;
        }

        if (respuestas.some((r) => !r.ok)) {
          throw new Error("BUSINESS_UNAVAILABLE");
        }

        const [contactosData, productosData, ventasData] = await Promise.all(
          respuestas.map((r) => r.json().catch(() => null)),
        );

        setSinModulo(false);
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
            <div className="page-title">Tu ERP, adentro de EOS</div>
            <div className="page-sub">
              Ventas, compras, inventario y facturación conectados a tu panel financiero.
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
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
          <div className="page-header">
            <div className="page-eyebrow">Negocio</div>
            <div className="page-title">Tu ERP</div>
            <div className="page-sub">
              Ventas, compras, inventario y facturación en un solo lugar.
            </div>
          </div>
          {onOpenChat && (
            <button type="button" className="ghost-btn" onClick={onOpenChat} style={{ flexShrink: 0 }}>
              Preguntale a EOS
            </button>
          )}
        </div>

        {!cargando && !error && (
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
            {onOpenCRM && (
              <button type="button" className="neg-resumen-card is-primary" onClick={onOpenCRM}>
                <Handshake size={17} />
                <span>CRM</span>
                <strong>{resumen.contactos} contactos</strong>
                <small>Oportunidades y seguimiento</small>
              </button>
            )}
            <button type="button" className="neg-resumen-card" onClick={() => setPestania("rentabilidad")}>
              <BadgeDollarSign size={17} />
              <span>Rentabilidad</span>
              <strong>Ver márgenes</strong>
              <small>Ganancia por producto</small>
            </button>
          </div>
        )}

        <div className="neg-nav-groups" role="navigation" aria-label="Áreas del negocio">
          {GRUPOS_NAV.map((grupo) => {
            const disponibles = grupo.claves.map((clave) => PESTANIAS.find((p) => p.clave === clave)!);

            return (
              <div className="neg-nav-group" key={grupo.etiqueta}>
                <div className="neg-nav-group-label">{grupo.etiqueta}</div>
                <div className="neg-nav">
                  {disponibles.map((p) => (
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
                </div>
              </div>
            );
          })}
        </div>

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
        ) : (
          <Emisor />
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

  /*
   * Editar no es un formulario aparte: es este mismo, precargado.
   *
   * `editandoId` distingue las dos cosas que puede hacer "Registrar/Guardar":
   * null es una venta nueva; con id, el servidor anula la vieja y registra
   * esta como nueva por dentro (`eos_erp_editar_venta`, v116) — pero para
   * quien está mirando la pantalla es "corregí esta venta", no "hice dos".
   */
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [motivoEdicion, setMotivoEdicion] = useState("");

  const totales = useMemo(() => calcularVenta(lineas), [lineas]);

  /*
   * Lo que ya se vendió de más.
   *
   * El stock negativo no está bloqueado en ningún lado —ver el comentario en
   * la migración v69 y en app/api/erp/ventas/route.ts— pero hasta acá vivía
   * escondido: solo se veía como un número raro en el catálogo o el
   * inventario, sin decir "esto es un sobrepedido" en ningún lado. Quien
   * trabaja así necesita verlo junto a donde carga la venta, no adivinarlo.
   */
  const sobrepedidos = useMemo(
    () =>
      productos
        .filter((p) => p.controla_stock && p.stock_actual < 0)
        .sort((a, b) => a.stock_actual - b.stock_actual),
    [productos],
  );

  /*
   * Lo anulado sale de la lista, no se tacha.
   *
   * Ver el comentario en la tarjeta de ventas: se esconde en vez de borrarse
   * porque una venta anulada sigue siendo parte del registro contable, pero
   * dejarla ocupando un renglón tachado obliga a leer dos veces cada línea
   * para saber cuál cuenta.
   */
  const [verAnuladas, setVerAnuladas] = useState(false);

  /*
   * Cada fila de venta llegó a tener cinco acciones a la vez: corregir el
   * costo, corregir la venta, cobrar, facturar y anular. Cobrar y Anular son
   * las que alguien busca en el 90% de las filas; Corregir costo y Corregir
   * son para cuando algo se cargó mal, que no es lo normal. Se esconden
   * detrás de "Más" en vez de sacarlas — la función sigue entera, a un clic
   * de distancia en vez de compitiendo por atención en cada fila.
   */
  const [masAbiertoId, setMasAbiertoId] = useState<string | null>(null);
  useEscape(masAbiertoId !== null, () => setMasAbiertoId(null));

  const anuladas = useMemo(() => ventas.filter((v) => v.estado === "anulada"), [ventas]);

  const ventasVisibles = useMemo(
    () => (verAnuladas ? ventas : ventas.filter((v) => v.estado !== "anulada")),
    [ventas, verAnuladas],
  );

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

  function cerrarFormulario() {
    setLineas([]);
    setContactoId("");
    setEditandoId(null);
    setMotivoEdicion("");
    setAbierto(false);
    setError("");
  }

  /** Precarga el formulario con una venta existente, en vez de uno vacío. */
  function editar(venta: Venta) {
    setLineas(
      [...venta.items]
        .sort((a, b) => a.orden - b.orden)
        .map((item) => ({
          producto_id: item.producto_id,
          descripcion: item.descripcion,
          cantidad: item.cantidad,
          precio_unitario: item.precio_unitario,
          iva: tasaValida(item.iva),
        })),
    );
    setContactoId(venta.contacto?.id ?? "");
    setCondicion(venta.condicion === "credito" ? "credito" : "contado");
    setEditandoId(venta.id);
    setMotivoEdicion("");
    setError("");
    setAbierto(true);
  }

  async function registrar() {
    if (lineas.length === 0 || guardando) return;

    // La base lo rechaza igual (trigger v93), pero enterarse acá evita perder
    // la carga entera contra un error que ya se podía ver.
    if (!monedaDocumento.ok) {
      setError(avisoMonedasMezcladas(monedaDocumento.monedas));
      return;
    }

    if (editandoId && motivoEdicion.trim().length < 3) {
      setError("Escribí brevemente qué corregiste.");
      return;
    }

    setGuardando(true);
    setError("");

    try {
      const items = lineas.map((l) => ({
        producto_id: l.producto_id,
        descripcion: l.descripcion,
        cantidad: l.cantidad,
        precio_unitario: l.precio_unitario,
        iva: l.iva,
      }));

      const respuesta = editandoId
        ? await fetch(`/api/erp/ventas/${editandoId}/editar`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contacto_id: contactoId || null,
              condicion,
              moneda,
              items,
              motivo: motivoEdicion.trim(),
            }),
          })
        : await fetch("/api/erp/ventas", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ contacto_id: contactoId || null, condicion, moneda, items }),
          });

      const resultado = await respuesta.json().catch(() => null);
      if (!respuesta.ok) {
        throw new Error(
          resultado?.error || (editandoId ? "No se pudo editar la venta." : "No se pudo registrar la venta."),
        );
      }

      cerrarFormulario();
      onCambio();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : editandoId ? "No se pudo editar la venta." : "No se pudo registrar la venta.",
      );
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
        <div className="card-title">{editandoId ? "Corregir venta" : "Cargar una venta"}</div>

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
                    <span className="neg-linea-nombre"><small>Producto</small>{l.descripcion}</span>
                    <label className="neg-linea-control"><small>Cantidad</small>
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
                    /></label>
                    {/*
                      El precio de catálogo es el punto de partida, no el
                      final: un descuento en el mostrador es normal y el
                      servidor ya lo acepta (ver el comentario en
                      app/api/erp/ventas/route.ts). Sin este campo, cambiarlo
                      obligaba a editar el producto del catálogo antes de
                      vender y volver a editarlo después.
                    */}
                    <label className="neg-linea-control"><small>Precio unitario</small>
                    <input
                      className="neg-input neg-cantidad"
                      inputMode="numeric"
                      placeholder="Precio"
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
                    /></label>
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

            {editandoId && (
              <input
                className="neg-input"
                placeholder="¿Qué corregiste? (obligatorio)"
                value={motivoEdicion}
                maxLength={500}
                onChange={(e) => {
                  setMotivoEdicion(e.target.value);
                  if (error) setError("");
                }}
              />
            )}

            {error && <p className="neg-error" role="alert">{error}</p>}

            <div className="chip-row" style={{ marginTop: 12 }}>
              <button
                type="button"
                className="reco-btn"
                disabled={lineas.length === 0 || guardando || mezclaMonedas}
                onClick={registrar}
              >
                {guardando ? "Guardando…" : editandoId ? "Guardar cambios" : "Registrar venta"}
              </button>
              <button type="button" className="chip" onClick={cerrarFormulario}>
                Cancelar
              </button>
            </div>
          </>
        )}
      </div>

      {/*
        Solo aparece si hay algo que mostrar: para quien nunca vende de más,
        una tarjeta vacía todo el tiempo es ruido, no información.
      */}
      {sobrepedidos.length > 0 && (
        <div className="card">
          <div className="card-title">Sobrepedidos</div>
          <div className="neg-lista">
            {sobrepedidos.map((p) => (
              <div className="neg-fila" key={p.id}>
                <div className="neg-fila-texto">
                  <strong>{p.nombre}</strong>
                  <small>El sistema dice {p.stock_actual}</small>
                </div>
                <span className="neg-estado is-mal">
                  <AlertTriangle size={12} /> {Math.abs(p.stock_actual)} de sobrepedido
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card">
        <div className="card-title">
          Últimas ventas
          {/*
            Lo anulado NO se queda en la lista.

            Antes se mostraba tachado, y el pedido fue explícito: cuando alguien
            elimina algo tiene que desaparecer de la pantalla, no quedar con una
            raya encima. Una lista donde lo borrado sigue ocupando lugar obliga
            a leer dos veces cada renglón para saber cuál cuenta.

            Pero no se borra del registro: una venta anulada es parte de la
            contabilidad y de lo que después mira un contador. Por eso se
            esconde y se puede volver a mirar en un clic, en vez de tacharse.
          */}
          {anuladas.length > 0 && (
            <button
              type="button"
              className="chip"
              style={{ marginLeft: 8 }}
              onClick={() => setVerAnuladas((v) => !v)}
            >
              {verAnuladas
                ? "Ocultar anuladas"
                : `Ver ${anuladas.length} ${anuladas.length === 1 ? "anulada" : "anuladas"}`}
            </button>
          )}
        </div>

        {ventasVisibles.length === 0 ? (
          <p className="empty-note">
            {ventas.length === 0
              ? "Todavía no cargaste ninguna venta."
              : "Todas tus ventas de este período están anuladas."}
          </p>
        ) : (
          <div className="neg-lista">
            {ventasVisibles.map((v) => {
              /*
               * Una venta anulada tiene que VERSE anulada. Ver el comentario
               * largo en `negocio/Compras.tsx`: es el mismo error, reportado
               * por una clienta usando EOS de verdad. Anular borra el
               * movimiento, así que la fila volvía a ofrecer "Cobrar" y
               * "Anular" y parecía que el botón no había hecho nada.
               *
               * Acá solo se ve cuando la persona pidió ver las anuladas: en la
               * lista normal ya no aparecen.
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
                      <button
                        type="button"
                        className="chip"
                        aria-expanded={masAbiertoId === v.id}
                        aria-label="Más acciones"
                        onClick={() => setMasAbiertoId((actual) => (actual === v.id ? null : v.id))}
                      >
                        <MoreHorizontal size={13} />
                      </button>

                      {masAbiertoId === v.id && (
                        <>
                          {/*
                            Corregir el costo se ofrece en la venta y no sólo
                            en el producto, porque el costo de una venta ya
                            hecha quedó congelado: arreglar la ficha no
                            arregla el margen de lo que ya se vendió.
                          */}
                          <CorregirCosto
                            modo="venta"
                            documentoId={v.id}
                            moneda={v.moneda}
                            items={v.items ?? []}
                            onCorregido={onCambio}
                          />

                          {/*
                            Cantidad, precio, producto — lo que "Corregir
                            costo" no toca. Si la venta tiene una factura
                            activa, el servidor lo rechaza con el mismo
                            mensaje que ya usa Anular: no hace falta duplicar
                            ese chequeo acá.
                          */}
                          <button type="button" className="chip" onClick={() => editar(v)}>
                            <Pencil size={11} style={{ display: "inline", marginRight: 3, verticalAlign: -1 }} />
                            Corregir
                          </button>
                        </>
                      )}

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

        {error && <p className="neg-error" role="alert">{error}</p>}

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
