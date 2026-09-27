"use client";

import { useState } from "react";
import type { Conversacion, Mensaje } from "../types/chat";
import {
  actualizarTituloConversacion,
  crearConversacion,
  obtenerConversaciones,
  obtenerMensajes,
} from "../services/supabaseChat";

const TITULOS_POR_DEFECTO = new Set(["Nuevo chat", "Nuevo proceso EOS", "Diagnóstico actual"]);

/**
 * La conversación todavía no tiene un mensaje de la persona.
 *
 * El título se reemplaza por el primer mensaje, así que mientras siga siendo
 * uno de los de fábrica nadie escribió ahí.
 */
export function tieneTituloPorDefecto(c: Conversacion): boolean {
  return !c.titulo || TITULOS_POR_DEFECTO.has(c.titulo);
}

export function useConversations() {
  const [conversacionId, setConversacionId] = useState("");
  const [conversaciones, setConversaciones] = useState<Conversacion[]>([]);
  const [historial, setHistorial] = useState<Mensaje[]>([]);

  async function cargarConversaciones(usuarioId: string) {
    const conversacionesData = await obtenerConversaciones(usuarioId);

    if (conversacionesData.length === 0) {
      await nuevaConversacion(usuarioId);
      return;
    }

    setConversaciones(conversacionesData);
    setConversacionId(conversacionesData[0].id);
    await abrirConversacion(conversacionesData[0].id);
  }

  async function nuevaConversacion(usuarioId: string) {
    const nueva = await crearConversacion(usuarioId);

    if (!nueva) return null;

    setConversacionId(nueva.id);
    setConversaciones((prev) => [nueva, ...prev]);

    // Leave historial empty so the animated hero greeting shows (matching
    // the mockup) instead of skipping straight to the chat-bubble layout.
    setHistorial([]);

    return nueva.id;
  }

  async function abrirConversacion(id: string) {
    setConversacionId(id);
    const mensajes = await obtenerMensajes(id);
    setHistorial(mensajes);
  }

  async function actualizarTituloSiHaceFalta(id: string, textoUsuario: string) {
    const conversacionActual = conversaciones.find((c) => c.id === id);

    if (!conversacionActual || tieneTituloPorDefecto(conversacionActual)) {
      const titulo = await actualizarTituloConversacion(id, textoUsuario);

      setConversaciones((prev) =>
        prev.map((c) => (c.id === id ? { ...c, titulo } : c))
      );
    }
  }

  return {
    conversacionId,
    conversaciones,
    historial,
    setHistorial,
    cargarConversaciones,
    nuevaConversacion,
    abrirConversacion,
    actualizarTituloSiHaceFalta,
  };
}