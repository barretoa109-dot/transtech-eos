"use client";

import { useState } from "react";
import { AlertTriangle, Check, Pencil, Scale } from "lucide-react";
import { formatearMonto } from "@/lib/finanzas/formato";
import type { Producto } from "./tipos";

/**
 * Una fila del catálogo, con sus dos formas de corregir.
 *
 * ============================================================
 * EDITAR Y AJUSTAR NO SON LO MISMO
 * ============================================================
 *
 * Y por eso son dos botones y no uno.
 *
 * **Editar** cambia lo que el producto ES: cómo se llama, cuánto sale, qué IVA
 * lleva. Se corrige y listo, no hay nada que explicar.
 *
 * **Ajustar** cambia cuántos HAY, y eso es un hecho del depósito, no del
 * catálogo. Deja un movimiento con su motivo, igual que una venta o una compra,
 * porque es la única forma de que dentro de seis meses alguien pueda explicar
 * por qué el sistema dice 12 y en el estante hay 9.
 *
 * Mezclarlos en un solo formulario —un campo "stock" al lado del precio— haría
 * que corregir un precio y corregir un inventario se sientan igual de livianos,
 * y uno de los dos no lo es. El servidor tampoco lo permite: la ruta que edita
 * el producto no puede escribir `stock_actual`.
 */

type Props = { producto: Producto; onCambio: () => void };

