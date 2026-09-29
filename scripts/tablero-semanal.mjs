#!/usr/bin/env node
/**
 * El tablero de los viernes, cuando quieras y sin esperar al correo.
 *
 *   npm run tablero
 *
 * Lee PRODUCCIÓN por la Management API (solo lectura), con el mismo
 * SUPABASE_ACCESS_TOKEN de `npm run go`. Llama a `eos_tablero_semanal_v213`
 * (v213) para esta semana y la anterior y lo imprime igual que el correo.
 * Solo conteos: se puede pegar donde sea.
 */

import fs from "node:fs";

import { consultar } from "./lib/api-supabase.mjs";

const REF = "dirugpkamzgvyshcnsxs";

function leer(nombre) {
  if (process.env[nombre]) return process.env[nombre].trim();
  try {
    return fs
      .readFileSync(".env.local", "utf8")
      .match(new RegExp(`^${nombre}=(.*)$`, "m"))?.[1]
      ?.trim()
      .replace(/^["']|["']$/g, "");
  } catch {
    return undefined;
  }
}

const token = leer("SUPABASE_ACCESS_TOKEN");
if (!token) {
  console.error("Falta SUPABASE_ACCESS_TOKEN (en el entorno o en .env.local).");
  process.exit(1);
}

const filas = await consultar(
  REF,
  token,
  `select public.eos_tablero_semanal_v213(now()) as actual,
          public.eos_tablero_semanal_v213(now() - interval '7 days') as anterior`,
);

const { leerFila, redactarTablero } = await import("../lib/metricas/tablero-semanal.ts");
const fila = Array.isArray(filas) ? filas[0] : null;
if (!fila) {
  console.error("La consulta no devolvió nada. ¿Está aplicada la v213?");
  process.exit(1);
}

const hoy = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Asuncion" }).format(new Date());
console.log(redactarTablero(leerFila(fila.actual), leerFila(fila.anterior), hoy).texto);
