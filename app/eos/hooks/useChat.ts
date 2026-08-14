"use client";

import { useCallback, useState } from "react";

import type {
  DocumentoAdjunto,
  ImagenAdjunta,
  Mensaje,
} from "../types/chat";

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

  actualizarTituloSiHaceFalta: (
    id: string,
    textoUsuario: string,
  ) => Promise<void>;

  cargarBriefing: (usuarioId: string) => Promise<void>;
};

function crearIdMensaje(prefijo: string) {
  return `${prefijo}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function obtenerUltimoMensajeUsuario(mensajes: Mensaje[]): Mensaje | null {
  for (let index = mensajes.length - 1; index >= 0; index -= 1) {
    if (mensajes[index]?.rol === "usuario") {
      return mensajes[index];
    }
  }

  return null;
}

function limpiarReferenciasAdjuntas(texto: string) {
  return texto
    .replace(/\n\n\[Imagen adjunta:[^\]]+\]\s*$/i, "")
    .replace(/\n\n\[Documento adjunto:[^\]]+\]\s*$/i, "")
    .trim();
}

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
  const [pensando, setPensando] = useState(false);

  const [imagenAdjunta, setImagenAdjunta] = useState<ImagenAdjunta | null>(null);
  const [documentoAdjunto, setDocumentoAdjunto] =
    useState<DocumentoAdjunto | null>(null);

  const ejecutarEOS = useCallback(
    async ({
      textoUsuario,
      conversacionActiva,
      historialParaContexto,
      imagen,
      documento,
      guardarUsuario,
      reemplazarUltimaRespuesta,
    }: {
      textoUsuario: string;
      conversacionActiva: string;
      historialParaContexto: Mensaje[];
      imagen: ImagenAdjunta | null;
      documento: DocumentoAdjunto | null;
      guardarUsuario: boolean;
      reemplazarUltimaRespuesta: boolean;
    }) => {
      setCargando(true);
      setPensando(true);

      try {
        if (guardarUsuario) {
          await guardarMensaje(conversacionActiva, "usuario", textoUsuario);

          await actualizarTituloSiHaceFalta(
            conversacionActiva,
            textoUsuario,
          );
        }

        const resultadoEOS = await enviarMensajeAEOS({
          usuarioId,
          conversacionId: conversacionActiva,
          nombre,
          plan,
          mensaje: textoUsuario,
          historial: historialParaContexto.slice(-10),
          nuevoChat: historialParaContexto.length === 0,
          imagen,
          documentoId: documento?.id || null,
        });

        const textoEOS =
          resultadoEOS.respuesta?.trim() ||
          (resultadoEOS.archivo_url
            ? "Tu archivo ya está listo para descargar."
            : "Listo.");

        const mensajeEOS: Mensaje = {
          id: crearIdMensaje("eos"),
          rol: "eos",
          texto: textoEOS,
          estado: "completado",
          archivo_url: resultadoEOS.archivo_url || "",
          archivo_tipo: resultadoEOS.archivo_tipo || "",
          archivo_nombre: resultadoEOS.archivo_nombre || "",
          tipo: resultadoEOS.tipo || "texto",
          accion: resultadoEOS.accion || "RESPONDER",
          creado_en: new Date().toISOString(),
        };

        await guardarMensaje(conversacionActiva, "eos", textoEOS);

        setHistorial((actual) => {
          if (!reemplazarUltimaRespuesta) {
            return [...actual, mensajeEOS];
          }

          const copia = [...actual];

          for (let index = copia.length - 1; index >= 0; index -= 1) {
            if (copia[index]?.rol === "eos") {
              copia.splice(index, 1);
              break;
            }
          }

          return [...copia, mensajeEOS];
        });

        await cargarBriefing(usuarioId);
      } catch (error) {
        console.error("ERROR EOS:", error);

        const respuestaError =
          "Ahora mismo no pude conectarme correctamente. Probá nuevamente en unos segundos.";

        const mensajeError: Mensaje = {
          id: crearIdMensaje("error"),
          rol: "eos",
          texto: respuestaError,
          estado: "error",
          creado_en: new Date().toISOString(),
        };

        try {
          await guardarMensaje(
            conversacionActiva,
            "eos",
            respuestaError,
          );
        } catch (errorGuardado) {
          console.error(
            "No se pudo guardar el mensaje de error:",
            errorGuardado,
          );
        }

        setHistorial((actual) => [...actual, mensajeError]);
      } finally {
        setPensando(false);
        setCargando(false);
      }
    },
    [
      actualizarTituloSiHaceFalta,
      cargarBriefing,
      nombre,
      plan,
      setHistorial,
      usuarioId,
    ],
  );

  async function enviarMensaje(textoManual?: string) {
    const textoFinal = typeof textoManual === "string" ? textoManual : mensaje;

    const tieneTexto = textoFinal.trim().length > 0;
    const tieneImagen = Boolean(imagenAdjunta);
    const tieneDocumento = Boolean(documentoAdjunto);

    if ((!tieneTexto && !tieneImagen && !tieneDocumento) || cargando) {
      return;
    }

    if (!usuarioId) {
      window.location.href = "/login";
      return;
    }

    let conversacionActiva = conversacionId;

    if (!conversacionActiva) {
      const nueva = await nuevaConversacion(usuarioId);

      if (!nueva) {
        window.alert("No se pudo iniciar una nueva conversación.");
        return;
      }

      conversacionActiva = nueva;
    }

    const imagenActual = imagenAdjunta;
    const documentoActual = documentoAdjunto;

    const textoUsuario =
      textoFinal.trim() ||
      (documentoActual
        ? `Analizá este documento: ${documentoActual.nombre}`
        : `Analizá esta imagen: ${imagenActual?.nombre || "imagen adjunta"}`);

    const referencias = [
      imagenActual ? `[Imagen adjunta: ${imagenActual.nombre}]` : "",
      documentoActual
        ? `[Documento adjunto: ${documentoActual.nombre} | ${documentoActual.id}]`
        : "",
    ]
      .filter(Boolean)
      .join("\n");

    const mensajeUsuario: Mensaje = {
      id: crearIdMensaje("usuario"),
      rol: "usuario",
      texto: referencias ? `${textoUsuario}\n\n${referencias}` : textoUsuario,
      estado: "completado",
      creado_en: new Date().toISOString(),
    };

    const historialAntesDelEnvio = historial.slice(-10);

    setMensaje("");
    setImagenAdjunta(null);
    setDocumentoAdjunto(null);

    setHistorial((actual) => [...actual, mensajeUsuario]);

    await ejecutarEOS({
      textoUsuario,
      conversacionActiva,
      historialParaContexto: historialAntesDelEnvio,
      imagen: imagenActual,
      documento: documentoActual,
      guardarUsuario: true,
      reemplazarUltimaRespuesta: false,
    });
  }

  async function regenerarRespuesta() {
    if (cargando || pensando || !usuarioId) {
      return;
    }

    if (!conversacionId) {
      window.alert("Todavía no hay una conversación para regenerar.");
      return;
    }

    const ultimoUsuario = obtenerUltimoMensajeUsuario(historial);

    if (!ultimoUsuario) {
      window.alert("No encontré un mensaje anterior para regenerar.");
      return;
    }

    const textoUsuario = limpiarReferenciasAdjuntas(ultimoUsuario.texto);

    const historialSinUltimaRespuesta = [...historial];

    for (
      let index = historialSinUltimaRespuesta.length - 1;
      index >= 0;
      index -= 1
    ) {
      if (historialSinUltimaRespuesta[index]?.rol === "eos") {
        historialSinUltimaRespuesta.splice(index, 1);
        break;
      }
    }

    await ejecutarEOS({
      textoUsuario,
      conversacionActiva: conversacionId,
      historialParaContexto: historialSinUltimaRespuesta.slice(-10),
      imagen: null,
      documento: null,
      guardarUsuario: false,
      reemplazarUltimaRespuesta: true,
    });
  }

  return {
    mensaje,
    setMensaje,

    cargando,
    pensando,

    imagenAdjunta,
    setImagenAdjunta,

    documentoAdjunto,
    setDocumentoAdjunto,

    enviarMensaje,
    regenerarRespuesta,
  };
}
