import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { PGlite } from "@electric-sql/pglite";

/**
 * Un Postgres de verdad adentro de `npm test`, para probar SQL del repo.
 *
 * ============================================================
 * POR QUÉ EXISTE
 * ============================================================
 *
 * Buena parte de lo que protege a EOS vive en la base: la cadena de la
 * bitácora de auditoría, el ejecutor de acciones, los triggers que preparan
 * cada objetivo. Hasta el 29/09/2026 nada de eso corría en el CI: la
 * reconstrucción (`supabase/pruebas/local/reconstruir.sh`) es manual, pide un
 * Postgres instalado y solo anda en Linux, y las migraciones se probaban contra
 * producción dentro de una transacción que terminaba en `raise exception`.
 *
 * PGlite es Postgres compilado a WebAssembly: arranca en el mismo proceso que
 * la prueba, sin servidor ni Docker, en Windows y en el runner de GitHub igual.
 * No es Supabase: no tiene sus roles, ni `auth`, ni extensiones como pg_cron.
 * `baseDePrueba` pone lo mínimo de eso (los roles que nombran los grants y un
 * `auth.uid()` que lee el mismo ajuste que usa PostgREST), y cada prueba carga
 * las migraciones que necesita, tal cual están en `supabase/migrations/`.
 */

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

export function migracion(nombre: string): string {
  const carpeta = path.join(RAIZ, "supabase", "migrations");
  const archivo = fs.readdirSync(carpeta).find((f) => f === nombre || f.startsWith(`${nombre}_`));
  if (!archivo) throw new Error(`No existe la migración ${nombre} en supabase/migrations/`);
  return fs.readFileSync(path.join(carpeta, archivo), "utf8");
}

export async function baseDePrueba(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    create schema auth;
    create table auth.users (id uuid primary key default gen_random_uuid(), email text);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
  `);
  return db;
}

/** Actúa como esa persona para `auth.uid()` hasta el próximo cambio. */
export async function comoUsuario(db: PGlite, usuarioId: string | null): Promise<void> {
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [usuarioId ?? ""]);
}
