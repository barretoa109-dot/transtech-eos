"use client";

import { useState } from "react";

type Tipo = "ingreso" | "gasto";

/**
 * Anotar un gasto o un ingreso con una frase, en un solo POST a
 * `/api/finanzas/rapido`.
 *
 * Compartido entre la barra de Inicio/Ingresos y gastos (`GastosView`) y la
 * captura rápida del celular (`CapturaRapidaMovil`, el botón "+" que queda a
 * mano desde cualquier pantalla de Personal): las dos le hablan al mismo
 * endpoint, de la misma manera. Quien usa el hook decide qué hacer después
 * de guardar — `GastosView` recarga su lista y su panel; la captura del
 * celular, al vivir fuera de esa pantalla, solo necesita pedirle a quien la
 * esté mirando que se vuelva a montar.
 */
export function useAnotarRapido(onGuardado?: () => void) {
  const [texto, setTexto] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [entendido, setEntendido] = useState("");
  const [errorAlta, setErrorAlta] = useState("");

  async function anotar(tipo?: Tipo) {
    const linea = texto.trim();
    if (!linea || guardando) return;

    setGuardando(true);
    setErrorAlta("");

    try {
      const respuesta = await fetch("/api/finanzas/rapido", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ texto: linea, tipo }),
      });

      const datos = await respuesta.json().catch(() => null);

      if (!respuesta.ok) {
        throw new Error(
          datos?.error || "No entendí cuánto fue. Probá con algo como «gasté 50 mil en nafta».",
        );
      }

      setEntendido(String(datos?.entendido ?? "Anotado."));
      setTexto("");
      await onGuardado?.();
    } catch (err) {
      setErrorAlta(err instanceof Error ? err.message : "No pudimos anotarlo.");
    } finally {
      setGuardando(false);
    }
  }

  return { texto, setTexto, guardando, entendido, errorAlta, anotar };
}
