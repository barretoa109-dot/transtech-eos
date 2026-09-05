"use client";

import { useState } from "react";
import { LifeBuoy } from "lucide-react";

/**
 * Pedir ayuda sin salir de EOS.
 *
 * ============================================================
 * POR QUÉ UN FORMULARIO Y NO UNA DIRECCIÓN
 * ============================================================
 *
 * Poner "escribinos a soporte@" es más fácil y no sirve igual. Obliga a salir
 * del producto, abrir el correo, acordarse de contar quién sos y desde dónde
 * escribís. En ese camino se pierde la mayoría: se quedan con el problema y se
 * van sin decir nada, que es la peor forma de perder a alguien porque ni
 * siquiera te enterás de que se fue.
 *
 * Acá se escribe en dos líneas y se manda. Quién es, qué plan tiene y qué
 * módulos contrató lo agrega el servidor: el usuario no tiene por qué saber
 * qué datos necesitamos nosotros para ayudarlo.
 *
 * La dirección se sigue mostrando abajo, para quien prefiera su propio correo o
 * necesite adjuntar algo.
 */

const CORREO = "soporte@transtech.com.py";

export default function Soporte({ pantalla }: { pantalla?: string }) {
  const [abierto, setAbierto] = useState(false);
  const [mensaje, setMensaje] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [enviado, setEnviado] = useState(false);
  const [error, setError] = useState("");

  async function enviar() {
    if (mensaje.trim().length < 10) {
      setError("Contanos un poco más, así te podemos ayudar de una.");
      return;
    }

    setEnviando(true);
    setError("");

    try {
      const respuesta = await fetch("/api/soporte", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mensaje: mensaje.trim(), pantalla }),
      });

      const datos = await respuesta.json().catch(() => null);

      if (!respuesta.ok) {
        // El servidor devuelve la dirección cuando no puede mandar el correo:
        // nadie se queda sin forma de pedir ayuda.
        setError(datos?.error || `No pudimos enviarlo. Escribinos a ${CORREO}.`);
        return;
      }

      setEnviado(true);
      setMensaje("");
    } catch {
      setError(`No pudimos enviarlo. Escribinos a ${CORREO}.`);
    } finally {
      setEnviando(false);
    }
  }

  if (!abierto) {
    return (
      <button type="button" className="soporte-abrir" onClick={() => setAbierto(true)}>
        <LifeBuoy size={15} />
        ¿Necesitás ayuda?
      </button>
    );
  }

  return (
    <div className="soporte-caja">
      {enviado ? (
        <>
          <p className="soporte-listo">
            <strong>Listo, lo recibimos.</strong> Te respondemos a tu correo. Si es urgente,
            escribinos también a {CORREO}.
          </p>

          <button
            type="button"
            className="chip"
            onClick={() => {
              setEnviado(false);
              setAbierto(false);
            }}
          >
            Cerrar
          </button>
        </>
      ) : (
        <>
          <p className="soporte-titulo">Contanos qué pasa</p>
          <p className="soporte-sub">
            No hace falta que expliques quién sos ni qué plan tenés: eso ya lo sabemos.
          </p>

          <textarea
            className="neg-input soporte-texto"
            rows={4}
            maxLength={4000}
            autoFocus
            placeholder="Por ejemplo: cargué una venta con el cliente equivocado y no sé cómo corregirla."
            value={mensaje}
            onChange={(e) => {
              setMensaje(e.target.value);
              if (error) setError("");
            }}
          />

          {error && <p className="soporte-error" role="alert">{error}</p>}

          <div className="soporte-acciones">
            <button type="button" className="chip active" disabled={enviando} onClick={enviar}>
              {enviando ? "Enviando…" : "Enviar"}
            </button>

            <button
              type="button"
              className="chip"
              disabled={enviando}
              onClick={() => {
                setAbierto(false);
                setError("");
              }}
            >
              Cancelar
            </button>
          </div>

          <p className="soporte-alternativa">
            O escribinos directo a <a href={`mailto:${CORREO}`}>{CORREO}</a>.
          </p>
        </>
      )}
    </div>
  );
}
