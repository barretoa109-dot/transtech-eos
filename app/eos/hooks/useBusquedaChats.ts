"use client";

import { useEffect, useState } from "react";

import { MINIMO_PARA_BUSCAR } from "@/lib/eos/buscar-chats";

import { buscarEnMensajes } from "../services/supabaseChat";

/** Lo que se espera a que la persona deje de escribir antes de preguntar a la base. */
const ESPERA_MS = 300;

/**
 * Los chats cuyo contenido coincide con lo que se escribe en el buscador.
 *
 * Espera a que se deje de escribir (una consulta por palabra, no por letra) y
 * descarta la respuesta de una búsqueda vieja si llega después de una nueva.
 */
export function useBusquedaChats(usuarioId: string, busqueda: string) {
  const [coincidencias, setCoincidencias] = useState<Record<string, string>>({});
  const [buscando, setBuscando] = useState(false);

  useEffect(() => {
    const consulta = busqueda.trim();
    let vigente = true;

    if (!usuarioId || consulta.length < MINIMO_PARA_BUSCAR) {
      const reloj = window.setTimeout(() => {
        if (!vigente) return;
        setCoincidencias({});
        setBuscando(false);
      }, 0);
      return () => {
        vigente = false;
        window.clearTimeout(reloj);
      };
    }

    const reloj = window.setTimeout(async () => {
      setBuscando(true);
      const encontradas = await buscarEnMensajes(usuarioId, consulta);
      if (!vigente) return;
      setCoincidencias(encontradas);
      setBuscando(false);
    }, ESPERA_MS);

    return () => {
      vigente = false;
      window.clearTimeout(reloj);
    };
  }, [usuarioId, busqueda]);

  return { coincidencias, buscando };
}
