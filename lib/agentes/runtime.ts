import type { Agente, Canal, Disparador, Prioridad } from "./agentes.ts";
import { costoUsd, type Uso } from "./costo.ts";

/**
 * Cómo corre un agente. Todo agente pasa por `correrAgente`, que es lo que
 * hace cumplir, del lado del código, lo que la base ya garantiza:
 *
 *   1. empieza la corrida (si está apagado o sin aprobar, no hace nada más);
 *   2. le da al trabajo un `ctx` cuyo ÚNICO camino para mandar algo es
 *      `ctx.enviar`, que primero pide permiso a `agentes.autorizar_envio`;
 *   3. anota la entrega de cada mensaje y, al final, el costo y la duración.
 *
 * `llamar` es la conexión del agente con SU rol (ver conexion.ts). Acá no se
 * importa nada de Supabase a propósito: este archivo no puede usar la service
 * role ni por error.
 */

/** Ejecuta `agentes.<funcion>(...args)` y devuelve el resultado. */
export type Llamar = (funcion: string, args: unknown[]) => Promise<unknown>;

export type ResultadoEnvio = { ok: boolean; proveedorId?: string | null; detalle?: string | null };

export type PedidoEnvio = {
  usuarioId: string;
  canal: Canal;
  /** Plantilla o prompt usado, por ejemplo "cobranza/dia3". */
  plantilla: string;
  /** Solo Soporte, al contestar una pregunta que hizo la persona. */
  fueraDelTope?: boolean;
  /** Lo que de verdad manda. Solo se llama si la base lo autorizó. */
  mandar: () => Promise<ResultadoEnvio>;
};

export type EstadoEnvio = "enviado" | "no_autorizado" | "fallado";

export type Contexto = {
  agente: Agente;
  runId: string;
  limites: Record<string, unknown>;
  enviar: (pedido: PedidoEnvio) => Promise<EstadoEnvio>;
  escalar: (caso: { usuarioId?: string | null; motivo: string; prioridad: Prioridad; contexto?: Record<string, unknown> }) => Promise<string | null>;
  /** Suma el uso de una llamada a Claude al costo de la corrida. */
  anotarUso: (modelo: string, uso: Uso, opciones?: { lote?: boolean }) => void;
  /** false si el agente ya gastó su tope del mes (`limites.gasto_usd_mes`). */
  puedeGastar: () => Promise<boolean>;
};

export type ResultadoCorrida =
  | { estado: "apagado" }
  | { estado: "version_sin_aprobar"; runId?: string }
  | { estado: "ok"; runId: string; salida: unknown; costoUsd: number }
  | { estado: "error"; runId: string; error: string };

type Inicio = { activo: boolean; motivo?: string; run_id?: string; limites?: Record<string, unknown> };

export async function correrAgente<T>(
  opciones: {
    agente: Agente;
    llamar: Llamar;
    version: string;
    disparador: Disparador;
    usuarioId?: string | null;
    eventoId?: string | null;
    /** Resumen de la entrada: contadores e ids, nunca datos de la persona. */
    entrada?: Record<string, unknown>;
  },
  trabajo: (ctx: Contexto) => Promise<T>,
): Promise<ResultadoCorrida> {
  const { agente, llamar } = opciones;

  const inicio = (await llamar("empezar_run", [
    opciones.disparador,
    opciones.version,
    opciones.usuarioId ?? null,
    opciones.eventoId ?? null,
    opciones.entrada ?? {},
  ])) as Inicio;

  if (!inicio?.activo || !inicio.run_id) {
    if (inicio?.motivo === "version_sin_aprobar") return { estado: "version_sin_aprobar", runId: inicio.run_id };
    return { estado: "apagado" };
  }

  const runId = inicio.run_id;
  const uso = { modelo: null as string | null, entrada: 0, salida: 0, cache: 0, costo: 0 };

  const ctx: Contexto = {
    agente,
    runId,
    limites: inicio.limites ?? {},

    async enviar(pedido) {
      const mensajeId = (await llamar("autorizar_envio", [
        runId,
        pedido.usuarioId,
        pedido.canal,
        pedido.plantilla,
        !pedido.fueraDelTope,
      ])) as string | null;

      if (!mensajeId) return "no_autorizado";

      let resultado: ResultadoEnvio;
      try {
        resultado = await pedido.mandar();
      } catch (e) {
        resultado = { ok: false, detalle: e instanceof Error ? e.message : String(e) };
      }

      await llamar("marcar_entrega", [
        mensajeId,
        resultado.ok ? "enviado" : "fallado",
        resultado.proveedorId ?? null,
        resultado.detalle ?? null,
      ]);
      return resultado.ok ? "enviado" : "fallado";
    },

    async escalar(caso) {
      return (await llamar("escalar", [
        runId,
        caso.usuarioId ?? null,
        caso.motivo,
        caso.prioridad,
        caso.contexto ?? {},
      ])) as string | null;
    },

    anotarUso(modelo, u, extra) {
      uso.modelo = modelo;
      uso.entrada += u.input_tokens ?? 0;
      uso.salida += u.output_tokens ?? 0;
      uso.cache += (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
      uso.costo += costoUsd(modelo, u, extra);
    },

    async puedeGastar() {
      const tope = Number(ctx.limites.gasto_usd_mes);
      if (!Number.isFinite(tope) || tope <= 0) return true;
      const gastado = Number(await llamar("gasto_del_mes", []));
      return gastado + uso.costo < tope;
    },
  };

  const terminar = (salida: unknown, error: string | null) =>
    llamar("terminar_run", [
      runId,
      salida === undefined ? null : salida,
      uso.modelo,
      uso.entrada,
      uso.salida,
      uso.cache,
      Math.round(uso.costo * 1_000_000) / 1_000_000,
      error,
    ]);

  try {
    const salida = await trabajo(ctx);
    await terminar(salida ?? null, null);
    return { estado: "ok", runId, salida, costoUsd: uso.costo };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    await terminar(null, error);
    // Un caso abierto por agente, no uno por corrida: el índice de la base
    // junta las repeticiones.
    await llamar("escalar", [runId, null, "La corrida del agente falló", "normal", { error: error.slice(0, 300) }]).catch(
      () => null,
    );
    return { estado: "error", runId, error };
  }
}
