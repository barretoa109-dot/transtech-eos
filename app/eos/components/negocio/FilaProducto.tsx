"use client";

import { useState } from "react";
import { AlertTriangle, Check, Pencil, Scale } from "lucide-react";
import { formatearMonto } from "@/lib/finanzas/formato";
import { calcularMargen, textoMargen } from "@/lib/erp/margen";
import { tasaValida } from "@/lib/erp/impuestos";
import Confirmar from "./Confirmar";
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

  /** La baja es lógica: las ventas que ya lo nombran no se tocan. */
  async function darDeBaja() {
    const respuesta = await fetch(`/api/erp/productos/${producto.id}`, { method: "DELETE" });

    if (!respuesta.ok) {
      const datos = await respuesta.json().catch(() => null);
      window.alert(datos?.error || "No pudimos darlo de baja.");
      return;
    }

    onCambio();
  }
  const [aviso, setAviso] = useState("");

  const margen = calcularMargen({
    costo: producto.costo,
    precio_venta: producto.precio_venta,
    iva: tasaValida(producto.iva),
  });

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

      {/*
        Cuánto se gana con este producto, calculado solo.

        Va al lado del precio y no escondido en la ficha porque es el número
        que decide si conviene seguir vendiéndolo, y hasta ahora había que
        sacarlo a mano — mal, casi siempre, porque la resta obvia no descuenta
        el IVA y da una ganancia que no existe.
      */}
      {margen.conocido && (
        <span
          className={`neg-margen${margen.pierde ? " is-perdida" : ""}`}
          title={
            `Ganás ${formatearMonto(margen.ganancia, producto.moneda)} por unidad, ` +
            `ya descontado el IVA de las dos puntas.`
          }
        >
          {textoMargen(margen)}
        </span>
      )}

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

          {/*
            Dar de baja, con la consecuencia adentro.

            La ruta existía desde siempre y ninguna pantalla la llamaba: no
            había forma de sacar un producto cargado por error, y un catálogo
            del que no se puede sacar nada junta duplicados hasta que el
            informe de ventas deja de significar algo.

            La baja es lógica, no un borrado: las ventas viejas apuntan acá y
            borrarlo dejaría el historial sin nombres. Eso se dice, porque es
            la diferencia entre "lo perdí" y "lo saqué de la lista".
          */}
          <Confirmar
            etiqueta="Dar de baja"
            peligro
            consecuencia={
              `"${producto.nombre}" deja de aparecer para cargar ventas y compras. ` +
              "Las ventas que ya lo incluyen no cambian: siguen mostrando su nombre y su importe. " +
              "No se borra nada."
            }
            confirmar="Sí, darlo de baja"
            onConfirmar={() => void darDeBaja()}
          />
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
  const [costo, setCosto] = useState(
    producto.costo == null ? "" : String(producto.costo),
  );
  const [iva, setIva] = useState<0 | 5 | 10>(producto.iva);
  const [minimo, setMinimo] = useState(String(producto.stock_minimo ?? 0));
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");

  /*
   * El margen se recalcula mientras escribe, no al guardar.
   *
   * Es el momento en que sirve: la pregunta "¿a cuánto lo pongo?" se contesta
   * moviendo el precio y mirando qué pasa con la ganancia. Mostrarlo recién
   * después de guardar obligaría a guardar, mirar, volver a entrar y corregir.
   */
  const margenEnVivo = calcularMargen({
    costo: costo === "" ? null : Number(costo),
    precio_venta: Number(precio),
    iva: tasaValida(iva),
  });

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
          // Vacío significa "no sé cuánto me cuesta", que es distinto de cero:
          // un costo en cero mostraría 100% de margen, que es falso.
          costo: costo.trim() === "" ? null : Number(costo),
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
          value={costo}
          placeholder="Costo"
          title="Lo que te cuesta a vos, con IVA incluido como viene en la factura del proveedor"
          onChange={(e) => setCosto(e.target.value)}
        />

        <input
          className="neg-input neg-cantidad"
          type="number"
          min={0}
          value={precio}
          placeholder="Precio"
          title="Lo que cobrás, con IVA incluido"
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
        La ganancia, mientras escribe.

        Es el momento en que sirve: la pregunta "¿a cuánto lo pongo?" se
        contesta moviendo el precio y mirando qué pasa. Mostrarlo recién al
        guardar obligaría a guardar, mirar, volver a entrar y corregir.
      */}
      <p
        className={`fila-margen${
          margenEnVivo.conocido && margenEnVivo.pierde ? " is-perdida" : ""
        }`}
      >
        {textoMargen(margenEnVivo)}
        {margenEnVivo.conocido && (
          <span className="fila-margen-detalle">
            {" · "}
            {margenEnVivo.pierde ? "perdés" : "ganás"}{" "}
            {formatearMonto(Math.abs(margenEnVivo.ganancia), producto.moneda)} por unidad
          </span>
        )}
      </p>

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

      {error && <p className="anular-error" role="alert">{error}</p>}

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

      {error && <p className="anular-error" role="alert">{error}</p>}

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
