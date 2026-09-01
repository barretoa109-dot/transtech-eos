"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, BadgeDollarSign, CircleAlert, RefreshCw, TrendingUp } from "lucide-react";
import { formatearMonto } from "@/lib/finanzas/formato";
import type { ResumenRentabilidad } from "@/lib/erp/rentabilidad";
import type { Producto } from "./tipos";

export default function Rentabilidad({ productos }: { productos: Producto[] }) {
  const [resumen, setResumen] = useState<ResumenRentabilidad[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");

  const cargar = useCallback(() => {
    setCargando(true);
    setError("");
    return fetch("/api/erp/rentabilidad", { cache: "no-store" })
      .then(async (respuesta) => {
        const datos = await respuesta.json().catch(() => null);
        if (!respuesta.ok) throw new Error(datos?.error || "No pudimos calcular los márgenes.");
        setResumen(Array.isArray(datos?.resumen) ? datos.resumen : []);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "No pudimos calcular los márgenes."))
      .finally(() => setCargando(false));
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void cargar(), 0);
    return () => window.clearTimeout(timer);
  }, [cargar]);

  const catalogo = useMemo(() => productos.map((producto) => {
    const precio = Number(producto.precio_venta || 0);
    const costo = producto.costo === null || producto.costo === undefined ? null : Number(producto.costo);
    const margen = costo === null ? null : precio - costo;
    return {
      ...producto,
      margen,
      porcentaje: margen !== null && precio > 0 ? (margen / precio) * 100 : null,
    };
  }).sort((a, b) => (b.margen ?? -Infinity) - (a.margen ?? -Infinity)), [productos]);

  const sinCosto = catalogo.filter((p) => p.costo === null).length;
  const conPerdida = catalogo.filter((p) => p.margen !== null && p.margen < 0).length;

  if (cargando) return <div className="neg-loading" role="status"><span /> Calculando rentabilidad…</div>;
  if (error) return <div className="card neg-empty-state is-error" role="alert"><AlertCircle size={26} /><strong>No pudimos calcular los márgenes</strong><p>{error}</p><button type="button" className="chip active" onClick={() => void cargar()}><RefreshCw size={14} /> Reintentar</button></div>;

  return (
    <>
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
          <article className={sinCosto ? "needs-attention" : "is-ready"}><strong>{sinCosto}</strong><span>productos sin costo</span><p>{sinCosto ? "Completá el costo para saber si realmente dejan ganancia." : "Tu catálogo tiene costos para decidir con datos."}</p></article>
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
