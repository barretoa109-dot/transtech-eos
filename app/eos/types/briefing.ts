export type BriefingStatus = "generando" | "listo" | "error";

export type BriefingItem = {
  titulo: string;
  descripcion?: string;
  nivel?: "alto" | "medio" | "bajo";
};

export type BriefingSources = {
  objetivos_activos?: number;
  progreso_promedio?: number;
  tareas_pendientes?: number;
  seguimientos_pendientes?: number;
  acciones_con_error?: number;
  mensajes_ultimos_7_dias?: number;
};

export type Briefing = {
  id?: string;
  briefing_date?: string | null;
  estado?: BriefingStatus;
  tipo_usuario?: string;
  saludo?: string;
  titulo_dia?: string;
  resumen?: string;
  enfoque_dia?: string;
  prioridad_1?: string;
  prioridad_2?: string;
  prioridad_3?: string;
  recomendacion_principal?: string;
  logros?: BriefingItem[];
  riesgos?: BriefingItem[];
  proximos_pasos?: BriefingItem[];
  fuentes?: BriefingSources;
  score?: number;
  modelo_version?: string;
  generated_at?: string;
  created_at?: string;
  updated_at?: string;
};

export type BriefingApiResponse = {
  briefing: Briefing | null;
  history: Briefing[];
  is_stale: boolean;
  master_context?: {
    resumen_compacto?: string;
    proxima_mejor_accion?: { titulo?: string; razon?: string };
    alertas?: Array<{ titulo?: string; mensaje?: string; severidad?: string }>;
    objetivos?: Array<{ titulo?: string; progreso?: number; proximo_paso?: string }>;
    necesita_actualizacion?: boolean;
    generado_at?: string;
  } | null;
  error?: string;
};
