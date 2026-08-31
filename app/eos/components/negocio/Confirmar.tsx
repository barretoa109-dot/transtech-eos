"use client";

import { useState } from "react";

/**
 * Un segundo clic, con la consecuencia escrita.
 *
 * ============================================================
 * "¿ESTÁS SEGURO?" NO ES UNA CONFIRMACIÓN
 * ============================================================
 *
 * Un cartel que pregunta "¿estás seguro?" no informa nada: el usuario ya creía
 * estar seguro, por eso apretó. Lo único que frena es el doble clic accidental,
 * y a cambio entrena a apretar "sí" sin leer — con lo cual el día que aparezca
 * un aviso que SÍ importaba, tampoco se lee.
 *
 * Lo que frena de verdad es decir qué va a pasar, con el monto y la moneda
 * adentro: "Se registra el ingreso de ₲ 250.000 en tu panel, con fecha de hoy."
 * Ahí el usuario puede notar que el número no es el que esperaba, que es la
 * única razón por la que valdría la pena frenarlo.
 *
 * Es el mismo criterio que ya usa `Anular.tsx`, extraído para que las otras
 * acciones que mueven plata no tengan que reinventarlo cada una a su manera.
 *
 * ============================================================
 * NO ES UN MODAL
 * ============================================================
 *
 * Se abre en el lugar del botón. Un modal tapa la fila que el usuario estaba
 * mirando —justo la que le diría si se equivocó de venta— y obliga a
 * recordarla de memoria mientras decide.
 */
export default function Confirmar({
  etiqueta,
  consecuencia,
  confirmar,
  onConfirmar,
  peligro = false,
  ocupado = false,
  ocupadoTexto,
}: {
  /** El texto del botón que abre la confirmación. */
  etiqueta: string;
  /** Qué va a pasar exactamente, con montos y fechas. Esto es lo que importa. */
  consecuencia: string;
  /** El texto del botón que ejecuta. Un verbo, no "Aceptar". */
  confirmar: string;
  onConfirmar: () => void;
  peligro?: boolean;
  ocupado?: boolean;
  ocupadoTexto?: string;
}) {
  const [abierto, setAbierto] = useState(false);

  if (!abierto) {
    return (
      <button
        type="button"
        className={`chip${peligro ? " is-danger" : ""}`}
        disabled={ocupado}
        onClick={() => setAbierto(true)}
      >
        {ocupado ? (ocupadoTexto ?? "…") : etiqueta}
      </button>
    );
  }

  return (
    <div className="confirmar-caja" role="group" aria-label={etiqueta}>
      <p className="confirmar-aviso">{consecuencia}</p>

      <div className="confirmar-acciones">
        <button
          type="button"
          className={`chip${peligro ? " is-danger" : ""}`}
          disabled={ocupado}
          autoFocus
          onClick={() => {
            setAbierto(false);
            onConfirmar();
          }}
        >
          {ocupado ? (ocupadoTexto ?? "…") : confirmar}
        </button>

        <button
          type="button"
          className="chip"
          disabled={ocupado}
          onClick={() => setAbierto(false)}
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}