export default function FilaProducto({ producto, onCambio }: Props) {
  const [modo, setModo] = useState<"ver" | "editar" | "ajustar">("ver");
  const [aviso, setAviso] = useState("");

  function listo(mensaje: string) {
    setModo("ver");
    setAviso(mensaje);
    onCambio();
    window.setTimeout(() => setAviso(""), 4000);
  }

  return (
    <div className="neg-fila">
      <div className="neg-fila-texto">
        <strong>{producto.nombre}</strong>
        <small>
          {producto.codigo ? `${producto.codigo} · ` : ""}
          {producto.iva === 0 ? "Exenta" : `IVA ${producto.iva}%`}
          {producto.controla_stock ? ` · ${producto.stock_actual} en stock` : " · servicio"}
          {producto.costo != null && producto.costo > 0
            ? ` · costo ${formatearMonto(producto.costo, producto.moneda)}`
            : ""}
        </small>
        {aviso && <span className="neg-inline-success" role="status"><Check size={12} /> {aviso}</span>}
      </div>

      <span className="neg-fila-monto">
        {formatearMonto(producto.precio_venta, producto.moneda)}
      </span>

      {producto.bajo_minimo && (
        <span className="neg-estado is-mal">
          <AlertTriangle size={12} /> bajo mínimo
        </span>
      )}

      {modo === "ver" && (
        <>
          <button type="button" className="chip" onClick={() => setModo("editar")}>
            <Pencil size={11} style={{ display: "inline", marginRight: 3, verticalAlign: -1 }} />
            Editar
          </button>

          {producto.controla_stock && (
            <button type="button" className="chip" onClick={() => setModo("ajustar")}>
              <Scale size={11} style={{ display: "inline", marginRight: 3, verticalAlign: -1 }} />
              Ajustar
            </button>
          )}
        </>
      )}

      {modo === "editar" && (
        <Editar
          producto={producto}
          onCerrar={() => setModo("ver")}
          onListo={() => {
            listo("Cambios guardados");
          }}
        />
      )}

      {modo === "ajustar" && (
        <Ajustar
          producto={producto}
          onCerrar={() => setModo("ver")}
          onListo={() => {
            listo("Stock actualizado");
          }}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function Editar({
  producto,
  onCerrar,
  onListo,
}: {
  producto: Producto;
  onCerrar: () => void;
  onListo: () => void;
}) {
  const [nombre, setNombre] = useState(producto.nombre);
  const [precio, setPrecio] = useState(String(producto.precio_venta));
  const [iva, setIva] = useState<0 | 5 | 10>(producto.iva);
  const [minimo, setMinimo] = useState(String(producto.stock_minimo ?? 0));
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");

  async function guardar() {
    if (!nombre.trim()) {
      setError("El producto necesita un nombre.");
      return;
    }

    setGuardando(true);
    setError("");

    try {
      const respuesta = await fetch(`/api/erp/productos/${producto.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nombre: nombre.trim(),
          precio_venta: Number(precio) || 0,
          iva,
          ...(producto.controla_stock ? { stock_minimo: Number(minimo) || 0 } : {}),
        }),
      });

      const datos = await respuesta.json().catch(() => null);
      if (!respuesta.ok) throw new Error(datos?.error || "No se pudo guardar.");

      onListo();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar.");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="fila-editor">
      <div className="fila-editor-campos">
        <input
          className="neg-input"
          value={nombre}
          maxLength={200}
          autoFocus
          placeholder="Nombre"
          onChange={(e) => setNombre(e.target.value)}
        />

        <input
          className="neg-input neg-cantidad"
          type="number"
          min={0}
          value={precio}
          placeholder="Precio"
          onChange={(e) => setPrecio(e.target.value)}
        />

        <select
          className="neg-input neg-cantidad"
          value={iva}
          onChange={(e) => setIva(Number(e.target.value) as 0 | 5 | 10)}
        >
          <option value={10}>IVA 10%</option>
          <option value={5}>IVA 5%</option>
          <option value={0}>Exenta</option>
        </select>

        {producto.controla_stock && (
          <input
            className="neg-input neg-cantidad"
            type="number"
            min={0}
            value={minimo}
            placeholder="Mínimo"
            title="Stock mínimo: debajo de esto se avisa"
            onChange={(e) => setMinimo(e.target.value)}
          />
        )}
      </div>

      {/*
        Se dice por qué no está el stock acá. Sin esta línea, quien busca
        corregir "12 que en realidad son 9" abre este formulario, no lo
        encuentra y concluye que el sistema no lo deja.
      */}
      {producto.controla_stock && (
        <p className="fila-editor-nota">
          Las existencias se cambian con <strong>Ajustar</strong>, que deja el motivo anotado.
        </p>
      )}

      {error && <p className="anular-error">{error}</p>}

      <div className="anular-acciones">
        <button type="button" className="chip active" disabled={guardando} onClick={guardar}>
          {guardando ? "Guardando…" : "Guardar"}
        </button>
        <button type="button" className="chip" disabled={guardando} onClick={onCerrar}>
          Cancelar
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function Ajustar({
  producto,
  onCerrar,
  onListo,
}: {
  producto: Producto;
  onCerrar: () => void;
  onListo: () => void;
}) {
  const [forma, setForma] = useState<"conteo" | "merma">("conteo");
  const [valor, setValor] = useState("");
  const [motivo, setMotivo] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState("");

  async function ajustar() {
    const numero = Number(valor);

    if (!valor.trim() || !Number.isFinite(numero)) {
      setError(forma === "conteo" ? "¿Cuántos contaste?" : "¿Cuántos se perdieron?");
      return;
    }

    if (forma === "conteo" && numero < 0) {
      setError("El conteo no puede ser negativo.");
      return;
    }

    if (forma === "merma" && numero <= 0) {
      setError("Poné cuántos se perdieron, en positivo.");
      return;
    }

    if (motivo.trim().length < 3) {
      setError("Escribí brevemente el motivo.");
      return;
    }

    setEnviando(true);
    setError("");

    try {
      const respuesta = await fetch(`/api/erp/productos/${producto.id}/ajustar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          forma === "conteo"
            ? { stock_contado: numero, motivo: motivo.trim() }
            : // La merma se escribe en positivo y se manda en negativo: nadie
              // piensa "menos tres" cuando se le rompen tres.
              { delta: -numero, motivo: motivo.trim() },
        ),
      });

      const datos = await respuesta.json().catch(() => null);
      if (!respuesta.ok) throw new Error(datos?.error || "No se pudo ajustar.");

      onListo();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo ajustar.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="fila-editor">
      <div className="chip-row">
        <button
          type="button"
          className={`chip${forma === "conteo" ? " active" : ""}`}
          onClick={() => setForma("conteo")}
        >
          Conté y hay…
        </button>
        <button
          type="button"
          className={`chip${forma === "merma" ? " active" : ""}`}
          onClick={() => setForma("merma")}
        >
          Se perdieron…
        </button>
      </div>

      <p className="fila-editor-nota">
        {forma === "conteo"
          ? `El sistema dice ${producto.stock_actual}. Poné lo que contaste y la diferencia queda registrada.`
          : "Para roturas o faltantes puntuales, sin tener que contar todo."}
      </p>

      <div className="fila-editor-campos">
        <input
          className="neg-input neg-cantidad"
          type="number"
          min={0}
          value={valor}
          autoFocus
          placeholder={forma === "conteo" ? "Contados" : "Perdidos"}
          onChange={(e) => {
            setValor(e.target.value);
            if (error) setError("");
          }}
        />

        <input
          className="neg-input"
          value={motivo}
          maxLength={300}
          placeholder={forma === "conteo" ? "Conteo de fin de mes" : "Se rompieron"}
          onChange={(e) => {
            setMotivo(e.target.value);
            if (error) setError("");
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") ajustar();
            if (e.key === "Escape") onCerrar();
          }}
        />
      </div>

      {error && <p className="anular-error">{error}</p>}

      <div className="anular-acciones">
        <button type="button" className="chip active" disabled={enviando} onClick={ajustar}>
          {enviando ? "Ajustando…" : "Ajustar"}
        </button>
        <button type="button" className="chip" disabled={enviando} onClick={onCerrar}>
          Cancelar
        </button>
      </div>
    </div>
  );
}
