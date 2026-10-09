"use client";

import { useEffect, useRef, useState } from "react";
import { Plus, X } from "lucide-react";
import { useAnotarRapido } from "../hooks/useAnotarRapido";

type Props = {
  /** Qué hacer después de guardar — el consumidor decide cómo refrescarse. */
  onGuardado?: () => void;
};

/**
 * El botón "+" de Personal en el celular: un toque, una frase, listo.
 *
 * ============================================================
 * POR QUÉ EXISTE APARTE DE LA BARRA DE SIEMPRE
 * ============================================================
 *
 * La barra de "Anotá un gasto…" ya vive arriba de Inicio e Ingresos y
 * gastos, pero solo ahí: en el celular, para anotar algo desde cualquier
 * otra pantalla de Personal (Fijos, Lo que viene, Tengo y debo...) había que
 * volver a Inicio primero. Es exactamente el trámite que se pidió sacar —
 * "Sofía solo quiere tocar un + y poder registrar lo que quiera".
 *
 * Usa el mismo `useAnotarRapido` que la barra de GastosView: mismo POST a
 * `/api/finanzas/rapido`, mismo criterio de éxito y error. Lo único propio
 * acá es la hoja que se abre y se cierra sola al terminar.
 *
 * Solo en Personal (se monta condicionalmente desde `page.tsx`) y solo
 * visible en celular por CSS (`.captura-rapida-movil`, breakpoint 860px,
 * el mismo que ya usa el menú lateral) — en escritorio la barra de siempre
 * alcanza.
 */
export default function CapturaRapidaMovil({ onGuardado }: Props) {
  const [abierta, setAbierta] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const { texto, setTexto, guardando, entendido, errorAlta, anotar } = useAnotarRapido(onGuardado);

  useEffect(() => {
    if (abierta) inputRef.current?.focus();
  }, [abierta]);

  // Guardado con éxito: un toque de confirmación y se cierra sola.
  useEffect(() => {
    if (!entendido) return;
    const timer = window.setTimeout(() => setAbierta(false), 1200);
    return () => window.clearTimeout(timer);
  }, [entendido]);

  async function registrar(tipo: "ingreso" | "gasto") {
    await anotar(tipo);
  }

  return (
    <>
      <button
        type="button"
        className="captura-rapida-fab"
        onClick={() => setAbierta(true)}
        aria-label="Anotar un gasto o un ingreso"
      >
        <Plus size={24} />
      </button>

      {abierta && (
        <div className="captura-rapida-scrim" onClick={() => setAbierta(false)} aria-hidden>
          <div className="captura-rapida-hoja" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Anotar un gasto o un ingreso">
            <div className="captura-rapida-handle" />
            <div className="captura-rapida-head">
              <strong>¿Qué querés registrar?</strong>
              <button type="button" className="captura-rapida-cerrar" onClick={() => setAbierta(false)} aria-label="Cerrar">
                <X size={16} />
              </button>
            </div>

            <input
              ref={inputRef}
              className="captura-rapida-input"
              placeholder="«gasté 35 mil en el almuerzo»"
              value={texto}
              maxLength={200}
              onChange={(e) => setTexto(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void registrar("gasto");
              }}
            />
            <p className="captura-rapida-ayuda">
              Hablale como le contás a alguien. EOS entiende el monto, la fecha y en qué fue.
            </p>

            <div className="captura-rapida-botones">
              <button type="button" className="btn-pri gasto-anotar" disabled={guardando} onClick={() => void registrar("gasto")}>
                {guardando ? "Anotando…" : "− Anotar gasto"}
              </button>
              <button type="button" className="btn-pri ingreso-anotar" disabled={guardando} onClick={() => void registrar("ingreso")}>
                + Anotar ingreso
              </button>
            </div>

            {entendido && <p className="gastos-entendido">{entendido}</p>}
            {errorAlta && <p className="neg-error" role="alert">{errorAlta}</p>}
          </div>
        </div>
      )}
    </>
  );
}
