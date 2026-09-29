export type RolMensaje = "usuario" | "eos";

export type EstadoMensaje =
  | "enviando"
  | "pensando"
  | "completado"
  | "error";

export type TipoArchivoEOS =
  | "excel"
  | "xlsx"
  | "xls"
  | "pdf"
  | "word"
  | "doc"
  | "docx"
  | "csv"
  | "txt"
  | "imagen"
  | "archivo"
  | string;

export type Mensaje = {
  rol: RolMensaje;
  texto: string;

  id?: string;
  estado?: EstadoMensaje;

  archivo_url?: string;
  archivo_tipo?: TipoArchivoEOS;
  archivo_nombre?: string;

  tipo?: string;
  accion?: string;

  /**
   * Las fotos que mandó la persona, para verlas como miniatura.
   *
   * `src` es lo que se muestra: el base64 mientras se manda, o un enlace
   * firmado de una hora al abrir la conversación. `ruta` es dónde quedó
   * guardada; falta si todavía no se subió o si la subida falló.
   */
  imagenes?: ImagenDelMensaje[];

  creado_en?: string;
};

export type ImagenDelMensaje = {
  nombre: string;
  src?: string;
  ruta?: string;
  /** Solo en los videos: la miniatura es su primer cuadro, con la duración encima. */
  duracion?: number;
};

export type Conversacion = {
  id: string;
  titulo: string | null;
  created_at?: string;
  /** Con fecha, el chat está en "Archivados" y no en la lista (v210). */
  archivada_at?: string | null;
};

export type VistaEOS =
  | "chat"
  | "briefing"
  | "decisions"
  | "learnings"
  | "dashboard"
  | "negocio"
  | "crm"
  | "gastos"
  | "calendario"
  | "perfil";

export type ArchivoAdjunto = {
  nombre: string;
  tipo: string;
  tamanio?: number;
  base64: string;
  extension?: string;
  url?: string;
  /** Lo que viaja en lugar del archivo: en un video, sus cuadros y el audio. */
  partes?: { base64: string }[];
  /** Un video ya desarmado en el navegador (`services/video.ts`). */
  video?: {
    duracion: number;
    segundos: number[];
    cuadros: string[];
    audio: string | null;
  };
};
