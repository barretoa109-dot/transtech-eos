/**
 * Etapa 2: traducir lo que pidió el modelo a jobs para el Worker.
 *
 * Puerto del nodo `06 GW Preparar Jobs Worker`, 11,2 KB. A diferencia de la
 * etapa 1, acá SÍ hay efectos durables del otro lado: una venta, un movimiento
 * de stock, un contacto.
 *
 * ============================================================
 * LA CANONICALIZACIÓN NO ES PROLIJIDAD, ES EXACT-ONCE
 * ============================================================
 *
 * El Worker Gate guarda una huella (sha256) del payload de cada comando, y la
 * usa para reconocer un reintento y no ejecutarlo dos veces. Ver `fingerprint`
 * en `lib/worker-gate-handler.ts`.
 *
 * OpenAI expresa el mismo concepto con nombres distintos: `titulo`, `nombre`,
 * `name` y `asunto` son la misma idea. Si el payload viajara tal cual sale del
 * modelo, dos llamadas con la misma intención darían dos huellas distintas, el
 * gate no reconocería el reintento y la venta se cargaría dos veces.
 *
 * Por eso todos los alias se llevan al MISMO contrato antes de armar el job.
 * Cualquier cambio acá cambia la huella de comandos ya emitidos y provoca
 * `EOS_COMMAND_PAYLOAD_MISMATCH` sobre reintentos legítimos.
 *
 * ============================================================
 * LO QUE NUNCA PUEDE ENTRAR EN EL JOB
 * ============================================================
 *
 * Nada que cambie entre dos ejecuciones de OpenAI para el mismo mensaje:
 * `openai_response_id`, `openai_status`, `openai_model`, ni ningún timestamp
 * de inferencia. Todos ellos cambian en cada llamada, y si formaran parte del
 * payload durable, cada reintento se vería como un comando nuevo.
 *
 * Hay un test que recorre el job entero y falla si alguno aparece.
 */

import type { Entrada } from "./entrada.ts";
import type { Accion, RespuestaGateway } from "./respuesta.ts";

/** A qué webhook del Worker va cada acción. */
export const RUTAS: Record<string, string> = {
  RESPONDER: "eos-worker-rc1-respond",
  CREAR_TAREA: "eos-worker-rc1-internal",
  CREAR_OBJETIVO: "eos-worker-rc1-internal",
  GUARDAR_MEMORIA: "eos-worker-rc1-internal",
  GENERAR_EXCEL: "eos-worker-rc1-file",
  GENERAR_PDF: "eos-worker-rc1-file",
  GENERAR_WORD: "eos-worker-rc1-file",
  VER_DASHBOARD: "eos-worker-rc1-dashboard",
  VER_BRIEFING: "eos-worker-rc1-briefing",

  /*
   * Las tres del negocio dejan un efecto durable igual que una tarea, así que
   * van por el mismo camino interno. Lo que las distingue no es el worker sino
   * su riesgo: la puerta de autonomía les exige aprobación explícita.
   */
  REGISTRAR_VENTA: "eos-worker-rc1-internal",
  AJUSTAR_STOCK: "eos-worker-rc1-internal",
  CREAR_CONTACTO: "eos-worker-rc1-internal",
};

export type Job = {
  request_id: string;
  usuario_id: string;
  usuario_id_original: string;
  usuario_key: string;
  conversacion_id: string;
  nombre: string;
  plan: string;
  origen: string;
  mensaje: string;
  /** Puede variar entre llamadas: el gate NO debe usarlo en la huella. */
  respuesta_gateway: string;
  accion: { tipo: string; datos: Record<string, unknown> };
  action_index: number;
  action_count: number;
  worker_path: string;
  sin_acciones: boolean;
  historial: unknown[];
  metadata: Record<string, unknown>;
  received_at: string;
};

export class AccionNoPermitida extends Error {}

