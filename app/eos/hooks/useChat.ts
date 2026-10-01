"use client";

import { useCallback, useRef, useState } from "react";

import { textoPorDefecto } from "@/lib/eos/adjuntos";

import type {
  ArchivoAdjunto,
  Mensaje,
} from "../types/chat";

import { enviarMensajeAEOS } from "../services/eosApi";
import { textoConCita, type Cita } from "@/lib/eos/cita";
import {
  etiquetaDeAdjuntos,
  type FotoGuardada,
} from "@/lib/eos/fotos-chat";
import { formatoDuracion, notaDelVideo } from "@/lib/eos/videos";
import { HISTORIAL_MAXIMO } from "@/lib/eos/historial";
import {
  guardarMensaje,
  subirFotoDelChat,
} from "../services/supabaseChat";

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
  archivos: ArchivoAdjunto[];
  guardarUsuario: boolean;
  reemplazarUltimaRespuesta: boolean;
  /** El pedazo de una respuesta de EOS sobre el que se está preguntando. */
  cita: Cita | null;
  /** Las fotos del mensaje, subiéndose mientras EOS contesta. */
  fotosSubidas: Promise<FotoGuardada[]>;
  /**
   * Lo que EOS necesita saber y la persona no escribió: qué video son los
   * cuadros adjuntos. Viaja con el mensaje pero NO se guarda en su texto.
   */
  notaParaEOS?: string;
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
      // `Imágenes adjuntas` y `Archivos adjuntos` entran por el mismo patrón:
      // el plural y la tilde están contemplados. Sin eso, regenerar un mensaje
      // con varias fotos dejaba la referencia pegada al texto y EOS la leía
      // como parte de la pregunta.
      /\n\n\[(?:Im[áa]gen(?:es)?|Archivos?|Videos?|Fotos y videos) adjunt[oa]s?:[^\]]+\]\s*$/i,
      "",
    )
    .trim();
}

/*
 * Sube las fotos del mensaje, todas a la vez, para mostrarlas al volver.
 *
 * Corre en paralelo con la respuesta de EOS: la persona no espera la subida.
 * Las que fallan se descartan en silencio —la línea de texto las sigue
 * nombrando— y el mensaje se guarda igual.
 */
async function subirFotos(
  archivos: ArchivoAdjunto[],
): Promise<FotoGuardada[]> {
  const fotos = archivos.filter(seVeComoMiniatura);
  if (fotos.length === 0) return [];

  const subidas = await Promise.all(
    fotos.map(async (f) => {
      // De un video se guarda la miniatura, que es un JPEG; el video no.
      const guardada = await subirFotoDelChat({
        nombre: f.nombre,
        tipo: f.video ? "image/jpeg" : f.tipo,
        base64: f.base64,
      });

      return guardada && f.video
        ? { ...guardada, tipo: f.tipo, duracion: f.video.duracion }
        : guardada;
    }),
  );

  return subidas.filter((f): f is FotoGuardada => f !== null);
}

/** Fotos y videos: los dos se muestran como miniatura en la burbuja. */
function seVeComoMiniatura(archivo: ArchivoAdjunto): boolean {
  return esImagenAdjunta(archivo) || Boolean(archivo.video);
}

/*
 * Lo que de verdad viaja a EOS.
 *
 * Un video no viaja: viajan sus cuadros como fotos y su audio como WAV
 * (`lib/eos/videos.ts`). El resto de los archivos, tal cual. Se arma recién
 * acá, al mandar, para que el compositor muestre UN video y no cinco piezas.
 */
function archivosParaEOS(archivos: ArchivoAdjunto[]): ArchivoAdjunto[] {
  return archivos.flatMap((archivo) => {
    const video = archivo.video;
    if (!video) return [archivo];

    const base = archivo.nombre.replace(/\.[^.]+$/, "");

    const cuadros = video.cuadros.map((base64, i) => ({
      nombre: `${base} - cuadro ${i + 1} (${formatoDuracion(video.segundos[i] ?? 0)}).jpg`,
      tipo: "image/jpeg",
      tamanio: Math.floor((base64.length * 3) / 4),
      base64,
    }));

    const audio = video.audio
      ? [
          {
            nombre: `${base} - audio.wav`,
            tipo: "audio/wav",
            tamanio: Math.floor((video.audio.length * 3) / 4),
            base64: video.audio,
          },
        ]
      : [];

    return [...cuadros, ...audio];
  });
}

