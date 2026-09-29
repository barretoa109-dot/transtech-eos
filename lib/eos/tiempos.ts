/**
 * Dónde se van los segundos de cada mensaje.
 *
 * La meta del tablero de lanzamiento (encargado-02) es que la mediana de
 * respuesta baje de 8 s. Hasta el 29/09/2026 solo se sabía el total: el log de
 * Vercel traía `ms` y se borra en una hora, y la reserva de cupo daba ~7 s de
 * mediana entre reservar y cerrar. La batería midió el modelo solo en ~3 s,
 * así que la mitad del tiempo estaba en otro lado y no se podía decir dónde.
 *
 * Cada mensaje guarda ahora sus etapas en `tiempos` de eos_message_usage_v40,
 * la fila de la reserva de cupo, que ya existe por cada mensaje y ya está
 * atada al usuario y al request_id.
 */

/** Las etapas, en milisegundos desde que empezó a procesarse el mensaje. */
export type Tiempos = {
  /** El contexto del negocio, la memoria y el historial listos. */
  contexto?: number;
  /** La ráfaga y la reserva de cupo pasadas. */
  cupo?: number;
  /** Llegó la respuesta del gateway (con las acciones ya ejecutadas en la etapa 3). */
  respuesta?: number;
  /** El consumo confirmado. */
  cierre?: number;
  /** Lo último antes de devolverle la respuesta a quien llamó. */
  fin?: number;
  /** Duración (no acumulada) de la llamada al modelo, si la hizo el gateway en TypeScript. */
  modelo?: number;
  /** Duración (no acumulada) de las acciones, si las ejecutó el gateway en TypeScript. */
  acciones?: number;
  /** Quién atendió: ts, directa o n8n. */
  gateway?: string;
};

const ms = (valor: unknown): number | undefined =>
  typeof valor === "number" && Number.isFinite(valor) && valor >= 0 ? Math.round(valor) : undefined;

/**
 * Junta las marcas del procesamiento con lo que midió el gateway adentro.
 * Descarta lo que no sea un número razonable: esto va a una columna que se
 * promedia, y un NaN o un negativo la arruinan en silencio.
 */
export function tiemposDelTurno(
  marcas: Readonly<Record<string, number>>,
  metadata: Readonly<Record<string, unknown>> | null | undefined,
): Tiempos {
  const salida: Tiempos = {};
  for (const etapa of ["contexto", "cupo", "respuesta", "cierre", "fin"] as const) {
    const valor = ms(marcas[etapa]);
    if (valor !== undefined) salida[etapa] = valor;
  }
  const modelo = ms(metadata?.modelo_ms);
  if (modelo !== undefined) salida.modelo = modelo;
  const acciones = ms(metadata?.worker_ms);
  if (acciones !== undefined) salida.acciones = acciones;
  const gateway = metadata?.gateway;
  salida.gateway = gateway === "ts" || gateway === "directa" ? gateway : "n8n";
  return salida;
}

type ClienteConUpdate = {
  from: (tabla: string) => {
    update: (valores: Record<string, unknown>) => {
      eq: (columna: string, valor: string) => {
        eq: (columna: string, valor: string) => PromiseLike<{ error: unknown }>;
      };
    };
  };
};

/** Nunca lanza: medir no puede romper un mensaje que ya se contestó. */
export async function guardarTiempos(
  admin: ClienteConUpdate,
  usuarioId: string,
  requestId: string,
  tiempos: Tiempos,
): Promise<void> {
  try {
    const { error } = await admin
      .from("eos_message_usage_v40")
      .update({ tiempos })
      .eq("usuario_id", usuarioId)
      .eq("request_id", requestId);
    if (error) console.error("Tiempos: no se pudieron guardar:", error);
  } catch (error) {
    console.error("Tiempos: no se pudieron guardar:", error);
  }
}
