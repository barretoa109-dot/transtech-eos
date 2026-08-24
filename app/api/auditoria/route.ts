import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_REGISTROS = 200;

/**
 * La bitácora del usuario, con su verificación de integridad.
 *
 * Contesta dos preguntas distintas y las devuelve juntas a propósito:
 *
 *   1. **¿De dónde salió este número?** — cada movimiento que entró solo, con
 *      qué confianza se leyó y de qué aviso salió; y cada acción que el usuario
 *      autorizó o rechazó.
 *   2. **¿Puedo creerle a esta lista?** — `eos_auditoria_verificar_v60()`
 *      recorre la cadena de hashes y dice si algún eslabón no cierra. Una
 *      bitácora que no se puede verificar es una lista de afirmaciones.
 *
 * Se lee con la sesión del usuario, no con la clave de servicio: la política
 * de RLS es la que garantiza que nadie vea la bitácora de otro, y usar acá el
 * cliente de servicio saltearía esa garantía sin necesidad.
 */
export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Sesión no válida." }, { status: 401, headers: noStore() });
  }

  const url = new URL(request.url);
  const limite = Math.min(Number(url.searchParams.get("limite")) || 50, MAX_REGISTROS);

  const [registrosRes, verificacionRes] = await Promise.all([
    supabase
      .from("eos_auditoria_v60")
      .select("numero,evento,origen,resumen,detalle,referencia,hash,created_at")
      .order("numero", { ascending: false })
      .limit(limite),
    supabase.rpc("eos_auditoria_verificar_v60"),
  ]);

  if (registrosRes.error) {
    console.error("No se pudo leer la bitácora:", registrosRes.error);
    return NextResponse.json(
      { error: "No pudimos cargar tu bitácora." },
      { status: 500, headers: noStore() },
    );
  }

  // La verificación es información, no un requisito para mostrar la lista: si
  // falla la función, los registros igual se muestran y se dice que no se pudo
  // verificar. Callarlo sería peor que mostrarlo sin sello.
  const verificacion = verificacionRes.error
    ? { disponible: false as const }
    : { disponible: true as const, ...(Array.isArray(verificacionRes.data) ? verificacionRes.data[0] : verificacionRes.data) };

  if (verificacionRes.error) {
    console.error("No se pudo verificar la cadena de auditoría:", verificacionRes.error);
  }

  return NextResponse.json(
    { registros: registrosRes.data ?? [], verificacion },
    { headers: noStore() },
  );
}

function noStore() {
  return { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" };
}
