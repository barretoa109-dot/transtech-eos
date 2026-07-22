"use client";

import { useState } from "react";
import type { Conversacion, Mensaje } from "../types/chat";
import {
  actualizarTituloConversacion,
  crearConversacion,
  obtenerConversaciones,
  obtenerMensajes,
} from "../services/supabaseChat";

export function useConversations(nombre: string) {
  const [conversacionId, setConversacionId] = useState("");
  const [conversaciones, setConversaciones] = useState<Conversacion[]>([]);
  const [historial, setHistorial] = useState<Mensaje[]>([]);

  async function cargarConversaciones(
  usuarioId: string,
  nombreUsuario?: string
) {
    const conversacionesData = await obtenerConversaciones(usuarioId);

    if (conversacionesData.length === 0) {
  await nuevaConversacion(usuarioId, nombreUsuario);
  return;
}

    setConversaciones(conversacionesData);
    setConversacionId(conversacionesData[0].id);
    await abrirConversacion(conversacionesData[0].id);
  }

  async function nuevaConversacion(
  usuarioId: string,
  nombreUsuario?: string
) {
    const nueva = await crearConversacion(usuarioId);

    if (!nueva) return null;

    setConversacionId(nueva.id);
    setConversaciones((prev) => [nueva, ...prev]);

    setHistorial([
      {
        rol: "eos",
        texto: `Hola ${nombreUsuario || nombre}. Soy EOS.\n\nEste es un nuevo chat. Contame qué querés trabajar hoy: finanzas, negocio, documentos, objetivos, tareas o decisiones importantes.`,
      },
    ]);

    return nueva.id;
  }

  async function abrirConversacion(id: string) {
    setConversacionId(id);
    const mensajes = await obtenerMensajes(id);
    setHistorial(mensajes);
  }

  async function actualizarTituloSiHaceFalta(id: string, textoUsuario: string) {
    const conversacionActual = conversaciones.find((c) => c.id === id);

    if (
      !conversacionActual?.titulo ||
      conversacionActual.titulo === "Nuevo chat" ||
      conversacionActual.titulo === "Nuevo proceso EOS" ||
      conversacionActual.titulo === "Diagnóstico actual"
    ) {
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