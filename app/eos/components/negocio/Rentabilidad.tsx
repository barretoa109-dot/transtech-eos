"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, BadgeDollarSign, CircleAlert, Info, RefreshCw, Target, TrendingDown, TrendingUp, Users } from "lucide-react";
import { formatearMonto } from "@/lib/finanzas/formato";
import { calcularMargen } from "@/lib/erp/margen";
import type { Indicadores } from "@/lib/erp/indicadores";
import type { ResumenRentabilidad } from "@/lib/erp/rentabilidad";
import type { Producto } from "./tipos";

/** Un decimal. Más dígitos en un porcentaje de negocio es precisión falsa. */
function pct(valor: number | null, signo = false): string {
  if (valor === null || !Number.isFinite(valor)) return "—";
  return `${signo && valor > 0 ? "+" : ""}${valor.toFixed(1)}%`;
}

function dia(iso: string): string {
  const [, mes, numero] = iso.split("-");
  return `${numero}/${mes}`;
}

/*
 * Una métrica que sabe decir que no sabe.
 *
 * Cuando el número no se puede calcular muestra un guion Y la razón, en vez
 * de un cero. Un cero se lee como "vendiste cero", que es una respuesta
 * distinta a "todavía no cargaste el costo".
 */
function Metrica({ titulo, valor, nota, tono }: {
  titulo: string;
  valor: string;
  nota?: string;
  tono?: "good" | "danger";
}) {
  return (
    <div className={`neg-metrica${tono ? ` is-${tono}` : ""}`}>
      <span>{titulo}</span>
      <strong title={valor}>{valor}</strong>
      {nota && <small className="neg-metrica-nota">{nota}</small>}
    </div>
  );
}

