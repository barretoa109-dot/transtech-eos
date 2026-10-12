"use client";

import { useState } from "react";

type Tipo = "ingreso" | "gasto";

/**
 * Lo que la persona eligió a mano, por excepción. Ninguno de los dos es
 * obligatorio: sin tocarlos, EOS sigue infiriendo la categoría del texto y la
 * fecha de palabras como "ayer" ("EL USUARIO NO CATEGORIZA", `destinos.ts`).
 * Pero si la persona sí dice cuál es, esa elección manda sobre la inferencia.
 */
type Elegido = { categoria?: string; fecha?: string; cuentaId?: string };

/**
 * Anotar un gasto o un ingreso con una frase, en un solo POST a
 * `/api/finanzas/rapido`.
 *
 * Usado por la ficha de Inicio/Ingresos y gastos (`GastosView`). El "+" del
 * celular vivía aparte (`CapturaRapidaMovil`) y hablaba con este mismo hook;
 * se sacó (05/10/2026 → reorganización del menú) porque el alta pasó a vivir
 * siempre arriba de "Ingresos y gastos", a un toque desde el menú — ya no
 * hacía falta un atajo flotante aparte.
 */
export function useAnotarRapido(onGuardado?: () => void) {
  const [texto, setTexto] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [entendido, setEntendido] = useState("");
  const [errorAlta, setErrorAlta] = useState("");

  async function anotar(tipo?: Tipo, elegido?: Elegido) {
    const linea = texto.trim();
    if (!linea || guardando) return;

    setGuardando(true);
    setErrorAlta("");

    try {
      const respuesta = await fetch("/api/finanzas/rapido", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          texto: linea,
          tipo,
          categoria: elegido?.categoria || undefined,
          fecha: elegido?.fecha || undefined,
          cuenta_id: elegido?.cuentaId || undefined,
        }),
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
