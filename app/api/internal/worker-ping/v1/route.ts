import { NextResponse } from "next/server";

import { autorizadoComoWorker } from "@/lib/worker-gate-handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * "¿Estoy autorizado?", y nada más.
 *
 * ============================================================
 * ESTA RUTA FALTABA, Y ROMPÍA EL DASHBOARD Y EL BRIEFING
 * ============================================================
 *
 * Tres ramas del Background Worker de n8n —DASH, BRIEF y RESP— empiezan
 * pegándole a `/api/internal/worker-ping/v1` para comprobar que el token sigue
 * siendo bueno antes de leer nada. Ese endpoint nunca existió en este
 * repositorio: bajo `/api/internal/` solo había `action-effects`, `consultar`,
 * `salud` y `worker-authorize`.
 *
 * Como los nodos están configurados con `onError: continueRegularOutput`, el
 * flujo no se caía: seguía con `ping.ok` en falso, `authorized` en falso, y la
 * rama devolvía `{ok:false, error:'Worker no autorizado.'}`. El gateway lo
 * leía como un fallo y le contestaba a la persona:
 *
 *   "No pude completar automáticamente: VER_DASHBOARD."
 *
 * O sea: pedir el dashboard o el briefing por chat no funcionaba, y el motivo
 * era una ruta de cuatro líneas que faltaba. RESP también pinga, pero esa rama
 * el gateway la saltea siempre, así que ahí no se notaba.
 *
 * ============================================================
 * NO HACE NADA MÁS QUE RESPONDER
 * ============================================================
 *
 * No lee, no escribe y no recibe cuerpo. Es a propósito: cuanto menos haga una
 * ruta que solo confirma un token, menos superficie hay para equivocarse. La
 * comprobación es la misma función que usa el Worker Gate —no una copia— y
 * compara en tiempo constante.
 */

function noStore() {
  return { "Cache-Control": "private, no-store, max-age=0", Vary: "Authorization" };
}

export async function POST(request: Request) {
  const autorizacion = autorizadoComoWorker(request);

  if (autorizacion.unavailable) {
    // Sin el secreto configurado no se puede afirmar nada. 503 y no 401: el
    // problema es del servidor, no de quien llama, y confundirlos manda a
    // buscar el error al lado equivocado.
    return NextResponse.json(
      { ok: false, error: "Worker gate no configurado." },
      { status: 503, headers: noStore() },
    );
  }

  if (!autorizacion.ok) {
    return NextResponse.json(
      { ok: false, error: "No autorizado." },
      { status: 401, headers: noStore() },
    );
  }

  return NextResponse.json({ ok: true }, { headers: noStore() });
}