/** Lo que se le explica a EOS sobre cada video, para que no vea fotos sueltas. */
function notasDeVideos(archivos: ArchivoAdjunto[]): string {
  return archivos
    .filter((a) => a.video)
    .map((a) =>
      notaDelVideo({
        nombre: a.nombre,
        duracion: a.video!.duracion,
        segundos: a.video!.segundos,
        conAudio: Boolean(a.video!.audio),
      }),
    )
    .join("\n");
}

function esImagenAdjunta(
  archivo: ArchivoAdjunto | null,
): boolean {
  return Boolean(
    archivo?.tipo?.toLowerCase().startsWith("image/"),
  );
}

/*
 * La línea que queda escrita en la conversación diciendo qué se adjuntó.
 *
 * De todo el mensaje, `mensajes.texto` es lo único que se guarda en la base.
 * Sin esta referencia, quien vuelve mañana a la conversación ve su pregunta
 * sobre "esta factura" y ninguna factura.
 *
 * Con varios adjuntos se nombran TODOS —al revés que el texto por defecto del
 * campo, que los cuenta—. Son dos cosas distintas: aquello es lo que la
 * persona iba a escribir, esto es el registro de lo que mandó.
 */
function construirReferenciaArchivo(
  archivos: ArchivoAdjunto[],
): string {
  if (archivos.length === 0) return "";

  const etiqueta = etiquetaDeAdjuntos(archivos.map((a) => a.tipo));

  return `[${etiqueta}: ${archivos.map((a) => a.nombre).join(", ")}]`;
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
  /** "buscando_web" mientras el servidor investiga; null el resto del tiempo. */
  const [fase, setFase] = useState<string | null>(null);

  const [archivosAdjuntos, setArchivosAdjuntos] =
    useState<ArchivoAdjunto[]>([]);

  /*
   * El fragmento citado vive acá y no en el componente.
   *
   * Es parte de lo que se va a MANDAR, igual que los adjuntos: si viviera en
   * ChatView habría que devolverlo hacia arriba justo en el momento del envío,
   * que es cuando ya se limpió el campo.
   */
  const [cita, setCita] = useState<Cita | null>(null);

  /*
   * Los adjuntos del último envío, para que "Regenerar" los vuelva a mandar
   * (27/09/2026). Regeneraba solo el texto: un mensaje con dos capturas que
   * falló por la red se rehacía SIN las capturas, y EOS contestaba sin haber
   * visto los montos. Viven solo en memoria: al recargar la página se
   * pierden, igual que antes.
   */
  const archivosDelUltimoEnvio = useRef<{ conversacionId: string; archivos: ArchivoAdjunto[] }>({
    conversacionId: "",
    archivos: [],
  });

  const ejecutarEOS = useCallback(
    async ({
      textoUsuario,
      conversacionActiva,
      historialParaContexto,
      archivos,
      guardarUsuario,
      reemplazarUltimaRespuesta,
      cita: citaDelEnvio,
      fotosSubidas,
      notaParaEOS,
    }: EjecutarEOSParams) => {
      setCargando(true);
      setPensando(true);

      /*
       * El mensaje del usuario se guarda cuando terminan de subir sus fotos,
       * para anotarlas, y mientras tanto EOS ya está contestando. Se espera
       * antes de guardar la respuesta, así las dos quedan en orden.
       */
      const guardadoUsuario = guardarUsuario
        ? (async () => {
            const fotos = await fotosSubidas;

            await guardarMensaje(
              conversacionActiva,
              usuarioId,
              "usuario",
              textoUsuario,
              fotos,
            );

            await actualizarTituloSiHaceFalta(
              conversacionActiva,
              textoUsuario,
            );
          })()
        : Promise.resolve();

      try {
        const resultadoEOS = await enviarMensajeAEOS({
          usuarioId,
          conversacionId: conversacionActiva,
          nombre,
          plan,
          mensaje: notaParaEOS
            ? `${textoUsuario}\n\n${notaParaEOS}`
            : textoUsuario,
          historial: historialParaContexto.slice(-HISTORIAL_MAXIMO),
          nuevoChat: historialParaContexto.length === 0,
          archivos,
          cita: citaDelEnvio,
          alCambiarFase: setFase,
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

        await guardadoUsuario;

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

        // Aunque EOS haya fallado, lo que mandó la persona queda guardado.
        await guardadoUsuario.catch((guardadoError) =>
          console.error("No se pudo guardar el mensaje:", guardadoError),
        );

        const respuestaError =
          obtenerMensajeError(error);

        const mensajeError: Mensaje = {
          id: crearIdMensaje("error"),
          rol: "eos",
          texto: respuestaError,
          estado: "error",
          creado_en: new Date().toISOString(),
        };

        /*
         * El aviso de error se MUESTRA, pero no se guarda en la conversación
         * (24/09/2026). Guardado, viajaba en el historial como si EOS lo
         * hubiera dicho, y el modelo terminaba hablando de la falla en vez de
         * seguir con lo que la persona estaba haciendo.
         */
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
      archivosAdjuntos.length > 0;

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

    const archivosActuales = archivosAdjuntos;
    const citaActual = cita;
    archivosDelUltimoEnvio.current = {
      conversacionId: conversacionActiva,
      archivos: archivosActuales,
    };

    const textoUsuario =
      textoFinal.trim() || textoPorDefecto(archivosActuales);

    /*
     * La cita se GUARDA adentro del texto del mensaje del usuario.
     *
     * De todo el intercambio, `mensajes.texto` es lo único que persiste: si la
     * cita viviera sólo en el cuerpo del pedido, al recargar la conversación
     * quedaría una pregunta suelta —"¿por qué es 32%?"— sin nada que la ubique.
     *
     * Al backend viaja ADEMÁS en su propio campo, que es lo que le permite al
     * modelo saber que ese pedazo es suyo y no algo que escribió la persona.
     */
    const textoConLaCita = textoConCita(textoUsuario, citaActual);

    const textoVisibleUsuario =
      archivosActuales.length > 0
        ? `${textoConLaCita}\n\n${construirReferenciaArchivo(
            archivosActuales,
          )}`
        : textoConLaCita;

    // Se ven ya, desde el base64 que se está por mandar. Al recargar, las
    // mismas fotos vuelven desde el bucket (`obtenerMensajes`).
    const imagenes = archivosActuales
      .filter(seVeComoMiniatura)
      .map((a) => ({
        nombre: a.nombre,
        // La miniatura de un video es su primer cuadro, que es un JPEG.
        src: `data:${a.video ? "image/jpeg" : a.tipo};base64,${a.base64}`,
        ...(a.video ? { duracion: a.video.duracion } : {}),
      }));

    const fotosSubidas = subirFotos(archivosActuales);

    const mensajeUsuario: Mensaje = {
      id: crearIdMensaje("usuario"),
      rol: "usuario",
      texto: textoVisibleUsuario,
      estado: "completado",
      // El primero y no todos: estos dos campos existen para elegir el ícono
      // de la burbuja, que es uno solo. Los nombres completos ya están en el
      // texto del mensaje, que es lo que se guarda.
      archivo_nombre:
        archivosActuales[0]?.nombre || "",
      archivo_tipo:
        archivosActuales[0]?.tipo || "",
      tipo: archivosActuales.length > 0
        ? "archivo_adjunto"
        : "texto",
      ...(imagenes.length > 0 ? { imagenes } : {}),
      creado_en: new Date().toISOString(),
    };

    const historialAntesDelEnvio =
      historial.slice(-HISTORIAL_MAXIMO);

    setMensaje("");
    setArchivosAdjuntos([]);
    setCita(null);

    setHistorial((actual) => [
      ...actual,
      mensajeUsuario,
    ]);

    await ejecutarEOS({
      // El texto que se guarda y el que viaja son el mismo: la cita adentro,
      // más el campo estructurado. Ver el comentario de arriba.
      textoUsuario: textoConLaCita,
      conversacionActiva,
      historialParaContexto:
        historialAntesDelEnvio,
      archivos: archivosParaEOS(archivosActuales),
      notaParaEOS: notasDeVideos(archivosActuales) || undefined,
      guardarUsuario: true,
      reemplazarUltimaRespuesta: false,
      cita: citaActual,
      fotosSubidas,
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
        historialSinUltimaRespuesta.slice(-HISTORIAL_MAXIMO),
      // Solo si son de ESTA conversación: el último envío pudo ser en otra.
      archivos:
        archivosDelUltimoEnvio.current.conversacionId === conversacionId
          ? archivosDelUltimoEnvio.current.archivos
          : [],
      guardarUsuario: false,
      reemplazarUltimaRespuesta: true,
      // Regenerar rehace el último mensaje tal como se mandó, y la cita ya
      // está adentro de su texto. Mandarla otra vez la duplicaría.
      cita: null,
      fotosSubidas: Promise.resolve([]),
    });
  }

  return {
    mensaje,
    setMensaje,

    cargando,
    fase,
    pensando,

    archivosAdjuntos,
    setArchivosAdjuntos,

    cita,
    setCita,

    enviarMensaje,
    regenerarRespuesta,
  };
}