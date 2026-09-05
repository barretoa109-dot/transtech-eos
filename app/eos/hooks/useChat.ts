"use client";

import { useCallback, useState } from "react";

import type {
  ArchivoAdjunto,
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

  setHistorial: React.Dispatch<
    React.SetStateAction<Mensaje[]>
  >;

  nuevaConversacion: (
    usuarioId: string,
  ) => Promise<string | null>;

  actualizarTituloSiHaceFalta: (
    id: string,
    textoUsuario: string,
  ) => Promise<void>;

  cargarBriefing: (
    usuarioId: string,
  ) => Promise<void>;
};

type EjecutarEOSParams = {
  textoUsuario: string;
  conversacionActiva: string;
  historialParaContexto: Mensaje[];
  archivo: ArchivoAdjunto | null;
  guardarUsuario: boolean;
  reemplazarUltimaRespuesta: boolean;
};

function crearIdMensaje(prefijo: string) {
  return `${prefijo}-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 9)}`;
}

function obtenerUltimoMensajeUsuario(
  mensajes: Mensaje[],
): Mensaje | null {
  for (
    let index = mensajes.length - 1;
    index >= 0;
    index -= 1
  ) {
    if (mensajes[index]?.rol === "usuario") {
      return mensajes[index];
    }
  }

  return null;
}

function limpiarReferenciaDeArchivo(texto: string) {
  return texto
    .replace(
      /\n\n\[(?:Imagen|Archivo) adjunt[oa]:[^\]]+\]\s*$/i,
      "",
    )
    .trim();
}

function esImagenAdjunta(
  archivo: ArchivoAdjunto | null,
): boolean {
  return Boolean(
    archivo?.tipo?.toLowerCase().startsWith("image/"),
  );
}

function construirTextoPredeterminado(
  archivo: ArchivoAdjunto,
): string {
  if (esImagenAdjunta(archivo)) {
    return `Analizá esta imagen: ${archivo.nombre}`;
  }

  return `Analizá este archivo: ${archivo.nombre}`;
}

function construirReferenciaArchivo(
  archivo: ArchivoAdjunto,
): string {
  const etiqueta = esImagenAdjunta(archivo)
    ? "Imagen adjunta"
    : "Archivo adjunto";

  return `[${etiqueta}: ${archivo.nombre}]`;
}

/*
 * "Load failed", tal cual, en el medio del chat.
 *
 * Una clienta lo reportó: escribe algo, sale de la app (se va a otra
 * pestaña, la pantalla se apaga) y cuando vuelve encuentra ese texto en
 * inglés donde esperaba la respuesta. No es un error de EOS — es el `fetch`
 * del navegador muriendo porque el sistema operativo cortó la conexión de
 * una pestaña en segundo plano, algo normal en un celular. El problema es
 * que ese `error.message` se mostraba tal cual, como si fuera lo que EOS
 * tenía para decir.
 *
 * El navegador SIEMPRE tira un `TypeError` para un fallo de red del propio
 * `fetch` ("Load failed" en Safari, "Failed to fetch" en Chrome,
 * "NetworkError..." en Firefox) — es la señal para distinguirlo de un
 * `Error` que esta misma app arma a propósito con un texto pensado para
 * leerse (como "EOS respondió vacío", más abajo en eosApi.ts). Ninguno de
 * esos es nunca un TypeError, así que la distinción no depende de adivinar
 * palabras del navegador que cambian entre versiones.
 */
