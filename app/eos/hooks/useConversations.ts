"use client";

import { useRef, useState } from "react";
import type { Conversacion, Mensaje } from "../types/chat";
import {
  actualizarTituloConversacion,
  archivarConversacion,
  crearConversacion,
  eliminarConversacion,
  obtenerConversaciones,
  obtenerMensajes,
  pedirTituloInteligente,
  renombrarConversacion,
} from "../services/supabaseChat";
import { TITULOS_AUTOMATICOS } from "@/lib/eos/titulo-chat";

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

export function estaArchivada(c: Conversacion): boolean {
  return Boolean(c.archivada_at);
}

export function useConversations() {
  const [conversacionId, setConversacionId] = useState("");
  const [conversaciones, setConversaciones] = useState<Conversacion[]>([]);
  const [historial, setHistorial] = useState<Mensaje[]>([]);

  async function cargarConversaciones(usuarioId: string) {
    const conversacionesData = await obtenerConversaciones(usuarioId);
    // Se abre la más reciente de la lista, no una archivada: archivar es
    // justamente pedir no verla al entrar.
    const primera = conversacionesData.find((c) => !estaArchivada(c));

    setConversaciones(conversacionesData);

    if (!primera) {
      await nuevaConversacion(usuarioId);
      return;
    }

    setConversacionId(primera.id);
    await abrirConversacion(primera.id);
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

    // Una conversación vieja con título genérico ("Inicio con EOS", "Plan
    // financiero") recibe el suyo al abrirla, si ya tiene una respuesta.
    const conversacion = conversaciones.find((c) => c.id === id);
    if (conversacion && TITULOS_AUTOMATICOS.has(conversacion.titulo ?? "") && mensajes.some((m) => m.rol === "eos")) {
      void mejorarTitulo(id);
    }
  }

  /*
   * El título escrito por el modelo, como en Claude. Se pide después de cada
   * respuesta mientras el título siga siendo automático (el provisional del
   * primer mensaje o uno de fábrica), hasta 3 veces: si el primer mensaje fue
   * un saludo, el tema aparece en el segundo o el tercero. Un título que la
   * persona renombró no se toca (el servidor también lo controla).
   */
  const provisionales = useRef(new Map<string, string>());
  const intentos = useRef(new Map<string, number>());

  async function mejorarTitulo(id: string) {
    const conversacion = conversaciones.find((c) => c.id === id);
    const actual = conversacion?.titulo ?? "";
    const automatico = TITULOS_AUTOMATICOS.has(actual) || provisionales.current.get(id) === actual || !conversacion;
    const hechos = intentos.current.get(id) ?? 0;
    if (!automatico || hechos >= 3) return;
    intentos.current.set(id, hechos + 1);

    const { titulo } = await pedirTituloInteligente(id);
    if (!titulo) return;
    provisionales.current.delete(id);
    intentos.current.set(id, 3);
    setConversaciones((prev) => prev.map((c) => (c.id === id ? { ...c, titulo } : c)));
  }

  async function actualizarTituloSiHaceFalta(id: string, textoUsuario: string) {
    const conversacionActual = conversaciones.find((c) => c.id === id);

    if (!conversacionActual || tieneTituloPorDefecto(conversacionActual)) {
      const titulo = await actualizarTituloConversacion(id, textoUsuario);
      provisionales.current.set(id, titulo);

      setConversaciones((prev) =>
        prev.map((c) => (c.id === id ? { ...c, titulo } : c))
      );
    }
  }

  /**
   * El chat abierto dejó de estar en la lista (se archivó o se eliminó): se
   * abre el siguiente de la lista, o uno nuevo si no queda ninguno. Sin esto
   * la pantalla seguiría mostrando, y dejando escribir, en un chat que la
   * persona acaba de sacar de su vista.
   */
  async function salirDe(id: string, restantes: Conversacion[], usuarioId: string) {
    if (id !== conversacionId) return;

    const siguiente = restantes.find((c) => !estaArchivada(c));

    if (siguiente) {
      await abrirConversacion(siguiente.id);
    } else {
      await nuevaConversacion(usuarioId);
    }
  }

  async function renombrar(id: string, titulo: string) {
    const guardado = await renombrarConversacion(id, titulo);
    if (!guardado) return false;

    setConversaciones((prev) => prev.map((c) => (c.id === id ? { ...c, titulo: guardado } : c)));
    return true;
  }

  async function archivar(id: string, archivar: boolean, usuarioId: string) {
    const archivadaAt = await archivarConversacion(id, archivar);
    if (archivadaAt === undefined) return false;

    const restantes = conversaciones.map((c) => (c.id === id ? { ...c, archivada_at: archivadaAt } : c));
    setConversaciones(restantes);

    if (archivar) await salirDe(id, restantes, usuarioId);
    return true;
  }

  async function eliminar(id: string, usuarioId: string) {
    const ok = await eliminarConversacion(id);
    if (!ok) return false;

    const restantes = conversaciones.filter((c) => c.id !== id);
    setConversaciones(restantes);

    await salirDe(id, restantes, usuarioId);
    return true;
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
    mejorarTitulo,
    renombrar,
    archivar,
    eliminar,
  };
}
