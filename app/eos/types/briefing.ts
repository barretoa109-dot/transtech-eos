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
  /** Fecha y score de cada briefing del último año, del más viejo al más nuevo. */
  score_history?: ScorePunto[] | null;
  /** El score del negocio y el personal de cada día, rearmado desde los indicadores. */
  score_series?: SeriesScore | null;
  /** Por qué hay o no hay score. Ver `lib/kpi/scoreBriefing.ts`. */
  score_diagnostico?: DiagnosticoScore | null;
  is_stale: boolean;
  error?: string;
};

export type ScorePunto = { fecha: string; score: number };

export type SeriesScore = { negocio: ScorePunto[]; personal: ScorePunto[] };

export type DiagnosticoScore = {
  foto_hoy: "ya_estaba" | "sacada" | "no_se_pudo";
  filas_historia: number;
  negocio: { habilitado: boolean; dias: number; errores: string[] };
  personal: { habilitado: boolean; dias: number; errores: string[] };
  errores: string[];
};
