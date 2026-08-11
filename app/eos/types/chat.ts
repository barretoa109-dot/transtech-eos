export type RolMensaje = "usuario" | "eos";

export type EstadoMensaje =
  | "enviando"
  | "pensando"
  | "completado"
  | "error";

export type TipoArchivoEOS =
  | "excel"
  | "xlsx"
  | "pdf"
  | "word"
  | "docx"
  | "csv"
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

  creado_en?: string;
};

export type Conversacion = {
  id: string;
  titulo: string | null;
  created_at?: string;
};

export type VistaEOS =
  | "chat"
  | "briefing"
  | "decisions"
  | "learnings"
  | "dashboard"
  | "perfil";

export type ImagenAdjunta = {
  nombre: string;
  tipo: string;
  base64: string;
};

export type ArchivoAdjunto = {
  nombre: string;
  tipo: string;
  tamanio?: number;
  base64: string;
};
