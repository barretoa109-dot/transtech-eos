"use client";

import { useState } from "react";
import { Undo2 } from "lucide-react";

/**
 * Anular una venta o una compra cargada mal.
 *
 * ============================================================
 * POR QUÉ PIDE UN MOTIVO Y NO ALCANZA CON "¿SEGURO?"
 * ============================================================
 *
 * Anular devuelve stock y borra un movimiento de plata. Dentro de seis meses,
 * cuando alguien mire por qué el saldo de un producto no cierra, la diferencia
 * entre poder explicarlo y no poder explicarlo es esta línea de texto.
 *
 * Un "¿estás seguro?" sólo frena el doble clic. El motivo además deja escrito
 * qué pasó, y por eso el servidor lo exige: si esta pantalla no lo pidiera, el
 * pedido volvería rechazado igual.
 *
 * El campo empieza cerrado a propósito. Anular no es una acción de todos los
 * días y no debería estar a un clic de distancia mientras se carga una venta.
 */

type Props = {
  /** "ventas" o "compras": la ruta y los textos salen de acá. */
  recurso: "ventas" | "compras";
  id: string;
  /** Para volver a pedir la lista cuando ya se anuló. */
  onAnulado: () => void;
};

export default function Anular({ recurso, id, onAnulado }: Props) {
  const [abierto, setAbierto] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState("");

  const esVenta = recurso === "ventas";

  async function anular() {
    if (motivo.trim().length < 3) {
      setError("Escribí brevemente por qué.");
      return;
    }

    setEnviando(true);
    setError("");

    try {
      const respuesta = await fetch(`/api/erp/${recurso}/${id}/anular`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ motivo: motivo.trim() }),
      });

      const datos = await respuesta.json().catch(() => null);

      if (!respuesta.ok) {
        /*
         * El caso de la factura emitida se muestra entero.
         *
         * El servidor explica ahí que hace falta una nota de crédito o cancelar
         * el documento ante la SET. Reemplazarlo por un "no se pudo" dejaría al
         * usuario sin saber qué hacer con una obligación tributaria abierta.
         */
        setError(datos?.error ?? "No pudimos anular.");
        setEnviando(false);
        return;
      }

      setAbierto(false);
      setMotivo("");
      onAnulado();
    } catch (err) {
      console.error("No se pudo anular:", err);
      setError("No pudimos anular. Probá de nuevo.");
    } finally {
      setEnviando(false);
    }
  }

  if (!abierto) {
    return (
      <button
        type="button"
        className="chip is-danger"
        onClick={() => setAbierto(true)}
        title={esVenta ? "Anular esta venta" : "Anular esta compra"}
      >
        <Undo2 size={12} style={{ display: "inline", marginRight: 3, verticalAlign: -2 }} />
        Anular
      </button>
    );
  }

  return (
    <div className="anular-caja">
      <p className="anular-aviso">
        {esVenta
          ? "Se devuelve el stock y se saca ese ingreso del panel."
          : "Se retira el stock y se devuelve ese gasto al panel."}
      </p>

      <input
        className="neg-input"
        placeholder="¿Por qué la anulás?"
        value={motivo}
        maxLength={300}
        autoFocus
        onChange={(e) => {
          setMotivo(e.target.value);
          if (error) setError("");
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") anular();
          if (e.key === "Escape") setAbierto(false);
        }}
      />

      {error && <p className="anular-error">{error}</p>}

      <div className="anular-acciones">
        <button type="button" className="chip is-danger" disabled={enviando} onClick={anular}>
          {enviando ? "Anulando..." : "Confirmar"}
        </button>

        <button
          type="button"
          className="chip"
          disabled={enviando}
          onClick={() => {
            setAbierto(false);
            setMotivo("");
            setError("");
          }}
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}