function obtenerMensajeError(error: unknown): string {
  if (
    error instanceof Error &&
    !(error instanceof TypeError) &&
    error.message.trim()
  ) {
    return error.message;
  }

  return "Ahora mismo no pude conectarme correctamente. Probá nuevamente en unos segundos.";
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

  const [archivoAdjunto, setArchivoAdjunto] =
    useState<ArchivoAdjunto | null>(null);

  const ejecutarEOS = useCallback(
    async ({
      textoUsuario,
      conversacionActiva,
      historialParaContexto,
      archivo,
      guardarUsuario,
      reemplazarUltimaRespuesta,
    }: EjecutarEOSParams) => {
      setCargando(true);
      setPensando(true);

      try {
        if (guardarUsuario) {
          await guardarMensaje(
            conversacionActiva,
            usuarioId,
            "usuario",
            textoUsuario,
          );

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
          archivo,
        });

        const textoBase =
          resultadoEOS.respuesta?.trim() ||
          (resultadoEOS.archivo_url
            ? "Tu archivo ya está listo para descargar."
            : "Listo.");

        /*
         * El enlace del archivo va DENTRO del texto, en su propia línea.
         *
         * No es adorno: de todo el mensaje, `mensajes.texto` es lo único que se
         * guarda en la base. Si el enlace viviera solo en el objeto en memoria,
         * el archivo desaparecería al recargar la conversación, y el usuario
         * tendría que volver a pedírselo a EOS —gastando otro mensaje de su
         * plan— para bajar algo que ya estaba hecho.
         */
        const textoEOS =
          resultadoEOS.archivo_url && !textoBase.includes(resultadoEOS.archivo_url)
            ? `${textoBase}\n\n${resultadoEOS.archivo_url}`
            : textoBase;

        const mensajeEOS: Mensaje = {
          id: crearIdMensaje("eos"),
          rol: "eos",
          texto: textoEOS,
          estado: "completado",
          archivo_url:
            resultadoEOS.archivo_url || "",
          archivo_tipo:
            resultadoEOS.archivo_tipo || "",
          archivo_nombre:
            resultadoEOS.archivo_nombre || "",
          tipo: resultadoEOS.tipo || "texto",
          accion:
            resultadoEOS.accion || "RESPONDER",
          creado_en: new Date().toISOString(),
        };

        await guardarMensaje(
          conversacionActiva,
          usuarioId,
          "eos",
          textoEOS,
        );

        setHistorial((actual) => {
          if (!reemplazarUltimaRespuesta) {
            return [...actual, mensajeEOS];
          }

          const copia = [...actual];

          for (
            let index = copia.length - 1;
            index >= 0;
            index -= 1
          ) {
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
          obtenerMensajeError(error);

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
            usuarioId,
            "eos",
            respuestaError,
          );
        } catch (errorGuardado) {
          console.error(
            "No se pudo guardar el mensaje de error:",
            errorGuardado,
          );
        }

        setHistorial((actual) => [
          ...actual,
          mensajeError,
        ]);
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
    const textoFinal =
      typeof textoManual === "string"
        ? textoManual
        : mensaje;

    const tieneTexto =
      textoFinal.trim().length > 0;
    const tieneArchivo =
      Boolean(archivoAdjunto);

    if (
      (!tieneTexto && !tieneArchivo) ||
      cargando
    ) {
      return;
    }

    if (!usuarioId) {
      window.location.href = "/login";
      return;
    }

    let conversacionActiva = conversacionId;

    if (!conversacionActiva) {
      const nueva =
        await nuevaConversacion(usuarioId);

      if (!nueva) {
        window.alert(
          "No se pudo iniciar una nueva conversación.",
        );
        return;
      }

      conversacionActiva = nueva;
    }

    const archivoActual = archivoAdjunto;

    const textoUsuario =
      textoFinal.trim() ||
      (archivoActual
        ? construirTextoPredeterminado(
            archivoActual,
          )
        : "");

    const textoVisibleUsuario =
      archivoActual
        ? `${textoUsuario}\n\n${construirReferenciaArchivo(
            archivoActual,
          )}`
        : textoUsuario;

    const mensajeUsuario: Mensaje = {
      id: crearIdMensaje("usuario"),
      rol: "usuario",
      texto: textoVisibleUsuario,
      estado: "completado",
      archivo_nombre:
        archivoActual?.nombre || "",
      archivo_tipo:
        archivoActual?.tipo || "",
      tipo: archivoActual
        ? "archivo_adjunto"
        : "texto",
      creado_en: new Date().toISOString(),
    };

    const historialAntesDelEnvio =
      historial.slice(-10);

    setMensaje("");
    setArchivoAdjunto(null);

    setHistorial((actual) => [
      ...actual,
      mensajeUsuario,
    ]);

    await ejecutarEOS({
      textoUsuario,
      conversacionActiva,
      historialParaContexto:
        historialAntesDelEnvio,
      archivo: archivoActual,
      guardarUsuario: true,
      reemplazarUltimaRespuesta: false,
    });
  }

  async function regenerarRespuesta() {
    if (
      cargando ||
      pensando ||
      !usuarioId
    ) {
      return;
    }

    if (!conversacionId) {
      window.alert(
        "Todavía no hay una conversación para regenerar.",
      );
      return;
    }

    const ultimoUsuario =
      obtenerUltimoMensajeUsuario(historial);

    if (!ultimoUsuario) {
      window.alert(
        "No encontré un mensaje anterior para regenerar.",
      );
      return;
    }

    const textoUsuario =
      limpiarReferenciaDeArchivo(
        ultimoUsuario.texto,
      );

    const historialSinUltimaRespuesta = [
      ...historial,
    ];

    for (
      let index =
        historialSinUltimaRespuesta.length - 1;
      index >= 0;
      index -= 1
    ) {
      if (
        historialSinUltimaRespuesta[index]
          ?.rol === "eos"
      ) {
        historialSinUltimaRespuesta.splice(
          index,
          1,
        );
        break;
      }
    }

    await ejecutarEOS({
      textoUsuario,
      conversacionActiva: conversacionId,
      historialParaContexto:
        historialSinUltimaRespuesta.slice(-10),
      archivo: null,
      guardarUsuario: false,
      reemplazarUltimaRespuesta: true,
    });
  }

  return {
    mensaje,
    setMensaje,

    cargando,
    pensando,

    archivoAdjunto,
    setArchivoAdjunto,

    enviarMensaje,
    regenerarRespuesta,
  };
}