export default function Rentabilidad({ productos }: { productos: Producto[] }) {
  const [resumen, setResumen] = useState<ResumenRentabilidad[]>([]);
  const [indicadores, setIndicadores] = useState<Indicadores[]>([]);
  const [periodo, setPeriodo] = useState<{ desde: string; hasta: string } | null>(null);
  const [falta, setFalta] = useState<{ indicador: string; necesita: string }[]>([]);
  const [ventana, setVentana] = useState<"dia" | "semana" | "mes">("mes");
  const [cargando, setCargando] = useState(true);
  // Sólo la primera carga tapa la pantalla. Cambiar de período no puede
  // hacer desaparecer todo y volver: se ve como si se hubiera roto.
  const [nuncaCargo, setNuncaCargo] = useState(true);
  const [error, setError] = useState("");

  const cargar = useCallback(() => {
    setCargando(true);
    setError("");
    return fetch(`/api/erp/rentabilidad?ventana=${ventana}`, { cache: "no-store" })
      .then(async (respuesta) => {
        const datos = await respuesta.json().catch(() => null);
        if (!respuesta.ok) throw new Error(datos?.error || "No pudimos calcular los márgenes.");
        setResumen(Array.isArray(datos?.resumen) ? datos.resumen : []);
        setIndicadores(Array.isArray(datos?.indicadores) ? datos.indicadores : []);
        setPeriodo(datos?.periodo ?? null);
        setFalta(Array.isArray(datos?.falta) ? datos.falta : []);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "No pudimos calcular los márgenes."))
      .finally(() => {
        setCargando(false);
        setNuncaCargo(false);
      });
  }, [ventana]);

  useEffect(() => {
    const timer = window.setTimeout(() => void cargar(), 0);
    return () => window.clearTimeout(timer);
  }, [cargar]);

  const catalogo = useMemo(() => productos.map((producto) => {
    const precio = Number(producto.precio_venta || 0);
    const costo = producto.costo === null || producto.costo === undefined ? null : Number(producto.costo);
    /*
     * El mismo cálculo que la ficha del producto y que los indicadores de
     * abajo: se le saca el IVA a las dos puntas antes de restar.
     *
     * Restar precio − costo a secas daba una ganancia inflada, y era el tercer
     * lugar de la app con una cuenta distinta para la misma plata. Dos
     * pantallas que muestran dos márgenes del mismo producto no se discuten:
     * se deja de creer en las dos.
     */
    const cuenta = calcularMargen({ costo, precio_venta: precio, iva: producto.iva });
    return {
      ...producto,
      margen: cuenta.conocido ? cuenta.ganancia : null,
      porcentaje: cuenta.conocido ? cuenta.margen : null,
    };
  }).sort((a, b) => (b.margen ?? -Infinity) - (a.margen ?? -Infinity)), [productos]);

  const sinCosto = catalogo.filter((p) => p.costo === null).length;
  const conPerdida = catalogo.filter((p) => p.margen !== null && p.margen < 0).length;

  if (cargando && nuncaCargo) return <div className="neg-loading" role="status"><span /> Calculando rentabilidad…</div>;
  if (error) return <div className="card neg-empty-state is-error" role="alert"><AlertCircle size={26} /><strong>No pudimos calcular los márgenes</strong><p>{error}</p><button type="button" className="chip active" onClick={() => void cargar()}><RefreshCw size={14} /> Reintentar</button></div>;

  return (
    <>
      <div className="card">
        <div className="neg-section-heading">
          <div>
            <div className="card-title">Cómo va el negocio</div>
            <div className="card-sub">
              {periodo ? `Del ${dia(periodo.desde)} al ${dia(periodo.hasta)}` : "Últimos 30 días"}
              {" · "}Todo neto de IVA: el IVA se cobra para la SET, no es plata del negocio.
            </div>
          </div>
          <Target size={24} />
        </div>

        {/*
          Diario, semanal y mensual, como ventanas móviles que terminan hoy.

          No es el mes calendario a propósito: la primera versión lo era, y
          el día que se estrenó era 1 de septiembre — "el mes en curso" eran
          veinticuatro horas y la pantalla salía vacía para todo el mundo.
        */}
        <div className="neg-ventanas" role="group" aria-label="Período">
          {([
            ["dia", "Hoy"],
            ["semana", "7 días"],
            ["mes", "30 días"],
          ] as const).map(([clave, texto]) => (
            <button
              key={clave}
              type="button"
              className={`chip${ventana === clave ? " active" : ""}`}
              aria-pressed={ventana === clave}
              onClick={() => setVentana(clave)}
            >
              {texto}
            </button>
          ))}
        </div>

        {indicadores.length === 0 && (
          <div className="neg-empty-state">
            <TrendingUp size={28} />
            <strong>Todavía no hay movimiento en este período</strong>
            <p>
              Estos números salen de tus ventas y de tus movimientos de dinero. Probá
              con un período más largo, o registrá una venta en la pestaña Ventas y
              volvé acá.
            </p>
          </div>
        )}

        {indicadores.map((i) => (
            <section className="neg-margin-group" key={i.moneda}>
              <header>
                <strong>{i.moneda}</strong>
                {i.ventas_sin_costo > 0 && (
                  <span className="neg-estado">
                    {i.ventas_sin_costo} {i.ventas_sin_costo === 1 ? "venta" : "ventas"} sin costo cargado
                  </span>
                )}
              </header>

              <div className="neg-metricas">
                <Metrica
                  titulo="Vendido"
                  valor={formatearMonto(i.ventas.neto, i.moneda)}
                  nota={`${i.ventas.cantidad} ${i.ventas.cantidad === 1 ? "venta" : "ventas"}`}
                />
                <Metrica
                  titulo="Ticket promedio"
                  valor={i.ticket_promedio === null ? "—" : formatearMonto(i.ticket_promedio, i.moneda)}
                  nota={i.ticket_promedio === null ? "Sin ventas en el período" : "Cuánto deja cada venta"}
                />
                <Metrica
                  titulo="Ganancia"
                  valor={i.ganancia === null ? "—" : formatearMonto(i.ganancia, i.moneda)}
                  nota={i.ganancia === null ? "Cargá el costo de lo que vendés" : "Después del costo de lo vendido"}
                  tono={i.ganancia === null ? undefined : i.ganancia < 0 ? "danger" : "good"}
                />
                <Metrica
                  titulo="Margen"
                  valor={pct(i.margen)}
                  nota="De cada 100 vendidos, cuánto queda"
                  tono={i.margen === null ? undefined : i.margen < 0 ? "danger" : "good"}
                />
                <Metrica
                  titulo="ROI"
                  valor={pct(i.roi)}
                  nota="Lo que volvió por cada guaraní puesto en mercadería"
                  tono={i.roi === null ? undefined : i.roi < 0 ? "danger" : "good"}
                />
                <Metrica
                  titulo="Balance del período"
                  valor={formatearMonto(i.balance, i.moneda)}
                  nota="Lo que entró menos lo que salió"
                  tono={i.balance < 0 ? "danger" : "good"}
                />
                <Metrica
                  titulo="Crecimiento"
                  valor={pct(i.crecimiento_ventas, true)}
                  nota={
                    i.crecimiento_ventas === null
                      ? "Todavía no hay período anterior con ventas"
                      : "Contra el período anterior de igual largo"
                  }
                  tono={
                    i.crecimiento_ventas === null
                      ? undefined
                      : i.crecimiento_ventas < 0
                        ? "danger"
                        : "good"
                  }
                />
                <Metrica
                  titulo="Punto de equilibrio"
                  valor={i.punto_equilibrio === null ? "—" : formatearMonto(i.punto_equilibrio, i.moneda)}
                  nota={
                    i.punto_equilibrio === null
                      ? "Necesita gastos fijos declarados y un margen positivo"
                      : "Cuánto hay que vender por mes para cubrir los fijos"
                  }
                />
              </div>

              {i.concentracion && i.concentracion.porcentaje >= 40 && (
                <p className="neg-growth-alert">
                  <Users size={15} /> {i.concentracion.nombre} concentra el{" "}
                  {i.concentracion.porcentaje.toFixed(0)}% de lo vendido. Un negocio que
                  depende de un solo cliente queda expuesto si ese cliente se va.
                </p>
              )}

              {i.crecimiento_ventas !== null && i.crecimiento_ventas < -15 && (
                <p className="neg-growth-alert">
                  <TrendingDown size={15} /> Vendiste{" "}
                  {Math.abs(i.crecimiento_ventas).toFixed(0)}% menos que el período anterior.
                </p>
              )}
            </section>
          ))}

        {falta.length > 0 && (
            <details className="neg-falta">
              <summary><Info size={14} /> Indicadores que EOS todavía no puede calcular</summary>
              <ul>
                {falta.map((f) => (
                  <li key={f.indicador}><strong>{f.indicador}.</strong> {f.necesita}</li>
                ))}
              </ul>
            </details>
          )}
      </div>

      <div className="card">
        <div className="neg-section-heading">
          <div><div className="card-title">Rentabilidad del negocio</div><div className="card-sub">Cuánto queda después del costo directo de lo vendido. No incluye todavía alquileres, salarios ni otros gastos fijos.</div></div>
          <BadgeDollarSign size={24} />
        </div>

        {resumen.length === 0 ? (
          <div className="neg-empty-state"><TrendingUp size={28} /><strong>Registrá ventas y costos para ver tu margen</strong><p>EOS separará cada moneda y mostrará qué productos sostienen el crecimiento.</p></div>
        ) : resumen.map((grupo) => (
          <section className="neg-margin-group" key={grupo.moneda}>
            <header><strong>{grupo.moneda}</strong>{grupo.contiene_estimaciones && <span className="neg-estado">incluye estimaciones históricas</span>}</header>
            <div className="neg-metricas">
              <div className="neg-metrica"><span>Ventas con costo</span><strong>{formatearMonto(grupo.ventas, grupo.moneda)}</strong></div>
              <div className="neg-metrica"><span>Costo directo</span><strong>{formatearMonto(grupo.costo, grupo.moneda)}</strong></div>
              <div className={`neg-metrica ${grupo.margen < 0 ? "is-danger" : "is-good"}`}><span>Margen bruto</span><strong>{formatearMonto(grupo.margen, grupo.moneda)}</strong></div>
              <div className="neg-metrica"><span>Margen</span><strong>{grupo.margen_porcentaje === null ? "Sin datos" : `${grupo.margen_porcentaje.toFixed(1)}%`}</strong></div>
            </div>
            {grupo.ventas_sin_costo > 0 && <p className="neg-growth-alert"><CircleAlert size={15} /> Hay {grupo.ventas_sin_costo} {grupo.ventas_sin_costo === 1 ? "línea vendida" : "líneas vendidas"} sin costo; EOS no inventa su margen.</p>}
            {grupo.productos.length > 0 && <div className="neg-margin-table"><div className="neg-margin-head"><span>Producto</span><span>Ventas</span><span>Margen</span><span>%</span></div>{grupo.productos.slice(0, 10).map((p) => <div className="neg-margin-row" key={p.clave}><span><strong>{p.nombre}</strong><small>{p.unidades} unidades{p.estimado ? " · estimado" : ""}</small></span><span>{formatearMonto(p.ventas, grupo.moneda)}</span><span className={p.margen < 0 ? "is-negative" : "is-positive"}>{formatearMonto(p.margen, grupo.moneda)}</span><span>{p.margen_porcentaje === null ? "—" : `${p.margen_porcentaje.toFixed(1)}%`}</span></div>)}</div>}
          </section>
        ))}
      </div>

      <div className="card">
        <div className="card-title">Oportunidades para crecer</div>
        <div className="neg-growth-grid">
          <article className={sinCosto ? "needs-attention" : "is-ready"}><strong>{sinCosto}</strong><span>productos sin costo</span><p>{sinCosto ? "Sin costo no hay margen que calcular. Cargalo en Productos, o todos de una vez con Importar si los tenés en una planilla." : "Tu catálogo tiene costos para decidir con datos."}</p></article>
          <article className={conPerdida ? "needs-attention" : "is-ready"}><strong>{conPerdida}</strong><span>productos vendidos bajo costo</span><p>{conPerdida ? "Revisá precios o negociá mejor con proveedores." : "No detectamos precios por debajo del costo actual."}</p></article>
          <article><strong>{catalogo.filter((p) => p.bajo_minimo).length}</strong><span>productos con stock bajo</span><p>Priorizá reposición donde haya margen y demanda.</p></article>
        </div>
      </div>

      <div className="card">
        <div className="card-title">Margen actual del catálogo</div>
        <div className="card-sub">Proyección con el último costo conocido; cambia cuando registrás una compra nueva.</div>
        <div className="neg-margin-table"><div className="neg-margin-head"><span>Producto</span><span>Precio</span><span>Ganancia</span><span>%</span></div>{catalogo.map((p) => <div className="neg-margin-row" key={p.id}><span><strong>{p.nombre}</strong><small>{p.costo === null ? "Falta costo" : `Costo ${formatearMonto(Number(p.costo), p.moneda)}`}</small></span><span>{formatearMonto(p.precio_venta, p.moneda)}</span><span className={(p.margen ?? 0) < 0 ? "is-negative" : "is-positive"}>{p.margen === null ? "—" : formatearMonto(p.margen, p.moneda)}</span><span>{p.porcentaje === null ? "—" : `${p.porcentaje.toFixed(1)}%`}</span></div>)}</div>
      </div>
    </>
  );
}
