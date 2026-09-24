import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Qué versión de EOS está respondiendo. Público a propósito.
 *
 * Sirve para comprobar, sin ningún secreto, que producción corre el último
 * `main` (lo usa `npm run go`). El commit no es información sensible: el
 * repositorio es la fuente de verdad, y esto solo dice cuál de sus versiones
 * está publicada. No lee la base ni el entorno más allá de lo que pone Vercel.
 */
export function GET() {
  return NextResponse.json(
    {
      entorno: process.env.VERCEL_ENV ?? null,
      commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) ?? null,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
