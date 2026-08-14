"use client";

import { useCallback, useState } from "react";

import type {
  DocumentoAdjunto,
  ImagenAdjunta,
  Mensaje,
} from "../types/chat";

import { EOSApiError, enviarMensajeAEOS } from "../services/eosApi";
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

function crearRequestId() {
  return crypto.randomUUID();
}

function obtenerUltimoMensajeUsuario(mensajes: Mensaje[]) {
  for (let index = mensajes.length - 1; index >= 0; index -= 1) {
    if (mensajes[index]?.rol === "usuario") {
      return { mensaje: mensajes[index], index };
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

function metadataAdjuntos(
  imagen: ImagenAdjunta | null,
  documento: DocumentoAdjunto | null,
): Record<string, unknown> {
  return {
    ...(imagen?.nombre ? { imagen_nombre: imagen.nombre } : {}),
    ...(documento?.id ? { documento_id: documento.id } : {}),
    ...(documento?.nombre ? { documento_nombre: documento.nombre } : {}),
  };
}

function metadataRespuesta(
  resultado: Awaited<ReturnType<typeof enviarMensajeAEOS>>,
  adjuntos: Record<string, unknown>,
) {
  return {
    ...adjuntos,
    ...(resultado.archivo_url ? { archivo_url: resultado.archivo_url } : {}),
    ...(resultado.archivo_tipo ? { archivo_tipo: resultado.archivo_tipo } : {}),
    ...(resultado.archivo_nombre ? { archivo_nombre: resultado.archivo_nombre } : {}),
    ...(resultado.tipo ? { tipo: resultado.tipo } : {}),
    ...(resultado.accion ? { accion: resultado.accion } : {}),
  };
}

function stringMetadata(
  metadata: Record<string, unknown> | undefined,
  key: string,
) {
  return typeof metadata?.[key] === "string" ? (metadata[key] as string) : "";
}

function esUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function clasificarErrorEOS(error: unknown) {
  const commercial =
    error instanceof EOSApiError &&
    ["EOS_MESSAGE_LIMIT_REACHED", "EOS_SUBSCRIPTION_INACTIVE"].includes(
      error.code,
    );
  const replay =
    error instanceof EOSApiError &&
    [
      "EOS_MESSAGE_REQUEST_IN_PROGRESS",
      "EOS_MESSAGE_REQUEST_ALREADY_CONSUMED",
    ].includes(error.code);

  return {
    commercial,
    replay,
    userFacing: commercial || replay,
  };
}

export function useChat({
  usuarioId,
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
      requestId,
      textoUsuario,
      textoUsuarioPersistido,
      conversacionActiva,
      historialParaContexto,
      imagen,
      documentoId,
      metadataTurno,
      guardarUsuario,
      reemplazarUltimaRespuesta,
      reemplazarRequestId,
    }: {
      requestId: string;
      textoUsuario: string;
      textoUsuarioPersistido: string;
      conversacionActiva: string;
      historialParaContexto: Mensaje[];
      imagen: ImagenAdjunta | null;
      documentoId: string | null;
      metadataTurno: Record<string, unknown>;
      guardarUsuario: boolean;
      reemplazarUltimaRespuesta: boolean;
      reemplazarRequestId: string | null;
    }) => {
      setCargando(true);
      setPensando(true);

      try {
        if (guardarUsuario) {
          await guardarMensaje({
            conversacionId: conversacionActiva,
            requestId,
            rol: "usuario",
            texto: textoUsuarioPersistido,
            metadata: metadataTurno,
          });

          try {
            await actualizarTituloSiHaceFalta(
              conversacionActiva,
              textoUsuario,
            );
          } catch (titleError) {
            console.error("No se pudo actualizar el título del chat:", titleError);
          }
        }

        const resultadoEOS = await enviarMensajeAEOS({
          requestId,
          conversacionId: conversacionActiva,
          mensaje: textoUsuario,
          historial: historialParaContexto.slice(-10),
          nuevoChat: historialParaContexto.length === 0,
          imagen,
          documentoId,
        });

        const textoEOS =
          resultadoEOS.respuesta?.trim() ||
          (resultadoEOS.archivo_url
            ? "Tu archivo ya está listo para descargar."
            : "Listo.");

        const metadataEOS = metadataRespuesta(resultadoEOS, metadataTurno);
        const mensajeEOS: Mensaje = {
          id: crearIdMensaje("eos"),
          request_id:
            reemplazarUltimaRespuesta && reemplazarRequestId
              ? reemplazarRequestId
              : requestId,
          rol: "eos",
          texto: textoEOS,
          estado: "completado",
          archivo_url: resultadoEOS.archivo_url || "",
          archivo_tipo: resultadoEOS.archivo_tipo || "",
          archivo_nombre: resultadoEOS.archivo_nombre || "",
          tipo: resultadoEOS.tipo || "texto",
          accion: resultadoEOS.accion || "RESPONDER",
          creado_en: new Date().toISOString(),
          metadata: metadataEOS,
        };

        let respuestaPersistida = true;

        try {
          await guardarMensaje({
            conversacionId: conversacionActiva,
            requestId,
            rol: "eos",
            texto: textoEOS,
            reemplazarAnterior: reemplazarUltimaRespuesta,
            reemplazarRequestId: reemplazarRequestId || undefined,
            metadata: metadataEOS,
          });
        } catch (persistenceError) {
          respuestaPersistida = false;
          console.error(
            "EOS respondió, pero no se pudo persistir la respuesta:",
            persistenceError,
          );

          if (reemplazarUltimaRespuesta) {
            window.alert(
              "EOS generó una nueva respuesta, pero no pudo guardarla de forma segura. La respuesta anterior se conserva.",
            );
          }
        }

        setHistorial((actual) => {
          if (reemplazarUltimaRespuesta && !respuestaPersistida) {
            return actual;
          }

          if (!reemplazarUltimaRespuesta || !reemplazarRequestId) {
            return [...actual, mensajeEOS];
          }

          const copia = [...actual];
          const respuestaAnteriorIndex = copia.findIndex(
            (item) =>
              item.rol === "eos" && item.request_id === reemplazarRequestId,
          );

          if (respuestaAnteriorIndex >= 0) {
            copia.splice(respuestaAnteriorIndex, 1);
          }

          return [...copia, mensajeEOS];
        });

        try {
          await cargarBriefing(usuarioId);
        } catch (briefingError) {
          console.error("No se pudo refrescar el briefing:", briefingError);
        }

        window.dispatchEvent(new Event("eos:usage-changed"));
      } catch (error) {
        console.error("ERROR EOS:", error);

        const errorType = clasificarErrorEOS(error);
        const respuestaError = errorType.userFacing && error instanceof Error
          ? error.message
          : "Ahora mismo no pude conectarme correctamente. Probá nuevamente en unos segundos.";

        if (errorType.commercial) {
          window.dispatchEvent(new Event("eos:usage-changed"));
        }

        if (reemplazarUltimaRespuesta) {
          window.alert(respuestaError);
        } else {
          const mensajeError: Mensaje = {
            id: crearIdMensaje(
              errorType.commercial
                ? "plan"
                : errorType.replay
                  ? "estado"
                  : "error",
            ),
            request_id: requestId,
            rol: "eos",
            texto: respuestaError,
            estado: errorType.userFacing ? "completado" : "error",
            tipo: "texto",
            accion: errorType.commercial ? "ABRIR_PLANES" : "RESPONDER",
            creado_en: new Date().toISOString(),
          };

          setHistorial((actual) => [...actual, mensajeError]);
        }
      } finally {
        setPensando(false);
        setCargando(false);
      }
    },
    [
      actualizarTituloSiHaceFalta,
      cargarBriefing,
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

    const requestId = crearRequestId();
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

    const textoUsuarioPersistido = referencias
      ? `${textoUsuario}\n\n${referencias}`
      : textoUsuario;
    const metadataTurno = metadataAdjuntos(imagenActual, documentoActual);

    const mensajeUsuario: Mensaje = {
      id: crearIdMensaje("usuario"),
      request_id: requestId,
      rol: "usuario",
      texto: textoUsuarioPersistido,
      estado: "completado",
      creado_en: new Date().toISOString(),
      metadata: metadataTurno,
    };

    const historialAntesDelEnvio = historial.slice(-10);

    setMensaje("");
    setImagenAdjunta(null);
    setDocumentoAdjunto(null);

    setHistorial((actual) => [...actual, mensajeUsuario]);

    await ejecutarEOS({
      requestId,
      textoUsuario,
      textoUsuarioPersistido,
      conversacionActiva,
      historialParaContexto: historialAntesDelEnvio,
      imagen: imagenActual,
      documentoId: documentoActual?.id || null,
      metadataTurno,
      guardarUsuario: true,
      reemplazarUltimaRespuesta: false,
      reemplazarRequestId: null,
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

    const requestIdOriginal = String(
      ultimoUsuario.mensaje.request_id || "",
    );

    if (!esUuid(requestIdOriginal)) {
      window.alert(
        "Este turno pertenece a un historial anterior y no puede regenerarse de forma segura. Enviá el mensaje nuevamente para generar una respuesta nueva.",
      );
      return;
    }

    const documentoId = stringMetadata(
      ultimoUsuario.mensaje.metadata,
      "documento_id",
    );
    const imagenNombre = stringMetadata(
      ultimoUsuario.mensaje.metadata,
      "imagen_nombre",
    );

    if (imagenNombre && !documentoId) {
      window.alert(
        "Para regenerar una respuesta basada en una imagen, volvé a adjuntar la imagen original.",
      );
      return;
    }

    const documentoIdSeguro =
      documentoId && esUuid(documentoId) ? documentoId : null;
    const textoUsuario = limpiarReferenciasAdjuntas(
      ultimoUsuario.mensaje.texto,
    );
    const historialParaContexto = historial
      .slice(0, ultimoUsuario.index)
      .slice(-10);
    const requestId = crearRequestId();

    await ejecutarEOS({
      requestId,
      textoUsuario,
      textoUsuarioPersistido: ultimoUsuario.mensaje.texto,
      conversacionActiva: conversacionId,
      historialParaContexto,
      imagen: null,
      documentoId: documentoIdSeguro,
      metadataTurno: ultimoUsuario.mensaje.metadata || {},
      guardarUsuario: false,
      reemplazarUltimaRespuesta: true,
      reemplazarRequestId: requestIdOriginal,
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
