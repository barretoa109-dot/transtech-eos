"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { ArrowDownLeft, ArrowUpRight, Mic, Square } from "lucide-react";

import "../chat/eosApp.css";

import { useAnotarRapido } from "../hooks/useAnotarRapido";
import { useDictado } from "../components/useDictado";

/**
 * La puerta de entrada de un Atajo de Siri o del toque en la parte de atrás
 * del teléfono (Back Tap, configurado por la persona en Ajustes →
 * Accesibilidad → Tocar la parte de atrás).
 *
 * Ninguno de los dos puede mostrar una ficha con categoría, fecha y cuenta
 * como la de "Ingresos y gastos" — Siri solo puede preguntar una frase, y
 * Back Tap ni eso. Así que esta pantalla es la versión mínima de esa misma
 * ficha: una línea de texto (con dictado nativo si hace falta) y el mismo
 * endpoint de siempre, `/api/finanzas/rapido`. Categoría, fecha y cuenta
 * las sigue infiriendo EOS del texto, como en cualquier otro alta rápida.
 *
 * `?texto=` llega prellenado cuando el disparador fue Siri (ya preguntó "¿qué
 * gastaste?") y vacío cuando fue el toque en la parte de atrás, que no tiene
 * forma de pedir nada antes de abrir la app — ahí la persona escribe o dicta.
 * Con texto, se guarda solo al entrar: es la forma en que Siri "contesta"
 * enseguida, en vez de dejar a la persona mirando un campo ya lleno.
 */
export default function RapidoPage() {
  return (
    <Suspense fallback={null}>
      <RapidoContenido />
    </Suspense>
  );
}

function RapidoContenido() {
  const parametros = useSearchParams();
  const [tipo, setTipo] = useState<"gasto" | "ingreso">("gasto");
  const autoDisparado = useRef(false);

  const { texto, setTexto, guardando, entendido, errorAlta, anotar } = useAnotarRapido();

  const dictado = useDictado((agregado) => {
    setTexto((previo) => (previo ? `${previo} ${agregado}` : agregado));
  });

  useEffect(() => {
    const prellenado = parametros.get("texto");
    if (!prellenado || autoDisparado.current) return;
    autoDisparado.current = true;
    setTexto(prellenado);
  }, [parametros, setTexto]);

  // Con texto que ya vino de Siri, se guarda directo: esperar un toque más
  // sería pedirle a la persona que confirme algo que ya dijo en voz alta.
  useEffect(() => {
    if (!autoDisparado.current || guardando || entendido) return;
    if (texto && texto === parametros.get("texto")) void anotar(tipo);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [texto]);

  return (
    <div className="eos-app" data-eos-theme="light">
      <main className="onb-pantalla">
        <div className="onb-marca">
          <Image src="/transtech-logo.png" alt="TransTech" width={28} height={28} />
          <span>EOS</span>
        </div>

        <div className="alta-ficha" style={{ maxWidth: 420, width: "100%", margin: "0 auto" }}>
          <div className="alta-ficha-head">
            <span className="alta-ficha-ico" aria-hidden="true">EOS</span>
            <strong>Anotar rápido</strong>
          </div>

          <div className="alta-ficha-tabs" role="tablist" aria-label="Qué tipo de movimiento es">
            <button
              type="button"
              role="tab"
              aria-selected={tipo === "gasto"}
              className={`alta-ficha-tab tab-gasto ${tipo === "gasto" ? "activa" : ""}`}
              onClick={() => setTipo("gasto")}
            >
              <ArrowDownLeft size={14} /> Gasto
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tipo === "ingreso"}
              className={`alta-ficha-tab tab-ingreso ${tipo === "ingreso" ? "activa" : ""}`}
              onClick={() => setTipo("ingreso")}
            >
              <ArrowUpRight size={14} /> Ingreso
            </button>
          </div>

          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              className="alta-ficha-input"
              aria-label={tipo === "ingreso" ? "Anotar un ingreso" : "Anotar un gasto"}
              placeholder={tipo === "ingreso" ? "«cobré el sueldo 3.500.000»" : "«gasté 35 mil en el almuerzo»"}
              value={texto}
              maxLength={200}
              autoFocus
              onChange={(e) => setTexto(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void anotar(tipo);
              }}
            />
            {dictado.soportado && (
              <button
                type="button"
                className="ghost-btn"
                aria-label={dictado.escuchando ? "Dejar de dictar" : "Dictar"}
                aria-pressed={dictado.escuchando}
                onClick={dictado.alternar}
              >
                {dictado.escuchando ? <Square size={16} /> : <Mic size={16} />}
              </button>
            )}
          </div>

          <button
            type="button"
            className={`btn-pri alta-ficha-guardar ${tipo === "ingreso" ? "ingreso-anotar" : "gasto-anotar"}`}
            disabled={guardando || !texto.trim()}
            onClick={() => void anotar(tipo)}
          >
            {guardando ? "Anotando…" : tipo === "ingreso" ? "Guardar ingreso" : "Guardar gasto"}
          </button>

          {entendido && <p className="gastos-entendido">{entendido}</p>}
          {errorAlta && (
            <p className="neg-error" role="alert">
              {errorAlta}
            </p>
          )}
          {dictado.error && (
            <p className="neg-error" role="alert">
              {dictado.error}
            </p>
          )}

          <Link href="/eos/chat" className="ghost-btn" style={{ marginTop: 16, display: "inline-block" }}>
            Ir al chat
          </Link>
        </div>
      </main>
    </div>
  );
}
