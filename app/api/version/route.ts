import { NextResponse } from "next/server";

import { etapaDelGateway } from "@/lib/gateway/conversar";

export const dynamic = "force-dynamic";

/**
 * Qué versión de EOS está respondiendo. Público a propósito.
 *
 * Sirve para comprobar, sin ningún secreto, que producción corre el último
 * `main` (lo usa `npm run go`). El commit no es información sensible: el
 * repositorio es la fuente de verdad, y esto solo dice cuál de sus versiones
 * está publicada. No lee la base ni el entorno más allá de lo que pone Vercel.
 *
 * `gateway` es la etapa del gateway en TypeScript que está atendiendo (0 a 3,
 * ver `etapaDelGateway`): un número, nunca el valor de una variable.
 */
export function GET() {
  return NextResponse.json(
    {
      entorno: process.env.VERCEL_ENV ?? null,
      commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) ?? null,
      gateway: etapaDelGateway(),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
