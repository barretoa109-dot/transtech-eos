"use client";

import { useState } from "react";
import type { ImagenAdjunta, Mensaje } from "../types/chat";
import { enviarMensajeAEOS } from "../services/eosApi";
import { guardarMensaje } from "../services/supabaseChat";

type UseChatParams = {
  usuarioId: string;
  nombre: string;
  plan: string;
  conversacionId: string;
  historial: Mensaje[];
  setHistorial: React.Dispatch<React.SetStateAction<Mensaje[]>>;
  nuevaConversacion: (usuarioId: string) => Promise<string | null>;
  actualizarTituloSiHaceFalta: (id: string, textoUsuario: string) => Promise<void>;
  cargarBriefing: (usuarioId: string) => Promise<void>;
};

export function useChat({
  usuarioId,
  nombre,
  plan,
  conversacionId,
  historial,
  setHistorial,
  nuevaConversacion,
  actualizarTituloSiHaceFalta,
  cargarBriefing,
}: UseChatParams) {
  const [mensaje, setMensaje] = useState("");
  const [cargando, setCargando] = useState(false);
  const [imagenAdjunta, setImagenAdjunta] = useState<ImagenAdjunta | null>(null);

  async function enviarMensaje(textoManual?: string) {
    const textoFinal = textoManual || mensaje;
    const tieneImagen = Boolean(imagenAdjunta);

    if ((!textoFinal.trim() && !tieneImagen) || cargando) return;

    if (!usuarioId) {
      window.location.href = "/login";
      return;
    }

    let conversacionActiva = conversacionId;

    if (!conversacionActiva) {
      const nueva = await nuevaConversacion(usuarioId);
      if (!nueva) return;
      conversacionActiva = nueva;
    }

    const textoUsuario =
      textoFinal.trim() || `Analizá esta imagen: ${imagenAdjunta?.nombre || "imagen adjunta"}`;

    const historialActual = historial;
    const imagenActual = imagenAdjunta;

    setMensaje("");
    setImagenAdjunta(null);
    setCargando(true);

    setHistorial((prev) => [
      ...prev,
      {
        rol: "usuario",
        texto: imagenActual
          ? `${textoUsuario}\n\n[Imagen adjunta: ${imagenActual.nombre}]`
          : textoUsuario,
      },
      { rol: "eos", texto: "Analizando..." },
    ]);

    await guardarMensaje(conversacionActiva, "usuario", textoUsuario);
    await actualizarTituloSiHaceFalta(conversacionActiva, textoUsuario);

    try {
      const resultadoEOS = await enviarMensajeAEOS({
  usuarioId,
  conversacionId: conversacionActiva,
  nombre,
  plan,
  mensaje: textoUsuario,
  historial: historialActual,
  nuevoChat: historialActual.length <= 1,
  imagen: imagenActual,
});

const textoEOS =
  resultadoEOS.respuesta ||
  (resultadoEOS.archivo_url
    ? "Tu archivo ya está listo para descargar."
    : "Listo.");

await guardarMensaje(conversacionActiva, "eos", textoEOS);

const mensajeEOS = {
  rol: "eos" as const,
  texto: textoEOS,
  archivo_url: resultadoEOS.archivo_url || "",
  archivo_tipo: resultadoEOS.archivo_tipo || "",
  tipo: resultadoEOS.tipo || "texto",
  accion: resultadoEOS.accion || "RESPONDER",
};

setHistorial((prev) => [
  ...prev.slice(0, -1),
  mensajeEOS,
]);

      await cargarBriefing(usuarioId);
    } catch (error) {
      console.log("ERROR EOS:", error);

      const respuestaError =
        "Ahora mismo no pude conectarme bien. Probá de nuevo en unos segundos.";

      await guardarMensaje(conversacionActiva, "eos", respuestaError);

      setHistorial((prev) => [
        ...prev.slice(0, -1),
        { rol: "eos", texto: respuestaError },
      ]);
    } finally {
      setCargando(false);
    }
  }

  return {
    mensaje,
    setMensaje,
    cargando,
    imagenAdjunta,
    setImagenAdjunta,
    enviarMensaje,
  };
}