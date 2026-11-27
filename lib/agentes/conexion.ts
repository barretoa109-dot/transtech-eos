import postgres from "postgres";

import { variableDeConexion, type Agente } from "./agentes.ts";
import type { Llamar } from "./runtime.ts";

/**
 * La conexión de un agente a la base, con SU rol (`agente_<nombre>`).
 *
 * No pasa por supabase-js ni por la API REST: entra directo a Postgres por el
 * pooler de Supabase con un usuario que solo puede ejecutar las funciones del
 * schema `agentes`. Por eso ningún agente usa la service role: aunque el
 * código de un agente quisiera leer `usuarios` o escribir en un pago, la base
 * le contesta "permission denied".
 *
 * La cadena va en `AGENTE_<NOMBRE>_DB_URL`, con la forma
 *   postgresql://agente_cobranza.<ref>:<clave>@<pooler>:6543/postgres
 * y la arma `npm run agentes -- clave <agente>`.
 *
 * `prepare: false` porque el pooler en modo transacción no admite sentencias
 * preparadas con nombre.
 */

const NOMBRE_DE_FUNCION = /^[a-z_]+$/;

export function llamarCon(sql: postgres.Sql): Llamar {
  return async (funcion, args) => {
    if (!NOMBRE_DE_FUNCION.test(funcion)) throw new Error(`Función de agente inválida: ${funcion}`);
    const marcas = args.map((_, i) => `$${i + 1}`).join(", ");
    const filas = await sql.unsafe(`select agentes.${funcion}(${marcas}) as r`, args.map(aParametro));
    return filas[0]?.r ?? null;
  };
}

/** postgres.js no serializa objetos sueltos: los jsonb van como texto. */
function aParametro(valor: unknown): postgres.ParameterOrJSON<never> {
  if (valor !== null && typeof valor === "object" && !(valor instanceof Date)) return JSON.stringify(valor) as never;
  return valor as never;
}

const abiertas = new Map<Agente, postgres.Sql>();

/** La conexión del agente, o un error claro si falta su variable. */
export function conexionDe(agente: Agente, env: Record<string, string | undefined> = process.env): Llamar {
  let sql = abiertas.get(agente);
  if (!sql) {
    const url = env[variableDeConexion(agente)]?.trim();
    if (!url) throw new Error(`Falta ${variableDeConexion(agente)}: el agente ${agente} no tiene conexión propia.`);
    sql = postgres(url, { prepare: false, max: 2, idle_timeout: 20, connect_timeout: 10 });
    abiertas.set(agente, sql);
  }
  return llamarCon(sql);
}
