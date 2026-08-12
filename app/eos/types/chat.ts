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
  | "context"
  | "decisions"
  | "learnings"
  | "dashboard"
  | "perfil";

export type ImagenAdjunta = {
  nombre: string;
  tipo: string;
  base64: string;
};

export type DocumentoAdjunto = {
  id: string;
  nombre: string;
  tipo: string;
  tamanio: number;
  document_type: string;
  extraction_status: string;
  intelligence_status: string;
  duplicate?: boolean;
};

export type ArchivoAdjunto = {
  nombre: string;
  tipo: string;
  tamanio?: number;
  base64: string;
};
