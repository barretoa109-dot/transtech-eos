import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase-admin";
import { createClient } from "@/lib/supabase/server";
import { normalizarDocumento } from "@/lib/documentos/especificacion";
import { esFormato, guardarDocumento } from "@/lib/documentos/guardar";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Registrar un documento para bajarlo después.
 *
 * El camino normal es el chat: EOS describe el documento en su respuesta y
 * `app/api/eos` lo guarda solo. Esta ruta es el otro camino —el de la propia
 * app: un botón del panel que arma un cuadro con lo que ya está en pantalla y
 * quiere ofrecerlo en Excel, PDF y Word sin gastar un mensaje del plan.
 *
 * Devuelve el id y la ruta de descarga; el archivo se dibuja recién en
 * `GET /api/documentos/[id]`.
 *
 * El insert va con el cliente de servicio porque `eos_documentos_generados` no
 * acepta escrituras de `authenticated`: si las aceptara, se podría guardar una
 * descripción armada a mano sin pasar por el normalizador. El `usuario_id` sale
 * de la sesión y de ningún otro lado.
 */

/** Tope de cuerpo: una descripción honesta no pesa más que esto. */
const MAX_BYTES = 2 * 1024 * 1024;

export async function POST(request: Request) {
  const supabase = await createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Sesión no válida." }, { status: 401, headers: noStore() });
  }

  const crudo = await request.text();

  if (crudo.length > MAX_BYTES) {
    return NextResponse.json(
      { error: "El documento es demasiado grande." },
      { status: 413, headers: noStore() },
    );
  }

  let cuerpo: Record<string, unknown>;
  try {
    cuerpo = JSON.parse(crudo || "{}");
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido." }, { status: 400, headers: noStore() });
  }

  const resultado = normalizarDocumento(cuerpo.documento ?? cuerpo);

  if (!resultado.ok) {
    return NextResponse.json({ error: resultado.motivo }, { status: 400, headers: noStore() });
  }

  const formato = esFormato(cuerpo.formato) ? cuerpo.formato : "excel";

  const guardado = await guardarDocumento(createAdminClient(), {
    usuarioId: user.id,
    conversacionId: typeof cuerpo.conversacion_id === "string" ? cuerpo.conversacion_id : null,
    documento: resultado.documento,
    formato,
    recortes: resultado.recortes,
  });

  if (!guardado) {
    return NextResponse.json(
      { error: "No pudimos guardar el documento." },
      { status: 503, headers: noStore() },
    );
  }

  return NextResponse.json(guardado, { status: 201, headers: noStore() });
}

function noStore() {
  return { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" };
}
