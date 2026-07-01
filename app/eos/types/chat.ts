export type RolMensaje = "usuario" | "eos";

export type Mensaje = {
  rol: RolMensaje;
  texto: string;
};

export type Conversacion = {
  id: string;
  titulo: string | null;
  created_at?: string;
};

export type VistaEOS = "chat" | "briefing" | "dashboard" | "perfil";

export type ImagenAdjunta = {
  nombre: string;
  tipo: string;
  base64: string;
};