/** El primer valor que sea texto o número. Nunca devuelve "undefined". */
function texto(...valores: unknown[]): string {
  for (const v of valores) {
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  return "";
}

/** 1 a 5. Lo que no es número cae en 3, que es el medio. */
export function prioridad(valor: unknown): number {
  const n = Number(valor);
  if (!Number.isFinite(n)) return 3;
  return Math.max(1, Math.min(5, Math.round(n)));
}

/** 1 a 10. Lo que no es número cae en 5. */
export function importancia(valor: unknown): number {
  const n = Number(valor);
  if (!Number.isFinite(n)) return 5;
  return Math.max(1, Math.min(10, Math.round(n)));
}

/**
 * Los alias de OpenAI llevados a un solo contrato.
 *
 * El orden de cada `texto(...)` es el orden de preferencia y NO se puede
 * cambiar: si mañana `nombre` ganara sobre `titulo`, dos payloads que hoy dan
 * la misma huella pasarían a dar huellas distintas.
 */
export function normalizarDatos(tipo: string, entrada: unknown): Record<string, unknown> {
  const d = (entrada && typeof entrada === "object" && !Array.isArray(entrada)
    ? entrada
    : {}) as Record<string, unknown>;

  if (tipo === "CREAR_TAREA") {
    return {
      titulo: texto(d.titulo, d.nombre, d.name, d.asunto, d.tarea),
      descripcion: texto(d.descripcion, d.description, d.detalle, d.detalles),
      prioridad: prioridad(d.prioridad ?? d.priority),
      fecha_limite: texto(d.fecha_limite, d.fecha, d.deadline, d.due_date, d.vencimiento),
    };
  }

  if (tipo === "GUARDAR_MEMORIA") {
    return {
      titulo: texto(d.titulo, d.nombre, d.name),
      categoria: texto(d.categoria, d.category),
      contenido: texto(d.contenido, d.texto, d.descripcion, d.memoria, d.valor),
      importancia: importancia(d.importancia ?? d.importance),
    };
  }

  if (tipo === "GENERAR_EXCEL" || tipo === "GENERAR_PDF" || tipo === "GENERAR_WORD") {
    return {
      tema: texto(d.tema, d.asunto, d.objetivo, d.titulo, d.topic),
      tipo: texto(d.tipo, d.type, d.plantilla, d.template),
      rubro: texto(d.rubro, d.sector, d.categoria, d.industry),
      negocio: texto(d.negocio, d.empresa, d.nombre_negocio, d.nombre_empresa, d.business, d.nombre),
      descripcion: texto(d.descripcion, d.description, d.detalle, d.detalles),
    };
  }

  // CREAR_OBJETIVO conserva sus datos crudos: su contrato lo valida el worker
  // por su cuenta. Las lecturas y RESPONDER no llevan datos.
  if (tipo === "VER_DASHBOARD" || tipo === "VER_BRIEFING" || tipo === "RESPONDER") return {};

  return d;
}

/**
 * La metadata que viaja en el job.
 *
 * Es un subconjunto deliberado de `respuesta.metadata`: se dejan afuera
 * `openai_response_id`, `openai_status`, `openai_model` y `gateway`, que
 * cambian entre ejecuciones. Ver el encabezado.
 */
export function metadataEstable(e: Entrada): Record<string, unknown> {
  return {
    plan: e.plan || "free",
    origen: e.origen || "eos-web",
    tiene_archivo: e.tiene_archivo,
    archivo_entrada_nombre: e.archivo_nombre,
    archivo_entrada_tipo: e.archivo_tipo,
    imagen_analizada: e.archivo_categoria === "imagen" && e.imagen_data_url !== "",
  };
}

/**
 * Un job por acción.
 *
 * Sin acciones se fabrica uno de `RESPONDER` con `sin_acciones: true`, igual
 * que n8n. Ese job no produce ningún efecto durable —la rama RESPONDER del
 * Worker solo hace un health ping— y por eso quien llama puede saltearlo. Se
 * arma igual para que la forma no dependa del caso.
 */
export function armarJobs(e: Entrada, r: RespuestaGateway): Job[] {
  const sinAcciones = r.acciones.length === 0;
  const acciones: Accion[] = sinAcciones ? [{ tipo: "RESPONDER", datos: {} }] : r.acciones;

  return acciones.map((accion, index) => {
    const tipo = String(accion.tipo || "RESPONDER").trim().toUpperCase();
    const worker_path = RUTAS[tipo];

    if (!worker_path) {
      // No debería pasar: `prepararRespuesta` ya filtró por la lista blanca.
      // El guard queda porque el día que alguien agregue una acción a la lista
      // y se olvide de la ruta, esto tiene que gritar y no mandar el job a
      // ningún lado.
      throw new AccionNoPermitida(`Acción Worker no permitida: ${tipo}`);
    }

    return {
      request_id: e.request_id,
      usuario_id: e.usuario_id,
      usuario_id_original: e.usuario_id,
      usuario_key: e.usuario_id,
      conversacion_id: e.conversacion_id,
      nombre: e.nombre || "Usuario",
      plan: e.plan || "free",
      origen: e.origen || "eos-web",
      mensaje: e.mensaje,
      respuesta_gateway: r.respuesta,
      accion: { tipo, datos: normalizarDatos(tipo, accion.datos) },
      action_index: index,
      action_count: acciones.length,
      worker_path,
      sin_acciones: sinAcciones,
      historial: e.historial,
      metadata: metadataEstable(e),
      received_at: e.received_at,
    };
  });
}
